import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { hashPassword, checkPassword, signJwt } from '../auth'
import { usersDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'

export function createAuthRouter(): Router {
  const router = Router()

  // POST /api/auth/register — open only when no users exist
  router.post('/register', async (req, res) => {
    try {
      if (await usersDb.count() > 0) {
        res.status(403).json({ error: 'Registration is closed' })
        return
      }
      const { email, password } = req.body
      if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return }
      if (typeof password !== 'string' || password.length < 8) { res.status(400).json({ error: 'password must be at least 8 characters' }); return }
      if (await usersDb.getByEmail(email)) { res.status(409).json({ error: 'Email already registered' }); return }

      const passwordHash = await hashPassword(password)
      const user         = await usersDb.create(uuid(), email, passwordHash)
      res.status(201).json({ token: signJwt(user.id), user: { id: user.id, email: user.email } })
    } catch (err) {
      console.error('[auth] register error', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body
      if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return }

      const user = await usersDb.getByEmail(email)
      if (!user || !(await checkPassword(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid credentials' })
        return
      }
      res.json({ token: signJwt(user.id), user: { id: user.id, email: user.email } })
    } catch (err) {
      console.error('[auth] login error', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /api/auth/me
  router.get('/me', requireAuth, async (req, res) => {
    const user = await usersDb.getById(req.userId)
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    res.json({ id: user.id, email: user.email })
  })

  return router
}
