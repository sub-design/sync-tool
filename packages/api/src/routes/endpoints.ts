import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { endpointsDb } from '../db.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { auditRequest } from '../audit.js'
import type { Endpoint, SavedEndpointConfig } from '@sync-tool/shared'

const VALID_TYPES: Endpoint['type'][] = ['local', 'sftp', 'ftp', 'ftps', 's3', 'smb', 'nfs']

// ── URI builder ───────────────────────────────────────────────────────────────

export function buildEndpointUri(ep: Endpoint): string {
  const { type, config } = ep

  if (type === 'local') return config.path ?? ''

  if (type === 's3') {
    const bucket = config.bucket ?? ''
    const prefix = config.remotePath ? `/${config.remotePath.replace(/^\/+/, '')}` : ''
    const params = new URLSearchParams()
    if (config.region)   params.set('region', config.region)
    if (config.endpoint) params.set('endpoint', config.endpoint)
    const credsPart = config.accessKeyId && config.secretAccessKey
      ? `${encodeURIComponent(config.accessKeyId)}:${encodeURIComponent(config.secretAccessKey)}@`
      : ''
    const qs = params.size > 0 ? `?${params.toString()}` : ''
    return `s3://${credsPart}${bucket}${prefix}${qs}`
  }

  const host = config.host ?? ''
  const defaultPort: Record<string, number> = { sftp: 22, ftp: 21, ftps: 990 }
  const portPart = config.port != null && config.port !== defaultPort[type]
    ? `:${config.port}`
    : ''
  const credsPart = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? '')}@`
    : ''

  if (type === 'smb') {
    const sharePart = config.share ? `/${config.share.replace(/^\/+|\/+$/g, '')}` : ''
    const subPart   = config.remotePath ? `/${config.remotePath.replace(/^\/+/, '')}` : ''
    return `smb://${credsPart}${host}${sharePart}${subPart}`
  }

  if (type === 'nfs') {
    const exportPart = (config.remotePath ?? '').startsWith('/')
      ? (config.remotePath ?? '')
      : `/${config.remotePath ?? ''}`
    return `nfs://${host}${exportPart}`
  }

  // sftp, ftp, ftps
  const pathPart = (config.remotePath ?? '').startsWith('/')
    ? (config.remotePath ?? '')
    : `/${config.remotePath ?? ''}`
  return `${type}://${credsPart}${host}${portPart}${pathPart}`
}

// ── Masking ───────────────────────────────────────────────────────────────────

function maskConfig(config: SavedEndpointConfig): SavedEndpointConfig {
  return {
    ...config,
    password:        config.password        ? '••••••••' : config.password,
    secretAccessKey: config.secretAccessKey ? '••••••••' : config.secretAccessKey,
  }
}

function maskEndpoint(ep: Endpoint): Endpoint {
  return { ...ep, config: maskConfig(ep.config) }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateBody(body: Record<string, unknown>): string | null {
  const { name, type, config = {} } = body as {
    name: unknown; type: unknown; config: Record<string, unknown>
  }
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.length > 100)
    return 'name must be 1–100 characters'
  if (!type || !VALID_TYPES.includes(type as Endpoint['type']))
    return `type must be one of: ${VALID_TYPES.join(', ')}`
  if (type === 'local' && !config.path)
    return 'config.path is required for local endpoints'
  if (type === 's3' && !config.bucket)
    return 'config.bucket is required for S3 endpoints'
  if (['sftp', 'ftp', 'ftps', 'smb', 'nfs'].includes(type as string) && !config.host)
    return 'config.host is required for remote endpoints'
  return null
}

// ── Credential merge helper (PATCH: keep existing secrets if not re-supplied) ─

function mergeConfig(existing: SavedEndpointConfig, incoming: SavedEndpointConfig): SavedEndpointConfig {
  return {
    ...existing,
    ...incoming,
    // If the incoming password is the mask sentinel, keep the existing secret
    password:        incoming.password        === '••••••••' ? existing.password        : incoming.password,
    secretAccessKey: incoming.secretAccessKey === '••••••••' ? existing.secretAccessKey : incoming.secretAccessKey,
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createEndpointsRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  // GET /api/endpoints
  router.get('/', async (req, res) => {
    const endpoints = await endpointsDb.list(req.userId, req.orgId)
    res.json(endpoints.map(maskEndpoint))
  })

  // GET /api/endpoints/:id
  router.get('/:id', async (req, res) => {
    const ep = await endpointsDb.get(req.params.id, req.userId, req.orgId)
    if (!ep) { res.status(404).json({ error: 'Endpoint not found' }); return }
    res.json(maskEndpoint(ep))
  })

  // POST /api/endpoints
  router.post('/', async (req, res) => {
    const err = validateBody(req.body)
    if (err) { res.status(400).json({ error: err }); return }

    const { name, type, config = {}, deviceId } = req.body as {
      name: string; type: Endpoint['type']; config: SavedEndpointConfig; deviceId?: string
    }
    const ep = await endpointsDb.create(req.userId, {
      id: uuid(), name: name.trim(), type, config, deviceId,
    }, req.orgId)
    auditRequest(req, 'endpoint.created', {
      targetType: 'endpoint', targetId: ep.id, metadata: { name: ep.name, type: ep.type },
    })
    res.status(201).json(maskEndpoint(ep))
  })

  // PATCH /api/endpoints/:id
  router.patch('/:id', async (req, res) => {
    const existing = await endpointsDb.get(req.params.id, req.userId, req.orgId)
    if (!existing) { res.status(404).json({ error: 'Endpoint not found' }); return }

    const patch: Partial<Pick<Endpoint, 'name' | 'type' | 'config' | 'deviceId'>> = {}

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || req.body.name.trim().length < 1 || req.body.name.length > 100) {
        res.status(400).json({ error: 'name must be 1–100 characters' }); return
      }
      patch.name = req.body.name.trim()
    }

    if (req.body.type !== undefined) {
      if (!VALID_TYPES.includes(req.body.type)) {
        res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }); return
      }
      patch.type = req.body.type
    }

    if (req.body.config !== undefined) {
      patch.config = mergeConfig(existing.config, req.body.config as SavedEndpointConfig)
    }

    if (req.body.deviceId !== undefined) patch.deviceId = req.body.deviceId || undefined

    const updated = await endpointsDb.update(req.params.id, req.userId, patch, req.orgId)
    if (!updated) { res.status(404).json({ error: 'Endpoint not found' }); return }

    auditRequest(req, 'endpoint.updated', {
      targetType: 'endpoint', targetId: req.params.id,
      metadata: { fields: Object.keys(req.body) },
    })
    res.json(maskEndpoint(updated))
  })

  // DELETE /api/endpoints/:id
  router.delete('/:id', async (req, res) => {
    const ep = await endpointsDb.get(req.params.id, req.userId, req.orgId)
    if (!ep) { res.status(404).json({ error: 'Endpoint not found' }); return }

    const usedBy = await endpointsDb.findJobsUsing(req.params.id)
    if (usedBy.length > 0) {
      res.status(409).json({
        error: 'Endpoint is in use by one or more jobs',
        jobs: usedBy,
      }); return
    }

    await endpointsDb.delete(req.params.id, req.userId, req.orgId)
    auditRequest(req, 'endpoint.deleted', {
      targetType: 'endpoint', targetId: req.params.id, metadata: { name: ep.name },
    })
    res.status(204).send()
  })

  return router
}
