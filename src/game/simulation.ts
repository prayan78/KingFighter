import { advanceCombat, attackIsActive, blockFacesAttacker, calculateDamage, createCombatState, currentAttack, HERO_STATS, hitboxOverlaps, type CombatInput, type CombatState, type HeroId, type HeroStats } from './combat.ts'
import { ABILITIES, advanceAbilityRuntime, calculateAbilityDamage, createAbilityRuntime, segmentTouchesPoint, tryCastAbility, type AbilityEffect, type AbilityId, type AbilityRuntime, type Projectile, type WorldPoint } from './abilities.ts'
import { decideAI, type AIDifficulty } from './ai.ts'

export type FighterState = { x: number; z: number; facing: number; health: number; hitFlash: number; elevation: number; vx: number; vz: number; aiCooldown: number; stats: HeroStats; combat: CombatState; abilities: AbilityRuntime }
export type GamePhase = 'fighting' | 'round-over' | 'match-over'
export type GameState = {
  player: FighterState; rival: FighterState; time: number; running: boolean; winner: string | null
  phase: GamePhase; difficulty: AIDifficulty; round: number; playerRounds: number; rivalRounds: number
  playerHeroId: HeroId; rivalHeroId: HeroId; roundWinner: 'player' | 'rival' | null; matchWinner: 'player' | 'rival' | null
}
export type Controls = {
  up: boolean; down: boolean; left: boolean; right: boolean; moveX: number; moveZ: number
  attack: boolean; attackPressed: boolean; block: boolean; dodge: boolean; dodgePressed: boolean
  jump: boolean; jumpPressed: boolean; dash: boolean; dashPressed: boolean
  abilityRequest?: { id: AbilityId; target: WorldPoint }
}

export const ARENA = { halfX: 8.2, halfZ: 5.1, edge: 0.72 }
const fighter = (x: number, z: number, stats: HeroStats): FighterState => ({ x, z, facing: 0, health: stats.maxHealth, hitFlash: 0, elevation: 0, vx: 0, vz: 0, aiCooldown: 0.5, stats, combat: createCombatState(), abilities: createAbilityRuntime(stats.maxMana) })
const statsFor = (heroId: HeroId) => HERO_STATS[heroId]
export const createGame = (playerStats: HeroStats = HERO_STATS.kai, rivalStats: HeroStats = HERO_STATS.ryo, difficulty: AIDifficulty = 'medium', round = 1, playerRounds = 0, rivalRounds = 0): GameState => ({
  player: fighter(-3.2, 0.25, playerStats), rival: fighter(3.2, -0.25, rivalStats), time: 90, running: true, winner: null,
  phase: 'fighting', difficulty, round, playerRounds, rivalRounds, playerHeroId: playerStats.heroId, rivalHeroId: rivalStats.heroId, roundWinner: null, matchWinner: null,
})

