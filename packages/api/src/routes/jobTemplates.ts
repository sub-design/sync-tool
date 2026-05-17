import { Router, type Router as ExpressRouter } from 'express'
import { v4 as uuid } from 'uuid'
import { jobTemplatesDb, jobsDb } from '../db'
import type { JobTemplateDefaults } from '@sync-tool/shared'
import { requireAuth } from '../middleware/requireAuth'
import { auditRequest } from '../audit'

export function createJobTemplatesRouter(): ExpressRouter {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    res.json(await jobTemplatesDb.listForOrg(req.orgId))
  })

  router.get('/:id', async (req, res) => {
    const template = await jobTemplatesDb.get(req.params.id)
    if (!template || template.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }
    res.json(template)
  })

  router.post('/', async (req, res) => {
    const { name, description, defaults = {} } = req.body ?? {}
    if (!name) { res.status(400).json({ error: 'name is required' }); return }

    const template = await jobTemplatesDb.create({
      id: uuid(),
      name,
      description: description || undefined,
      defaults,
    }, req.userId, req.orgId)

    auditRequest(req, 'job_template.created', {
      targetType: 'job_template',
      targetId:   template.id,
      metadata:   { name: template.name },
    })
    res.status(201).json(template)
  })

  router.patch('/:id', async (req, res) => {
    const existing = await jobTemplatesDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }

    const template = await jobTemplatesDb.update(req.params.id, req.body ?? {})
    if (!template) { res.status(404).json({ error: 'Template not found' }); return }

    auditRequest(req, 'job_template.updated', {
      targetType: 'job_template',
      targetId:   template.id,
      metadata:   { fields: Object.keys(req.body ?? {}) },
    })
    res.json(template)
  })

  const PROPAGATED_FIELDS: (keyof JobTemplateDefaults)[] = [
    'direction', 'jobMode', 'transferMode', 'deletionPolicy', 'conflictStrategy',
    'destinationLayout', 'dateSource', 'collisionPolicy',
    'watch', 'schedule', 'autoOptions', 'reliability', 'filters',
  ]

  router.get('/:id/derived', async (req, res) => {
    const existing = await jobTemplatesDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }
    const jobs = await jobsDb.listByTemplateId(req.params.id)
    res.json({ count: jobs.length, jobs })
  })

  router.post('/:id/apply', async (req, res) => {
    const existing = await jobTemplatesDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }
    const jobs = await jobsDb.listByTemplateId(req.params.id)
    const patch: Record<string, unknown> = {}
    for (const field of PROPAGATED_FIELDS) {
      if (field in existing.defaults) patch[field] = (existing.defaults as Record<string, unknown>)[field]
    }
    let updatedCount = 0
    for (const job of jobs) {
      await jobsDb.update(job.id, patch)
      updatedCount++
    }
    auditRequest(req, 'job_template.applied', {
      targetType: 'job_template',
      targetId:   existing.id,
      metadata:   { updatedCount },
    })
    res.json({ updatedCount })
  })

  router.delete('/:id', async (req, res) => {
    const existing = await jobTemplatesDb.get(req.params.id)
    if (!existing || existing.orgId !== req.orgId) {
      res.status(404).json({ error: 'Template not found' }); return
    }

    const ok = await jobTemplatesDb.delete(req.params.id)
    if (!ok) { res.status(404).json({ error: 'Template not found' }); return }

    auditRequest(req, 'job_template.deleted', {
      targetType: 'job_template',
      targetId:   req.params.id,
      metadata:   { name: existing.name },
    })
    res.json({ ok: true })
  })

  return router
}
