import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'

const secret = process.env.JWT_SECRET
if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to a random value of at least 32 characters')

export const signToken = (playerId: string) => jwt.sign({ sub: playerId }, secret, { expiresIn: '7d', issuer: 'kingfighter-api', audience: 'kingfighter-client' })

export interface AuthRequest extends Request { playerId?: string }

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    const payload = jwt.verify(token, secret!, { issuer: 'kingfighter-api', audience: 'kingfighter-client' })
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return res.status(401).json({ error: 'Invalid session' })
    req.playerId = payload.sub
    next()
  } catch { return res.status(401).json({ error: 'Session expired or invalid' }) }
}

export const registerBody = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().trim().min(2).max(24),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(72).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
}).strict()
export const loginBody = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(72) }).strict()
export const profileBody = z.object({ displayName: z.string().trim().min(2).max(24), selectedHero: z.enum(['kai', 'nyx']) }).strict()
const control = z.object({ x: z.number().min(0.02).max(0.98), y: z.number().min(0.04).max(0.96), size: z.number().min(0.55).max(1.5), opacity: z.number().min(0.25).max(1) }).strict()
export const layoutBody = z.object({ joystick: control, attack: control, skill1: control, skill2: control, skill3: control, ultimate: control, dash: control }).strict()
export const matchBody = z.object({
  heroId: z.enum(['kai', 'nyx']), difficulty: z.enum(['easy', 'medium', 'hard']),
  result: z.enum(['win', 'loss']), roundsWon: z.number().int().min(0).max(2), roundsLost: z.number().int().min(0).max(2),
}).strict().refine((match) => match.result === 'win' ? match.roundsWon === 2 && match.roundsLost <= 1 : match.roundsLost === 2 && match.roundsWon <= 1, 'Match result must represent a completed best-of-three')

export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) })
    req.body = parsed.data
    next()
  }
}