export function startNextRound(game: GameState): GameState {
  if (game.phase !== 'round-over') return game
  return createGame(statsFor(game.playerHeroId), statsFor(game.rivalHeroId), game.difficulty, game.round + 1, game.playerRounds, game.rivalRounds)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const face = (a: FighterState, b: FighterState) => { a.facing = Math.atan2(b.x - a.x, b.z - a.z) }
const combatInput = (controls: Partial<Controls>): CombatInput => ({ attackPressed: controls.attackPressed, block: controls.block, dodgePressed: controls.dodgePressed, jumpPressed: controls.jumpPressed, dashPressed: controls.dashPressed })
const emptyControls = (): Controls => ({ up: false, down: false, left: false, right: false, moveX: 0, moveZ: 0, attack: false, attackPressed: false, block: false, dodge: false, dodgePressed: false, jump: false, jumpPressed: false, dash: false, dashPressed: false })

function moveFighter(fighter: FighterState, other: FighterState, input: Partial<Controls>, dt: number) {
  const combat = fighter.combat
  let dx = Number(input.right) - Number(input.left) + (input.moveX ?? 0)
  let dz = Number(input.down) - Number(input.up) + (input.moveZ ?? 0)
  let length = Math.hypot(dx, dz)
  if (combat.mode === 'dodging') {
    if (!length) { dx = fighter.x - other.x; dz = fighter.z - other.z; length = Math.hypot(dx, dz) || 1 }
    fighter.vx = dx / length * fighter.stats.dodgeSpeed
    fighter.vz = dz / length * fighter.stats.dodgeSpeed
  }
  const locked = combat.mode === 'stunned' || combat.mode === 'recovery'
  const actionSpeed = combat.mode === 'attacking' ? 0.42 : combat.mode === 'blocking' ? 0.28 : combat.mode === 'jumping' ? 0.72 : 1
  if (length && !locked && combat.mode !== 'dodging') {
    const strength = Math.min(1, length)
    fighter.x += dx / length * strength * fighter.stats.moveSpeed * actionSpeed * dt
    fighter.z += dz / length * strength * fighter.stats.moveSpeed * actionSpeed * dt
  }
  fighter.x += fighter.vx * dt; fighter.z += fighter.vz * dt
  const drag = Math.exp(-9 * dt)
  fighter.vx *= drag; fighter.vz *= drag
  if (combat.mode !== 'dodging' && Math.hypot(fighter.vx, fighter.vz) < 0.08) { fighter.vx = 0; fighter.vz = 0 }
  fighter.x = clamp(fighter.x, -ARENA.halfX + ARENA.edge, ARENA.halfX - ARENA.edge)
  fighter.z = clamp(fighter.z, -ARENA.halfZ + ARENA.edge, ARENA.halfZ - ARENA.edge)
  fighter.elevation = combat.mode === 'jumping' ? Math.sin(Math.PI * clamp(combat.jumpElapsed / 0.62, 0, 1)) * fighter.stats.jumpHeight : 0
}

function deliverHit(attacker: FighterState, defender: FighterState) {
  const attack = currentAttack(attacker.combat)
  if (!attack || attacker.combat.hitboxConnected || !attackIsActive(attacker.combat) || defender.combat.invulnerable > 0) return
  if (!hitboxOverlaps(attacker, defender, attack.hitbox)) return
  attacker.combat = { ...attacker.combat, hitboxConnected: true }
  const result = calculateDamage(attack, attacker, defender, blockFacesAttacker(defender, attacker))
  defender.health = Math.max(0, defender.health - result.damage); defender.hitFlash = 0.2
  if (result.stunned) defender.combat = { ...createCombatState(), mode: 'stunned', modeTime: attack.hitstun }
  const dx = defender.x - attacker.x; const dz = defender.z - attacker.z; const distance = Math.hypot(dx, dz) || 1
  defender.vx += dx / distance * attack.knockback * result.knockbackScale; defender.vz += dz / distance * attack.knockback * result.knockbackScale
}

function abilityHit(attacker: FighterState, defender: FighterState, id: AbilityId, impactPoint: WorldPoint) {
  const ability = ABILITIES[id]
  if (defender.combat.invulnerable > 0) return
  const result = calculateAbilityDamage(ability, attacker.stats, defender, blockFacesAttacker(defender, attacker))
  defender.health = Math.max(0, defender.health - result.damage); defender.hitFlash = 0.24
  if (result.stunned) defender.combat = { ...createCombatState(), mode: 'stunned', modeTime: ability.stun }
  let dx = defender.x - impactPoint.x; let dz = defender.z - impactPoint.z; let length = Math.hypot(dx, dz)
  if (length < 0.001) { dx = defender.x - attacker.x; dz = defender.z - attacker.z; length = Math.hypot(dx, dz) || 1 }
  defender.vx += dx / length * ability.knockback * result.knockbackScale; defender.vz += dz / length * ability.knockback * result.knockbackScale
}

function resolveArea(attacker: FighterState, defender: FighterState, id: AbilityId, point: WorldPoint) {
  const radius = ABILITIES[id].areaRadius ?? 0
  if (Math.hypot(defender.x - point.x, defender.z - point.z) <= radius + 0.43 && defender.elevation < 1.35) abilityHit(attacker, defender, id, point)
}

function castFor(actor: FighterState, controls: Partial<Controls>): AbilityEffect | null {
  if (!controls.abilityRequest) return null
  const target = { x: clamp(controls.abilityRequest.target.x, -ARENA.halfX + ARENA.edge, ARENA.halfX - ARENA.edge), z: clamp(controls.abilityRequest.target.z, -ARENA.halfZ + ARENA.edge, ARENA.halfZ - ARENA.edge) }
  const cast = tryCastAbility(actor.abilities, controls.abilityRequest.id, { x: actor.x, z: actor.z }, target, actor.facing)
  if (!cast.ok) return null
  actor.abilities = cast.runtime
  return cast.effect
}

function resolveDash(actor: FighterState, target: FighterState) {
  const dash = actor.abilities.dash
  if (!dash) return
  const from = { x: actor.x, z: actor.z }
  const progress = dash.duration ? clamp(dash.elapsed / dash.duration, 0, 1) : 1
  actor.x = clamp(dash.start.x + (dash.target.x - dash.start.x) * progress, -ARENA.halfX + ARENA.edge, ARENA.halfX - ARENA.edge)
  actor.z = clamp(dash.start.z + (dash.target.z - dash.start.z) * progress, -ARENA.halfZ + ARENA.edge, ARENA.halfZ - ARENA.edge)
  if (!dash.hit && segmentTouchesPoint(from, actor, target, 0.78) && target.elevation < 1.35) {
    abilityHit(actor, target, dash.abilityId, { x: (from.x + actor.x) / 2, z: (from.z + actor.z) / 2 })
    actor.abilities.dash = { ...dash, hit: true }
  }
  if (progress >= 1) actor.abilities.dash = null
}

function resolveProjectiles(attacker: FighterState, defender: FighterState) {
  const remaining: Projectile[] = []
  for (const projectile of attacker.abilities.projectiles) {
    const hit = segmentTouchesPoint({ x: projectile.previousX, z: projectile.previousZ }, projectile, defender, projectile.radius + 0.43) && defender.elevation < 1.35
    if (hit) abilityHit(attacker, defender, projectile.abilityId, { x: projectile.x, z: projectile.z })
    else if (projectile.travelled < projectile.range) remaining.push(projectile)
  }
  attacker.abilities.projectiles = remaining
}

function finishRound(game: GameState, player: FighterState, rival: FighterState, time: number): GameState {
  const roundWinner: 'player' | 'rival' = player.health <= 0 ? 'rival' : rival.health <= 0 ? 'player' : player.health >= rival.health ? 'player' : 'rival'
  const playerRounds = game.playerRounds + Number(roundWinner === 'player')
  const rivalRounds = game.rivalRounds + Number(roundWinner === 'rival')
  const matchWinner = playerRounds >= 2 ? 'player' : rivalRounds >= 2 ? 'rival' : null
  return { ...game, player, rival, time, running: false, phase: matchWinner ? 'match-over' : 'round-over', playerRounds, rivalRounds, roundWinner, matchWinner, winner: matchWinner ? matchWinner === 'player' ? 'MATCH WON' : 'MATCH LOST' : roundWinner === 'player' ? 'ROUND WON' : 'ROUND LOST' }
}

/** Advances a match using two supplied control streams. Network servers can own both streams. */
export function stepGameWithControls(game: GameState, playerControls: Controls, rivalInput: Controls, dt: number): GameState {
  if (!game.running || game.phase !== 'fighting') return game
  const delta = Math.min(dt, 0.05)
  const p: FighterState = { ...game.player, combat: { ...game.player.combat }, abilities: advanceAbilityRuntime(game.player.abilities, delta, game.player.stats.manaRegen), hitFlash: Math.max(0, game.player.hitFlash - delta) }
  const r: FighterState = { ...game.rival, combat: { ...game.rival.combat }, abilities: advanceAbilityRuntime(game.rival.abilities, delta, game.rival.stats.manaRegen), hitFlash: Math.max(0, game.rival.hitFlash - delta), aiCooldown: Math.max(0, game.rival.aiCooldown - delta) }
  p.combat = advanceCombat(p.combat, combatInput(playerControls), delta)
  r.combat = advanceCombat(r.combat, combatInput(rivalInput), delta)
  const playerEffect = castFor(p, playerControls)
  const rivalEffect = castFor(r, rivalInput)

  moveFighter(p, r, playerControls, delta); moveFighter(r, p, rivalInput, delta)
  face(p, r); face(r, p)
  if (playerEffect?.type === 'area') resolveArea(p, r, playerEffect.abilityId, playerEffect.target)
  if (rivalEffect?.type === 'area') resolveArea(r, p, rivalEffect.abilityId, rivalEffect.target)
  resolveDash(p, r); resolveDash(r, p)
  resolveProjectiles(p, r); resolveProjectiles(r, p)
  deliverHit(p, r); deliverHit(r, p)

  const time = Math.max(0, game.time - delta)
  if (p.health <= 0 || r.health <= 0 || time <= 0) return finishRound(game, p, r, time)
  return { ...game, player: p, rival: r, time }
}

/** Framework-independent match update; the local game feeds tactical AI into the same authoritative rules. */
export function stepGame(game: GameState, controls: Controls, dt: number): GameState {
  if (!game.running || game.phase !== 'fighting') return game
  const bot = decideAI(game.rival, game.player, game.difficulty, game.time)
  const rivalInput: Controls = { ...emptyControls(), moveX: bot.moveX, moveZ: bot.moveZ, attackPressed: bot.attackPressed, block: bot.block, dodgePressed: bot.dodgePressed, dashPressed: bot.dashPressed, abilityRequest: bot.abilityRequest }
  return stepGameWithControls(game, controls, rivalInput, dt)
}
