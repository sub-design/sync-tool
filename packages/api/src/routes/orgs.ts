import { Router } from 'express'
import { usersDb, orgsDb, membershipsDb } from '../db.js'
import { requireAuth, requireRole } from '../middleware/requireAuth.js'
import { auditRequest } from '../audit.js'
import type { OrgRole } from '@sync-tool/shared'

export function createOrgsRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  // GET /api/orgs — list orgs the current user belongs to
  router.get('/', async (req, res) => {
    const orgs = await orgsDb.list(req.userId)
    res.json(orgs)
  })

  // GET /api/orgs/current — current org details + members
  router.get('/current', async (req, res) => {
    const org     = await orgsDb.get(req.orgId)
    const members = await membershipsDb.listForOrg(req.orgId)
    res.json({ ...org, members })
  })

  // PATCH /api/orgs/current — rename, change plan (admin+)
  router.patch('/current', requireRole('admin'), async (req, res) => {
    const { name, plan } = req.body
    const updated = await orgsDb.update(req.orgId, { name, plan })
    if (!updated) { res.status(404).json({ error: 'Org not found' }); return }
    auditRequest(req, 'org.updated', {
      targetType: 'org', targetId: req.orgId,
      metadata: { fields: Object.keys(req.body) },
    })
    res.json(updated)
  })

  // GET /api/orgs/current/members
  router.get('/current/members', async (req, res) => {
    res.json(await membershipsDb.listForOrg(req.orgId))
  })

  // POST /api/orgs/current/members — invite by email (admin+)
  router.post('/current/members', requireRole('admin'), async (req, res) => {
    const { email, role = 'member' } = req.body
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'email is required' }); return
    }
    const VALID_ROLES: OrgRole[] = ['admin', 'member', 'viewer']
    if (!VALID_ROLES.includes(role as OrgRole)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }); return
    }

    const user = await usersDb.getByEmail(email)
    if (!user) { res.status(404).json({ error: 'No user with that email' }); return }

    // Can't invite the owner or change their role
    const existing = await membershipsDb.get(user.id, req.orgId)
    if (existing?.role === 'owner') {
      res.status(409).json({ error: 'Cannot change owner role' }); return
    }

    const membership = await membershipsDb.add(user.id, req.orgId, role as OrgRole, req.userId)
    auditRequest(req, 'org.member_added', {
      targetType: 'org', targetId: req.orgId,
      metadata: { userId: user.id, email, role },
    })
    res.status(201).json({ ...membership, email: user.email })
  })

  // PATCH /api/orgs/current/members/:userId — change role (admin+)
  router.patch('/current/members/:userId', requireRole('admin'), async (req, res) => {
    const { role } = req.body
    const VALID_ROLES: OrgRole[] = ['admin', 'member', 'viewer']
    if (!VALID_ROLES.includes(role as OrgRole)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }); return
    }

    // Can't change own role or owner's role
    if (req.params.userId === req.userId) {
      res.status(409).json({ error: 'Cannot change your own role' }); return
    }
    const existing = await membershipsDb.get(req.params.userId, req.orgId)
    if (!existing) { res.status(404).json({ error: 'Member not found' }); return }
    if (existing.role === 'owner') { res.status(409).json({ error: 'Cannot change owner role' }); return }

    await membershipsDb.updateRole(req.params.userId, req.orgId, role as OrgRole)
    auditRequest(req, 'org.member_role_changed', {
      targetType: 'org', targetId: req.orgId,
      metadata: { userId: req.params.userId, role },
    })
    res.json({ ok: true })
  })

  // DELETE /api/orgs/current/members/:userId — remove member (admin+, can't remove owner)
  router.delete('/current/members/:userId', requireRole('admin'), async (req, res) => {
    if (req.params.userId === req.userId) {
      res.status(409).json({ error: 'Cannot remove yourself' }); return
    }
    const existing = await membershipsDb.get(req.params.userId, req.orgId)
    if (!existing) { res.status(404).json({ error: 'Member not found' }); return }
    if (existing.role === 'owner') { res.status(409).json({ error: 'Cannot remove the org owner' }); return }

    await membershipsDb.remove(req.params.userId, req.orgId)
    auditRequest(req, 'org.member_removed', {
      targetType: 'org', targetId: req.orgId,
      metadata: { userId: req.params.userId },
    })
    res.json({ ok: true })
  })

  return router
}
