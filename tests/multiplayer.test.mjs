import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { io as createClient } from 'socket.io-client'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = 'integration-test-secret-that-is-long-enough-for-jwt'
const { attachMultiplayer } = await import('../server/multiplayer.ts')

const identities = [
  { id: 'player-a', username: 'a', displayName: 'Player A', ownedHeroes: ['kai', 'nyx'] },
  { id: 'player-b', username: 'b', displayName: 'Player B', ownedHeroes: ['kai', 'nyx'] },
]
const tokenFor = (id) => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '2m', issuer: 'kingfighter-api', audience: 'kingfighter-client' })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function until(emitter, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)) }, timeout)
    const handler = (value) => { if (!predicate(value)) return; clearTimeout(timer); emitter.off(event, handler); resolve(value) }
    emitter.on(event, handler)
  })
}
async function fixture() {
  const http = createServer()
  const io = new Server(http, { cors: { origin: '*' } })
  const records = []
  const service = attachMultiplayer(io, async (id) => identities.find((player) => player.id === id) ?? null, async (player, match) => records.push({ playerId: player.id, ...match }), { reconnectMs: 2000 })
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${http.address().port}`
  const clients = identities.map((identity) => createClient(url, { auth: { token: tokenFor(identity.id) }, transports: ['websocket'], reconnection: false }))
  await Promise.all(clients.map((client) => until(client, 'connect')))
  return { http, io, service, records, clients, url }
}
async function close(f) {
  for (const client of f.clients) client.disconnect()
  f.service.stop()
  await new Promise((resolve) => f.io.close(resolve))
  if (f.http.listening) await new Promise((resolve) => f.http.close(resolve))
}
const input = (sequence, changes = {}) => ({ sequence, moveX: 0, moveZ: 0, attackPressed: false, block: false, dodgePressed: false, jumpPressed: false, dashPressed: false, ...changes })
function emitInputWithLatency(client, packet, latencyMs = 65) { setTimeout(() => client.emit('player:input', packet), latencyMs) }

test('two authenticated clients ready up, exchange server-simulated combat under latency, and cannot submit damage', async (t) => {
  const f = await fixture(); t.after(() => close(f))
  const [a, b] = f.clients
  const foundA = until(a, 'matchmaking:waiting')
  a.emit('matchmaking:join', { heroId: 'kai' })
  const infoA = await foundA
  const foundB = until(b, 'match:found')
  const foundForA = until(a, 'match:found')
  b.emit('matchmaking:join', { heroId: 'nyx' })
  const roomB = await foundB
  await foundForA
  assert.equal(roomB.side, 1)
  const stateA = until(a, 'match:state', (packet) => packet.status === 'playing')
  const stateB = until(b, 'match:state', (packet) => packet.status === 'playing')
  a.emit('player:ready', { ready: true }); b.emit('player:ready', { ready: true })
  let [packetA] = await Promise.all([stateA, stateB])
  let latest
  a.on('match:state', (packet) => { latest = packet })

  // 65 ms client-side uplink delay; the room advances only on fixed server ticks.
  let seqA = 0; let seqB = 0
  const moveUntil = Date.now() + 620
  while (Date.now() < moveUntil) {
    emitInputWithLatency(a, input(++seqA, { moveX: 1 }))
    emitInputWithLatency(b, input(++seqB, { moveX: -1 }))
    await delay(50)
  }
  emitInputWithLatency(a, input(++seqA)); emitInputWithLatency(b, input(++seqB))
  await delay(180)
  assert.ok(latest?.state, 'server should continue publishing authoritative snapshots')
  const startDistance = Math.hypot(packetA.state.player.x - packetA.state.rival.x, packetA.state.player.z - packetA.state.rival.z)
  const closeDistance = Math.hypot(latest.state.player.x - latest.state.rival.x, latest.state.player.z - latest.state.rival.z)
  assert.ok(closeDistance < startDistance, 'bounded input should move both fighters toward each other')

  const healthBeforeAttack = latest.state.rival.health
  const attackUntil = Date.now() + 1800
  while (Date.now() < attackUntil) {
    emitInputWithLatency(a, input(++seqA, { attackPressed: true }))
    await delay(100)
  }
  await delay(180)
  assert.ok(latest.state.rival.health < healthBeforeAttack, `server combat should synchronize damage from valid attacks (health ${healthBeforeAttack}->${latest.state.rival.health}, distance ${Math.hypot(latest.state.player.x-latest.state.rival.x,latest.state.player.z-latest.state.rival.z).toFixed(2)}, mode ${latest.state.player.combat.mode}, elapsed ${latest.state.player.combat.attackElapsed.toFixed(2)})`)

  const rejected = until(a, 'server:input-rejected')
  a.emit('player:input', { ...input(++seqA), damage: 999, result: 'win' })
  assert.equal((await rejected).reason, 'invalid-input')

  const beforeMana = latest.state.player.abilities.mana
  const castState = until(a, 'match:state', (packet) => packet.state.player.abilities.cooldowns['arc-bolt'] > 0)
  emitInputWithLatency(a, input(++seqA, { ability: { id: 'arc-bolt', target: { x: latest.state.rival.x, z: latest.state.rival.z } } }))
  latest = await castState
  assert.ok(latest.state.player.abilities.mana < beforeMana, 'the server should charge mana for an accepted ability')
  const castMana = latest.state.player.abilities.mana
  for (let i = 0; i < 5; i++) { emitInputWithLatency(a, input(++seqA, { ability: { id: 'arc-bolt', target: { x: latest.state.rival.x, z: latest.state.rival.z } } })); await delay(80) }
  await delay(120)
  assert.ok(latest.state.player.abilities.mana > castMana - 2, 'cooldown validation should prevent repeated casts from charging mana')
  a.emit('match:result', { result: 'win', roundsWon: 2, roundsLost: 0 })
  await delay(30)
  assert.equal(f.records.length, 0, 'no result should be recorded from client-supplied fields')
})

test('private rooms enforce readiness and a reconnect resumes the authoritative match slot', async (t) => {
  const f = await fixture(); t.after(() => close(f))
  const [a, b] = f.clients
  const created = new Promise((resolve) => a.emit('room:create', { heroId: 'kai' }, resolve))
  const privateInfo = await created
  assert.match(privateInfo.code, /^[A-Z0-9]{6}$/)
  const foundA = until(a, 'match:found'); const foundB = until(b, 'match:found')
  b.emit('room:join', { code: privateInfo.code, heroId: 'nyx' })
  const [aInfo, bInfo] = await Promise.all([foundA, foundB])
  assert.equal(aInfo.side, 0); assert.equal(bInfo.side, 1)
  const started = until(a, 'match:state', (packet) => packet.status === 'playing')
  const startedB = until(b, 'match:state', (packet) => packet.status === 'playing')
  a.emit('player:ready', { ready: true }); b.emit('player:ready', { ready: true })
  await Promise.all([started, startedB])
  b.disconnect()
  await until(a, 'match:opponent-disconnected')
  const replacement = createClient(f.url, { auth: { token: tokenFor('player-b') }, transports: ['websocket'], reconnection: false })
  f.clients[1] = replacement
  const resumed = until(replacement, 'match:reconnected')
  const resumedMatch = until(replacement, 'match:resumed')
  await until(replacement, 'connect')
  assert.equal((await resumed).side, 1)
  assert.ok((await resumedMatch).roomId)
  await until(a, 'match:resumed')
  const completed = until(a, 'match:complete')
  replacement.disconnect()
  assert.equal((await completed).winnerSide, 0, 'the server should award a reconnect-timeout forfeit to the connected player')
  assert.deepEqual(f.records.map((record) => record.result).sort(), ['loss', 'win'])
})
