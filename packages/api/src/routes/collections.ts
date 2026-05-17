import { Router, type Router as ExpressRouter } from 'express'
import { v4 as uuid } from 'uuid'
import { collectionsDb, collectionTemplatesDb, jobTemplatesDb, jobsDb, usersDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { auditRequest } from '../audit'
import type { Job, JobTemplate } from '@sync-tool/shared'

// Replaces {DeviceName} and {DeviceId} variables with actual values.
function resolveDeviceVars(path: string, device: { id: string; name: string }): string {
  return path
    .replace(/\{DeviceName\}/g, device.name)
    .replace(/\{DeviceId\}/g, device.id)
}

// Build a job to create for a single device, applying template defaults + apply-time overrides.
function buildJobForDevice(
  template: JobTemplate,
  device: { id: string; name: string },
  source: string,
  destination: string,
  collectionId: string,
): Omit<Job, 'status' | 'createdAt' | 'updatedAt'> {
  const d = template.defaults
  return {
    id:                  uuid(),
    name:                `${template.name} — ${device.name}`,
    source:              resolveDeviceVars(source, device),
    destination:         resolveDeviceVars(destination, device),
    direction:           d.direction ?? 'ltr',
    jobMode:             d.jobMode ?? 'sync',
    transferMode:        d.transferMode ?? 'auto',
    conflictStrategy:    d.conflictStrategy,
    deletionPolicy:      d.deletionPolicy ?? 'backup',
    reliability:         d.reliability ?? {},
    filters:             d.filters ?? {},
    destinationLayout:   d.destinationLayout ?? 'byCaptureDate',
    dateSource:          d.dateSource ?? 'exifThenMtime',
    collisionPolicy:     d.collisionPolicy ?? 'skipSameErrorDifferent',
    templateId:          template.id,
    collectionId,
    sourceDeviceId:      device.id,
    destinationDeviceId: d.destinationDeviceId,
    sourceEndpointId:    d.sourceEndpointId,
    destinationEndpointId: d.destinationEndpointId,
    watch:               d.watch ?? false,
    schedule:            d.schedule,
    autoOptions:         d.autoOptions ?? {},
  }
}

export function createCollectionsRouter(): ExpressRouter {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    res.json(await collectionsDb.listForOrg(req.orgId))
  })

  router.get('/:id', async (req, res) => {
    const collection = await collectionsDb.get(req.params.id)
    if (!collection || collection.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }
    res.json(collection)
  })

  router.post('/', async (req, res) => {
    const { name, description, deviceIds = [] } = req.body ?? {}
    if (!name) { res.status(400).json({ error: 'name is required' }); return }

    const collection = await collectionsDb.create({
      id: uuid(),
      name,
      description: description || undefined,
      deviceIds,
    }, req.userId, req.orgId)

    auditRequest(req, 'collection.created', {
      targetType: 'collection',
      targetId:   collection.id,
      metadata:   { name: collection.name, deviceCount: deviceIds.length },
    })
    res.status(201).json(collection)
  })

  router.patch('/:id', async (req, res) => {
    const existing = await collectionsDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }

    const { name, description, deviceIds, deleteOrphanedJobs } = req.body ?? {}

    // Compute device diff before update (only matters if deviceIds is part of the patch)
    const addedDeviceIds:   string[] = []
    const removedDeviceIds: string[] = []
    if (Array.isArray(deviceIds)) {
      const prev = new Set(existing.deviceIds)
      const next = new Set<string>(deviceIds)
      for (const id of next) if (!prev.has(id)) addedDeviceIds.push(id)
      for (const id of prev) if (!next.has(id)) removedDeviceIds.push(id)
    }

    const collection = await collectionsDb.update(req.params.id, { name, description, deviceIds })
    if (!collection) { res.status(404).json({ error: 'Collection not found' }); return }

    // Phase 4C propagation
    let autoCreated = 0, deletedOrphans = 0, keptOrphans = 0
    if (addedDeviceIds.length > 0 || removedDeviceIds.length > 0) {
      const links = await collectionTemplatesDb.listForCollection(collection.id)

      // Auto-create jobs for newly-added devices, for every applied template
      for (const link of links) {
        const template = await jobTemplatesDb.get(link.templateId)
        if (!template) continue
        for (const deviceId of addedDeviceIds) {
          const device = await usersDb.getTokenForOrg(deviceId, req.orgId)
          if (!device) continue
          const dup = await jobsDb.findByCollectionTemplateDevice(collection.id, link.templateId, deviceId)
          if (dup) continue
          const draft = buildJobForDevice(template, device, link.source, link.destination, collection.id)
          await jobsDb.create(draft, req.userId, req.orgId)
          autoCreated++
        }
      }

      // Handle removed-device jobs: delete or count as kept (orphaned)
      if (removedDeviceIds.length > 0) {
        if (deleteOrphanedJobs) {
          deletedOrphans = await jobsDb.deleteByCollectionAndDevices(collection.id, removedDeviceIds)
        } else {
          // Count surviving orphans so frontend can surface the number
          const orphans = await jobsDb.listByCollectionId(collection.id)
          keptOrphans = orphans.filter((j) => j.sourceDeviceId && removedDeviceIds.includes(j.sourceDeviceId)).length
        }
      }
    }

    auditRequest(req, 'collection.updated', {
      targetType: 'collection',
      targetId:   collection.id,
      metadata:   { fields: Object.keys(req.body ?? {}), addedDeviceIds, removedDeviceIds, autoCreated, deletedOrphans, keptOrphans },
    })
    res.json({ collection, autoCreated, deletedOrphans, keptOrphans })
  })

  // ── Applied templates ──────────────────────────────────────────────────────

  router.get('/:id/templates', async (req, res) => {
    const collection = await collectionsDb.get(req.params.id)
    if (!collection || collection.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }
    const links = await collectionTemplatesDb.listForCollection(collection.id)
    // Enrich with template name and current job count
    const enriched = await Promise.all(links.map(async (link) => {
      const tpl  = await jobTemplatesDb.get(link.templateId)
      const jobs = await jobsDb.listByCollectionId(collection.id)
      const jobCount = jobs.filter((j) => j.templateId === link.templateId).length
      return { ...link, templateName: tpl?.name, jobCount }
    }))
    res.json(enriched)
  })

  router.get('/:id/apply/preview', async (req, res) => {
    const collection = await collectionsDb.get(req.params.id)
    if (!collection || collection.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }
    const templateId = String(req.query.templateId ?? '')
    if (!templateId) { res.status(400).json({ error: 'templateId is required' }); return }

    const template = await jobTemplatesDb.get(templateId)
    if (!template || template.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }

    const devices = await Promise.all(
      collection.deviceIds.map(async (did) => {
        const device  = await usersDb.getTokenForOrg(did, req.orgId)
        if (!device) return null
        const existing = await jobsDb.findByCollectionTemplateDevice(collection.id, templateId, did)
        return { id: device.id, name: device.name, jobExists: Boolean(existing) }
      }),
    )
    const filtered = devices.filter((d): d is { id: string; name: string; jobExists: boolean } => d !== null)
    const wouldCreate  = filtered.filter((d) => !d.jobExists).length
    const alreadyExist = filtered.filter((d) =>  d.jobExists).length
    res.json({ wouldCreate, alreadyExist, devices: filtered })
  })

  router.post('/:id/apply', async (req, res) => {
    const collection = await collectionsDb.get(req.params.id)
    if (!collection || collection.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }
    const { templateId, source: srcOverride, destination: dstOverride } = req.body ?? {}
    if (!templateId) { res.status(400).json({ error: 'templateId is required' }); return }

    const template = await jobTemplatesDb.get(templateId)
    if (!template || template.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }

    const source      = String(srcOverride ?? template.defaults.source ?? '')
    const destination = String(dstOverride ?? template.defaults.destination ?? '')
    if (!source || !destination) {
      res.status(400).json({ error: 'source and destination are required (either on the template or in the request body)' }); return
    }

    // Save the binding so future devices can auto-receive jobs (Phase 4C)
    await collectionTemplatesDb.upsert(
      { collectionId: collection.id, templateId, source, destination },
      req.orgId,
    )

    let created = 0, skipped = 0
    const createdJobs: Job[] = []
    for (const deviceId of collection.deviceIds) {
      const device = await usersDb.getTokenForOrg(deviceId, req.orgId)
      if (!device) { skipped++; continue }

      const existing = await jobsDb.findByCollectionTemplateDevice(collection.id, templateId, deviceId)
      if (existing) { skipped++; continue }

      const draft = buildJobForDevice(template, device, source, destination, collection.id)
      const job   = await jobsDb.create(draft, req.userId, req.orgId)
      createdJobs.push(job)
      created++
    }

    auditRequest(req, 'collection_template.applied', {
      targetType: 'collection',
      targetId:   collection.id,
      metadata:   { templateId, created, skipped },
    })
    res.json({ created, skipped, jobs: createdJobs })
  })

  router.delete('/:id/templates/:templateId', async (req, res) => {
    const collection = await collectionsDb.get(req.params.id)
    if (!collection || collection.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }
    const ok = await collectionTemplatesDb.delete(collection.id, req.params.templateId)
    if (!ok) { res.status(404).json({ error: 'Link not found' }); return }

    auditRequest(req, 'collection_template.unapplied', {
      targetType: 'collection',
      targetId:   collection.id,
      metadata:   { templateId: req.params.templateId },
    })
    res.json({ ok: true })
  })

  router.delete('/:id', async (req, res) => {
    const existing = await collectionsDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Collection not found' }); return
    }

    const ok = await collectionsDb.delete(req.params.id)
    if (!ok) { res.status(404).json({ error: 'Collection not found' }); return }

    auditRequest(req, 'collection.deleted', {
      targetType: 'collection',
      targetId:   req.params.id,
      metadata:   { name: existing.name },
    })
    res.json({ ok: true })
  })

  return router
}
