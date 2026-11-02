import { randomInt } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { HERO_STATS, type HeroId } from '../src/game/combat.ts'
import { ABILITIES, abilityOrderFor, type AbilityId } from '../src/game/abilities.ts'
import { ARENA, createGame, startNextRound, stepGameWithControls, type Controls, type GameState } from '../src/game/simulation.ts'
import { currentSeason, matchmakingRange, ratingDelta } from './ranked.ts'

export type OnlineIdentity = { id: string; username: string; displayName: string; ownedHeroes: string[]; seasonRating?: number; seasonId?: string }
type PlayerSlot = { identity: OnlineIdentity; heroId: HeroId; socketId: string | null; ready: boolean; disconnectedAt: number | null; sequence: number; violations: number; input: Controls; rateWindow: number; rateCount: number; lastInputAt: number }
type OnlineRoom = { id: string; code: string; private: boolean; status: 'waiting' | 'playing' | 'round-break' | 'complete'; slots: [PlayerSlot, PlayerSlot?]; game: GameState | null; timer: NodeJS.Timeout | null; lastSnapshot: number; createdAt: number }

const heroSchema = z.enum(['kai', 'nyx'])
const inputSchema = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  moveX: z.number().finite().min(-1).max(1), moveZ: z.number().finite().min(-1).max(1),
  attackPressed: z.boolean(), block: z.boolean(), dodgePressed: z.boolean(), jumpPressed: z.boolean(), dashPressed: z.boolean(),
  ability: z.object({ id: z.enum(['arc-bolt','rift-nova','blink-step','astral-cataclysm','shadow-needle','venom-fan','umbral-step','nightfall']), target: z.object({ x: z.number().finite().min(-ARENA.halfX).max(ARENA.halfX), z: z.number().finite().min(-ARENA.halfZ).max(ARENA.halfZ) }).strict() }).strict().optional(),
}).strict()
const emptyInput = (): Controls => ({ up: false, down: false, left: false, right: false, moveX: 0, moveZ: 0, attack: false, attackPressed: false, block: false, dodge: false, dodgePressed: false, jump: false, jumpPressed: false, dash: false, dashPressed: false })
const code = () => randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, '0')

export function verifySocketToken(token: unknown, secret = process.env.JWT_SECRET): string | null {
  if (typeof token !== 'string' || !secret || secret.length < 32) return null
  try {
    const payload = jwt.verify(token, secret, { issuer: 'kingfighter-api', audience: 'kingfighter-client' })
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null
  } catch { return null }
}

