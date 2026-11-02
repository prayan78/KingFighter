import 'dotenv/config'
import express from 'express'
import { createServer } from 'node:http'
import cors from 'cors'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { Server } from 'socket.io'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { Player } from './models/Player.ts'
import { AuthRequest, layoutBody, loginBody, matchBody, profileBody, registerBody, requireAuth, signToken, validateBody } from './security.ts'
import { attachMultiplayer, type OnlineIdentity } from './multiplayer.ts'
import { currentSeason, rankTier } from './ranked.ts'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((origin) => origin.trim())
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['Content-Type', 'Authorization'] }))
app.use(express.json({ limit: '32kb', strict: true }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }))

const publicPlayer = (player: any) => {
  const season = currentSeason()
  const active = player.seasonId === season.id
  const seasonRating = active ? player.seasonRating ?? 1000 : 1000
  const seasonMatches = active ? player.seasonMatches ?? 0 : 0
  return ({
  id: player.id, username: player.username, displayName: player.displayName, email: player.email,
  ownedHeroes: player.ownedHeroes, selectedHero: player.selectedHero, experience: player.experience,
  level: Math.floor(player.experience / 500) + 1, achievements: player.achievements,
  seasonId: season.id, seasonRating, seasonPeakRating: active ? player.seasonPeakRating ?? 1000 : 1000,
  seasonExperience: active ? player.seasonExperience ?? 0 : 0, seasonMatches, seasonWins: active ? player.seasonWins ?? 0 : 0,
  rankTier: rankTier(seasonRating, seasonMatches),
  matchHistory: player.matchHistory.slice(-50).reverse(), controlLayout: player.controlLayout ?? null,
  })
}
const getPlayer = async (id: string) => Player.findById(id)

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }))
app.get('/api/season', (_req, res) => res.json({ season: currentSeason() }))
app.get('/api/leaderboard', async (req, res, next) => {
  const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(req.query.limit ?? 50)
  if (!parsedLimit.success) return res.status(400).json({ error: 'limit must be an integer from 1 to 100' })
  try {
    const season = currentSeason()
    const players = await Player.find({ seasonId: season.id }).sort({ seasonRating: -1, seasonWins: -1, seasonExperience: -1 }).limit(parsedLimit.data).select('username displayName seasonRating seasonPeakRating seasonExperience seasonMatches seasonWins')
    return res.json({ season, players: players.map((player, index) => ({ rank: index + 1, playerId: player.id, displayName: player.displayName, rating: player.seasonRating, peakRating: player.seasonPeakRating, seasonExperience: player.seasonExperience, matches: player.seasonMatches, wins: player.seasonWins, tier: rankTier(player.seasonRating, player.seasonMatches) })) })
  } catch (error) { next(error) }
})

app.post('/api/auth/register', validateBody(registerBody), async (req, res, next) => {
  try {
    const { username, displayName, email, password } = req.body
    const normalizedEmail = email.toLowerCase()
    const exists = await Player.exists({ $or: [{ username: username.toLowerCase() }, { email: normalizedEmail }] })
    if (exists) return res.status(409).json({ error: 'Username or email is already registered' })
    const passwordHash = await bcrypt.hash(password, 12)
    const player = await Player.create({ username, displayName, email: normalizedEmail, passwordHash })
    return res.status(201).json({ token: signToken(player.id), player: publicPlayer(player) })
  } catch (error: any) { if (error?.code === 11000) return res.status(409).json({ error: 'Username or email is already registered' }); next(error) }
})

