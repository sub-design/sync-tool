import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomBytes, createHash } from 'crypto'

const SECRET = process.env.JWT_SECRET ?? (() => {
  const s = randomBytes(32).toString('hex')
  console.warn('[auth] JWT_SECRET not set — using ephemeral secret (sessions won\'t survive restarts)')
  return s
})()

export function signJwt(userId: string): string {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '30d' })
}

export function verifyJwt(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, SECRET) as { sub: string }
    return { userId: payload.sub }
  } catch {
    return null
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function checkPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function randomToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