export function attachMultiplayer(io: Server, resolveIdentity: (id: string) => Promise<OnlineIdentity | null>, onResult: (identity: OnlineIdentity, result: { result: 'win'|'loss'; heroId: HeroId; opponent: string; roundsWon: number; roundsLost: number; finishedAt: Date; ranked: boolean; seasonId: string; ratingBefore: number; ratingChange: number; seasonExperienceEarned: number }) => Promise<void>, options: { tickMs?: number; snapshotMs?: number; reconnectMs?: number; now?: () => number } = {}) {
  const tickMs = options.tickMs ?? 1000 / 60
  const snapshotMs = options.snapshotMs ?? 50
  const reconnectMs = options.reconnectMs ?? 20000
  const now = options.now ?? Date.now
  const rooms = new Map<string, OnlineRoom>()
  const playerRoom = new Map<string, string>()
  const pendingQueue: string[] = []
  let roomSequence = 0

  const slotForSocket = (socket: Socket) => {
    const roomId = playerRoom.get(socket.data.identity.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const index = room?.slots.findIndex((slot) => slot?.identity.id === socket.data.identity.id && slot?.socketId === socket.id) ?? -1
    return room && index >= 0 ? { room, slot: room.slots[index]!, side: index as 0|1 } : null
  }
  const sendState = (room: OnlineRoom) => {
    if (!room.game) return
    const payload = { roomId: room.id, code: room.code, status: room.status, players: room.slots.filter(Boolean).map((slot, index) => ({ side: index, username: slot!.identity.displayName, heroId: slot!.heroId, ready: slot!.ready, connected: Boolean(slot!.socketId) })), state: room.game }
    for (const slot of room.slots) if (slot?.socketId) io.to(slot.socketId).emit('match:state', payload)
  }
  const cleanRoom = (room: OnlineRoom) => {
    if (room.timer) clearInterval(room.timer)
    for (const slot of room.slots) if (slot) playerRoom.delete(slot.identity.id)
    rooms.delete(room.id)
  }
  const createRoom = (identity: OnlineIdentity, heroId: HeroId, isPrivate: boolean): OnlineRoom => {
    const room: OnlineRoom = { id: `online-${++roomSequence}`, code: code(), private: isPrivate, status: 'waiting', slots: [{ identity, heroId, socketId: null, ready: false, disconnectedAt: null, sequence: -1, violations: 0, input: emptyInput(), rateWindow: now(), rateCount: 0, lastInputAt: now() }], game: null, timer: null, lastSnapshot: now(), createdAt: now() }
    rooms.set(room.id, room); playerRoom.set(identity.id, room.id); return room
  }
  const addSecond = (room: OnlineRoom, identity: OnlineIdentity, heroId: HeroId) => {
    if (room.slots.length >= 2 && room.slots[1]) return false
    room.slots[1] = { identity, heroId, socketId: null, ready: false, disconnectedAt: null, sequence: -1, violations: 0, input: emptyInput(), rateWindow: now(), rateCount: 0, lastInputAt: now() }
    playerRoom.set(identity.id, room.id)
    return true
  }
  const roomInfo = (room: OnlineRoom, index: number) => ({ roomId: room.id, code: room.private ? room.code : undefined, side: index, opponent: room.slots[1 - index]?.identity.displayName ?? null })
  const notifyFound = (room: OnlineRoom) => room.slots.forEach((slot, index) => { if (slot?.socketId) io.to(slot.socketId).emit('match:found', roomInfo(room, index)) })
  const result = async (room: OnlineRoom) => {
    if (!room.game || room.status === 'complete') return
    room.status = 'complete'
    if (room.timer) clearInterval(room.timer)
    const winner = room.game.matchWinner ?? room.game.roundWinner ?? 'player'
    const finishedAt = new Date()
    for (let side = 0; side < 2; side++) {
      const own = room.slots[side]!, other = room.slots[1 - side]!
      const result = (winner === 'player' ? side === 0 : side === 1) ? 'win' : 'loss'
      const season = currentSeason(finishedAt)
      const ownSeasonRating = own.identity.seasonId === season.id ? own.identity.seasonRating ?? 1000 : 1000
      const otherSeasonRating = other.identity.seasonId === season.id ? other.identity.seasonRating ?? 1000 : 1000
      const rated = !room.private
      await onResult(own.identity, { result, heroId: own.heroId, opponent: other.identity.displayName, roundsWon: side === 0 ? room.game.playerRounds : room.game.rivalRounds, roundsLost: side === 0 ? room.game.rivalRounds : room.game.playerRounds, finishedAt, ranked: rated, seasonId: season.id, ratingBefore: ownSeasonRating, ratingChange: rated ? ratingDelta(ownSeasonRating, otherSeasonRating, result === 'win') : 0, seasonExperienceEarned: rated ? result === 'win' ? 160 : 70 : 0 }).catch((error) => console.error('Online result persistence failed:', error))
    }
    sendState(room)
    for (const slot of room.slots) if (slot?.socketId) io.to(slot.socketId).emit('match:complete', { winnerSide: winner === 'player' ? 0 : 1, playerRounds: room.game.playerRounds, rivalRounds: room.game.rivalRounds })
    setTimeout(() => cleanRoom(room), 30000).unref?.()
  }
  const tick = (room: OnlineRoom) => {
    if (room.status !== 'playing' || !room.game || room.slots.some((slot) => !slot?.socketId)) return
    for (const slot of room.slots) if (slot && now() - slot.lastInputAt > 180) slot.input = emptyInput()
    room.game = stepGameWithControls(room.game, room.slots[0].input, room.slots[1]!.input, tickMs / 1000)
    for (const slot of room.slots) if (slot) {
      slot.input.attackPressed = false; slot.input.dodgePressed = false; slot.input.jumpPressed = false; slot.input.dashPressed = false; slot.input.abilityRequest = undefined
    }
    const timestamp = now()
    if (timestamp - room.lastSnapshot >= snapshotMs) { room.lastSnapshot = timestamp; sendState(room) }
    if (room.game.phase === 'match-over') void result(room)
    else if (room.game.phase === 'round-over') {
      room.status = 'round-break'; sendState(room)
      setTimeout(() => {
        if (room.status !== 'round-break' || !room.game) return
        room.game = startNextRound(room.game); room.status = 'playing'
        for (const slot of room.slots) if (slot) slot.input = emptyInput()
        sendState(room)
      }, 2200).unref?.()
    }
  }
  const startIfReady = (room: OnlineRoom) => {
    if (!room.slots[1] || room.slots.some((slot) => !slot?.ready || !slot.socketId)) return
    room.status = 'playing'
    room.game = createGame(HERO_STATS[room.slots[0].heroId], HERO_STATS[room.slots[1].heroId], 'medium')
    for (const slot of room.slots) if (slot) slot.input = emptyInput()
    sendState(room)
    room.timer = setInterval(() => tick(room), tickMs)
    room.timer.unref?.()
  }

  io.use(async (socket, next) => {
    const identityId = verifySocketToken(socket.handshake.auth?.token)
    if (!identityId) return next(new Error('Unauthorized'))
    try {
      const identity = await resolveIdentity(identityId)
      if (!identity) return next(new Error('Player account not found'))
      socket.data.identity = identity
      next()
    } catch { next(new Error('Authentication unavailable')) }
  })

  io.on('connection', (socket: Socket) => {
    const identity = socket.data.identity as OnlineIdentity
    let lobbyWindow = now()
    let lobbyAttempts = 0
    const allowLobbyAction = () => {
      const time = now()
      if (time - lobbyWindow >= 60000) { lobbyWindow = time; lobbyAttempts = 0 }
      if (++lobbyAttempts > 12) { socket.emit('server:input-rejected', { reason: 'lobby-rate-limit' }); return false }
      return true
    }
    const priorRoomId = playerRoom.get(identity.id)
    const priorRoom = priorRoomId ? rooms.get(priorRoomId) : undefined
    if (priorRoom) {
      const index = priorRoom.slots.findIndex((slot) => slot?.identity.id === identity.id)
      if (index >= 0) {
        const slot = priorRoom.slots[index]!
        if (slot.socketId && slot.socketId !== socket.id) io.sockets.sockets.get(slot.socketId)?.disconnect(true)
        slot.socketId = socket.id; slot.disconnectedAt = null
        socket.emit('match:reconnected', roomInfo(priorRoom, index))
        if (priorRoom.status === 'waiting') {
          if (priorRoom.slots[1]) {
            notifyFound(priorRoom)
            const ready = priorRoom.slots.map((player) => Boolean(player?.ready))
            for (const player of priorRoom.slots) if (player?.socketId) io.to(player.socketId).emit('player:readiness', ready)
            startIfReady(priorRoom)
          } else socket.emit('matchmaking:waiting', roomInfo(priorRoom, index))
        }
        sendState(priorRoom)
        if (priorRoom.status === 'playing' && priorRoom.slots.every((player) => player?.socketId)) {
          for (const player of priorRoom.slots) if (player?.socketId) io.to(player.socketId).emit('match:resumed', { roomId: priorRoom.id })
          if (!priorRoom.timer) { priorRoom.timer = setInterval(() => tick(priorRoom), tickMs); priorRoom.timer.unref?.() }
        }
      }
    }

    socket.on('matchmaking:join', (data: unknown, ack?: (result: unknown) => void) => {
      if (!allowLobbyAction()) return ack?.({ error: 'Too many room requests. Try again shortly.' })
      const parsed = z.object({ heroId: heroSchema }).strict().safeParse(data)
      if (!parsed.success || !identity.ownedHeroes.includes(parsed.data.heroId)) return ack?.({ error: 'Invalid or unowned hero' })
      if (playerRoom.has(identity.id)) return ack?.({ error: 'Already in a room' })
      const rating = identity.seasonId === currentSeason().id ? identity.seasonRating ?? 1000 : 1000
      const waitingCandidates = pendingQueue.map((id) => rooms.get(id)).filter((room) => room?.status === 'waiting' && !room.private && room.slots.length === 1 && room.slots[0].identity.id !== identity.id)
        .map((room) => ({ room: room!, difference: Math.abs((room!.slots[0].identity.seasonId === currentSeason().id ? room!.slots[0].identity.seasonRating ?? 1000 : 1000) - rating), allowed: matchmakingRange(now() - room!.createdAt) }))
        .filter((candidate) => candidate.difference <= candidate.allowed)
        .sort((a, b) => a.difference - b.difference)
      const waiting = waitingCandidates[0]?.room
      let room: OnlineRoom
      if (waiting) { room = waiting; addSecond(room, identity, parsed.data.heroId); pendingQueue.splice(pendingQueue.indexOf(room.id), 1) }
      else { room = createRoom(identity, parsed.data.heroId, false); pendingQueue.push(room.id) }
      room.slots[waiting ? 1 : 0]!.socketId = socket.id
      if (waiting) notifyFound(room)
      else socket.emit('matchmaking:waiting', roomInfo(room, 0))
      ack?.({ roomId: room.id, status: waiting ? 'found' : 'waiting' })
    })

    socket.on('room:create', (data: unknown, ack?: (result: unknown) => void) => {
      if (!allowLobbyAction()) return ack?.({ error: 'Too many room requests. Try again shortly.' })
      const parsed = z.object({ heroId: heroSchema }).strict().safeParse(data)
      if (!parsed.success || !identity.ownedHeroes.includes(parsed.data.heroId)) return ack?.({ error: 'Invalid or unowned hero' })
      if (playerRoom.has(identity.id)) return ack?.({ error: 'Already in a room' })
      const room = createRoom(identity, parsed.data.heroId, true); room.slots[0].socketId = socket.id
      socket.emit('matchmaking:waiting', roomInfo(room, 0)); ack?.({ roomId: room.id, code: room.code })
    })

    socket.on('room:join', (data: unknown, ack?: (result: unknown) => void) => {
      if (!allowLobbyAction()) return ack?.({ error: 'Too many room requests. Try again shortly.' })
      const parsed = z.object({ code: z.string().trim().regex(/^[A-Z0-9]{6}$/), heroId: heroSchema }).strict().safeParse(data)
      if (!parsed.success || !identity.ownedHeroes.includes(parsed.data.heroId)) return ack?.({ error: 'Invalid room or unowned hero' })
      if (playerRoom.has(identity.id)) return ack?.({ error: 'Already in a room' })
      const room = [...rooms.values()].find((candidate) => candidate.private && candidate.code === parsed.data.code && candidate.status === 'waiting')
      if (!room || !addSecond(room, identity, parsed.data.heroId)) return ack?.({ error: 'Room not found or already full' })
      room.slots[1]!.socketId = socket.id; notifyFound(room); ack?.({ roomId: room.id, status: 'found' })
    })

    socket.on('player:ready', (data: unknown) => {
      const parsed = z.object({ ready: z.boolean() }).strict().safeParse(data)
      const found = slotForSocket(socket)
      if (!parsed.success || !found || found.room.status !== 'waiting') return
      found.slot.ready = parsed.data.ready
      for (const slot of found.room.slots) if (slot?.socketId) io.to(slot.socketId).emit('player:readiness', found.room.slots.map((player) => Boolean(player?.ready)))
      startIfReady(found.room)
    })

    socket.on('room:leave', () => {
      const found = slotForSocket(socket)
      if (!found || !['waiting', 'complete'].includes(found.room.status)) return
      for (const slot of found.room.slots) if (slot?.socketId && slot.socketId !== socket.id) io.to(slot.socketId).emit('matchmaking:cancelled')
      const queueIndex = pendingQueue.indexOf(found.room.id)
      if (queueIndex >= 0) pendingQueue.splice(queueIndex, 1)
      cleanRoom(found.room)
      socket.emit('matchmaking:cancelled')
    })

    socket.on('player:input', (data: unknown) => {
      const found = slotForSocket(socket)
      if (!found || found.room.status !== 'playing' || !found.room.game) return
      const parsed = inputSchema.safeParse(data)
      const { slot, room, side } = found
      const reject = (reason: string) => { slot.violations += 1; socket.emit('server:input-rejected', { reason, violations: slot.violations }); if (slot.violations >= 10) socket.disconnect(true) }
      if (!parsed.success) { reject('invalid-input'); return }
      const currentGame = room.game
      if (!currentGame) return
      const packet = parsed.data
      if (packet.sequence <= slot.sequence) return
      if (packet.sequence - slot.sequence > 500) { reject('sequence-jump'); return }
      const timestamp = now()
      if (timestamp - slot.rateWindow >= 1000) { slot.rateWindow = timestamp; slot.rateCount = 0 }
      if (++slot.rateCount > 35) { reject('rate-limit'); return }
      const fighter = side === 0 ? currentGame.player : currentGame.rival
      const ownAbilities = abilityOrderFor(fighter.stats.heroId)
      if (packet.ability && (!ownAbilities.includes(packet.ability.id as AbilityId) || packet.ability.target.x < -ARENA.halfX + ARENA.edge || packet.ability.target.x > ARENA.halfX - ARENA.edge || packet.ability.target.z < -ARENA.halfZ + ARENA.edge || packet.ability.target.z > ARENA.halfZ - ARENA.edge)) {
        reject('invalid-ability'); return
      }
      slot.sequence = packet.sequence
      slot.lastInputAt = timestamp
      slot.input = { ...slot.input, up: false, down: false, left: false, right: false, moveX: packet.moveX, moveZ: packet.moveZ, attackPressed: packet.attackPressed, attack: packet.attackPressed, block: packet.block, dodgePressed: packet.dodgePressed, jumpPressed: packet.jumpPressed, dashPressed: packet.dashPressed, abilityRequest: packet.ability ? { id: packet.ability.id as AbilityId, target: packet.ability.target } : undefined }
    })

    socket.on('disconnect', () => {
      for (const room of rooms.values()) {
        const slot = room.slots.find((player) => player?.identity.id === identity.id)
        if (!slot || slot.socketId !== socket.id) continue
        slot.socketId = null; slot.disconnectedAt = now()
        if (room.timer) { clearInterval(room.timer); room.timer = null }
        for (const player of room.slots) if (player?.socketId) io.to(player.socketId).emit('match:opponent-disconnected', { reconnectMs })
        const disconnectedAt = slot.disconnectedAt
        setTimeout(() => {
          if (slot.disconnectedAt !== disconnectedAt) return
          if (room.game && (room.status === 'playing' || room.status === 'round-break')) {
            const winner = room.slots[0] === slot ? 'rival' : 'player'
            const playerRounds = winner === 'player' ? 2 : Math.min(1, room.game.playerRounds)
            const rivalRounds = winner === 'rival' ? 2 : Math.min(1, room.game.rivalRounds)
            room.game = { ...room.game, running: false, phase: 'match-over', matchWinner: winner, roundWinner: winner, playerRounds, rivalRounds, winner: winner === 'player' ? 'MATCH WON' : 'MATCH LOST' }
            void result(room)
          } else cleanRoom(room)
        }, reconnectMs).unref?.()
        break
      }
    })
  })

  return { rooms, stop: () => { for (const room of rooms.values()) cleanRoom(room); io.removeAllListeners('connection') } }
}