app.post('/api/auth/login', validateBody(loginBody), async (req, res, next) => {
  try {
    const player = await Player.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash')
    if (!player || !(await bcrypt.compare(req.body.password, player.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect' })
    return res.json({ token: signToken(player.id), player: publicPlayer(player) })
  } catch (error) { next(error) }
})

app.get('/api/profile', requireAuth, async (req: AuthRequest, res, next) => {
  try { const player = await getPlayer(req.playerId!); if (!player) return res.status(404).json({ error: 'Player not found' }); return res.json({ player: publicPlayer(player) }) }
  catch (error) { next(error) }
})

app.put('/api/profile', requireAuth, validateBody(profileBody), async (req: AuthRequest, res, next) => {
  try {
    const player = await getPlayer(req.playerId!)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    if (!player.ownedHeroes.includes(req.body.selectedHero)) return res.status(403).json({ error: 'Hero is not owned' })
    player.displayName = req.body.displayName; player.selectedHero = req.body.selectedHero
    await player.save(); return res.json({ player: publicPlayer(player) })
  } catch (error) { next(error) }
})

app.put('/api/profile/control-layout', requireAuth, validateBody(layoutBody), async (req: AuthRequest, res, next) => {
  try {
    const player = await getPlayer(req.playerId!)
    if (!player) return res.status(404).json({ error: 'Player not found' })
    player.controlLayout = req.body; await player.save(); return res.json({ controlLayout: player.controlLayout })
  } catch (error) { next(error) }
})

app.post('/api/matches', requireAuth, validateBody(matchBody), (_req, res) => res.status(403).json({ error: 'Match results are recorded only by the authoritative online match server' }))

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Malformed JSON request' })
  console.error('API request failed', error)
  return res.status(500).json({ error: 'Internal server error' })
})

async function start() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) throw new Error('MONGODB_URI is required to run the account API')
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 })
  const httpServer = createServer(app)
  const io = new Server(httpServer, { cors: { origin: allowedOrigins, methods: ['GET', 'POST'] }, maxHttpBufferSize: 16 * 1024 })
  attachMultiplayer(io, async (id) => {
    const player = await Player.findById(id).select('username displayName ownedHeroes seasonId seasonRating')
    const season = currentSeason()
    return player ? { id: player.id, username: player.username, displayName: player.displayName, ownedHeroes: player.ownedHeroes, seasonId: player.seasonId, seasonRating: player.seasonId === season.id ? player.seasonRating : 1000 } satisfies OnlineIdentity : null
  }, async (identity, record) => {
    const player = await Player.findById(identity.id)
    if (!player) return
    if (player.seasonId !== record.seasonId) {
      player.seasonId = record.seasonId; player.seasonRating = 1000; player.seasonPeakRating = 1000
      player.seasonExperience = 0; player.seasonMatches = 0; player.seasonWins = 0
    }
    if (record.ranked) {
      player.seasonRating = Math.max(0, record.ratingBefore + record.ratingChange)
      player.seasonPeakRating = Math.max(player.seasonPeakRating, player.seasonRating)
      player.seasonExperience += record.seasonExperienceEarned
      player.seasonMatches += 1
      if (record.result === 'win') player.seasonWins += 1
    }
    player.matchHistory.push({ ...record, difficulty: 'online', playedAt: record.finishedAt } as never)
    player.matchHistory = player.matchHistory.slice(-100) as typeof player.matchHistory
    player.experience += record.ranked ? record.result === 'win' ? 120 : 45 : 0
    const wins = player.matchHistory.filter((match: any) => match.result === 'win').length
    const played = player.matchHistory.length
    const achievements = new Set(player.achievements)
    if (wins >= 1) achievements.add('first-victory')
    if (played >= 10) achievements.add('arena-veteran')
    if (record.result === 'win' && record.heroId === 'kai') achievements.add('astral-blade')
    if (record.result === 'win' && record.heroId === 'nyx') achievements.add('veil-dancer')
    player.achievements = [...achievements]
    await player.save()
  })
  httpServer.listen(port, '0.0.0.0', () => console.log(`KingFighter API and Socket.IO listening on port ${port}`))
}

if (process.env.NODE_ENV !== 'test') start().catch((error) => { console.error(error.message); process.exit(1) })

export { app }
