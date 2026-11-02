import type { HeroId, HeroStats, CombatState } from './combat.ts'

export type AbilityId = 'arc-bolt' | 'rift-nova' | 'blink-step' | 'astral-cataclysm' | 'shadow-needle' | 'venom-fan' | 'umbral-step' | 'nightfall'
export type WorldPoint = { x: number; z: number }
export type AbilityDefinition = {
  id: AbilityId
  name: string
  type: 'projectile' | 'area' | 'dash'
  manaCost: number
  cooldown: number
  range: number
  damage: number
  knockback: number
  stun: number
  areaRadius?: number
  projectileSpeed?: number
  dashDuration?: number
  ultimate?: boolean
  description: string
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  'arc-bolt': { id: 'arc-bolt', name: 'Arc Bolt', type: 'projectile', manaCost: 18, cooldown: 4.5, range: 8, damage: 15, knockback: 3.2, stun: 0.32, projectileSpeed: 11, description: 'Hurl a fast astral bolt at the target.' },
  'rift-nova': { id: 'rift-nova', name: 'Rift Nova', type: 'area', manaCost: 30, cooldown: 8, range: 6, damage: 20, knockback: 4.8, stun: 0.48, areaRadius: 1.65, description: 'Detonate a close-range burst at the target point.' },
  'blink-step': { id: 'blink-step', name: 'Blink Step', type: 'dash', manaCost: 24, cooldown: 7, range: 4.6, damage: 12, knockback: 5.6, stun: 0.28, dashDuration: 0.24, description: 'Dash through the target line, staggering a rival in your path.' },
  'astral-cataclysm': { id: 'astral-cataclysm', name: 'Astral Cataclysm', type: 'area', manaCost: 72, cooldown: 28, range: 7, damage: 38, knockback: 7, stun: 0.78, areaRadius: 2.6, ultimate: true, description: 'Unleash an ultimate astral blast over a wide area.' },
  'shadow-needle': { id: 'shadow-needle', name: 'Shadow Needle', type: 'projectile', manaCost: 14, cooldown: 3.2, range: 9, damage: 13, knockback: 2.4, stun: 0.22, projectileSpeed: 15, description: 'Flick a razor-thin shard of condensed shadow.' },
  'venom-fan': { id: 'venom-fan', name: 'Venom Fan', type: 'area', manaCost: 26, cooldown: 7.2, range: 4.8, damage: 17, knockback: 2.8, stun: 0.58, areaRadius: 2, description: 'Scatter a ring of spectral blades that briefly paralyzes.' },
  'umbral-step': { id: 'umbral-step', name: 'Umbral Step', type: 'dash', manaCost: 20, cooldown: 6, range: 5.8, damage: 16, knockback: 4.2, stun: 0.36, dashDuration: 0.19, description: 'Vanish through the shade and reappear behind your mark.' },
  nightfall: { id: 'nightfall', name: 'Nightfall', type: 'area', manaCost: 68, cooldown: 25, range: 6.2, damage: 34, knockback: 5.6, stun: 0.9, areaRadius: 2.35, ultimate: true, description: 'A silent plunge that binds the arena in shadow.' },
}

export const ABILITY_ORDER: readonly AbilityId[] = ['arc-bolt', 'rift-nova', 'blink-step', 'astral-cataclysm']
export const HERO_LOADOUTS: Record<HeroId, { skills: readonly [AbilityId, AbilityId, AbilityId]; ultimate: AbilityId }> = {
  kai: { skills: ['arc-bolt', 'rift-nova', 'blink-step'], ultimate: 'astral-cataclysm' },
  nyx: { skills: ['shadow-needle', 'venom-fan', 'umbral-step'], ultimate: 'nightfall' },
}
export function abilityOrderFor(heroId: HeroId): readonly AbilityId[] { const loadout = HERO_LOADOUTS[heroId]; return [...loadout.skills, loadout.ultimate] }
export const ALL_ABILITY_IDS: readonly AbilityId[] = [...ABILITY_ORDER, 'shadow-needle', 'venom-fan', 'umbral-step', 'nightfall']
export const MAX_MANA = 100
export const MANA_REGEN_PER_SECOND = 5.5

export type Projectile = { id: number; abilityId: AbilityId; x: number; z: number; previousX: number; previousZ: number; vx: number; vz: number; radius: number; damage: number; stun: number; travelled: number; range: number }
export type AbilityRuntime = { mana: number; maxMana: number; cooldowns: Record<AbilityId, number>; projectiles: Projectile[]; bursts: { id: number; abilityId: AbilityId; x: number; z: number; radius: number; life: number; duration: number }[]; nextProjectileId: number; dash: { abilityId: AbilityId; start: WorldPoint; target: WorldPoint; elapsed: number; duration: number; hit: boolean } | null }
export type AbilityEffect = { type: 'area'; abilityId: AbilityId; target: WorldPoint } | { type: 'dash'; abilityId: AbilityId; target: WorldPoint }
export type CastFailureReason = 'cooldown' | 'mana' | 'range'
export type CastResult = { ok: true; runtime: AbilityRuntime; effect: AbilityEffect | null } | { ok: false; reason: CastFailureReason; runtime: AbilityRuntime }

export const createAbilityRuntime = (mana = MAX_MANA, maxMana = MAX_MANA): AbilityRuntime => ({ mana, maxMana, cooldowns: Object.fromEntries(ALL_ABILITY_IDS.map((id) => [id, 0])) as Record<AbilityId, number>, projectiles: [], bursts: [], nextProjectileId: 1, dash: null })

export function canCastAbility(runtime: AbilityRuntime, id: AbilityId): CastFailureReason | null {
  const ability = ABILITIES[id]
  if (runtime.cooldowns[id] > 0) return 'cooldown'
  if (runtime.mana < ability.manaCost) return 'mana'
  return null
}

export function tryCastAbility(runtime: AbilityRuntime, id: AbilityId, origin: WorldPoint, target: WorldPoint, facing: number): CastResult {
  const reason = canCastAbility(runtime, id)
  if (reason) return { ok: false, reason, runtime }
  const ability = ABILITIES[id]
  const dx = target.x - origin.x; const dz = target.z - origin.z
  const distance = Math.hypot(dx, dz)
  if (distance > ability.range + 1e-6) return { ok: false, reason: 'range', runtime }
  const next: AbilityRuntime = { ...runtime, mana: runtime.mana - ability.manaCost, cooldowns: { ...runtime.cooldowns, [id]: ability.cooldown }, projectiles: [...runtime.projectiles], bursts: [...runtime.bursts], dash: runtime.dash ? { ...runtime.dash, start: { ...runtime.dash.start }, target: { ...runtime.dash.target } } : null }
  if (ability.type === 'projectile') {
    const length = distance || 1
    const dirX = distance ? dx / length : Math.sin(facing)
    const dirZ = distance ? dz / length : Math.cos(facing)
    const speed = ability.projectileSpeed ?? 10
    next.projectiles.push({ id: next.nextProjectileId++, abilityId: id, x: origin.x, z: origin.z, previousX: origin.x, previousZ: origin.z, vx: dirX * speed, vz: dirZ * speed, radius: 0.3, damage: ability.damage, stun: ability.stun, travelled: 0, range: ability.range })
    return { ok: true, runtime: next, effect: null }
  }
  if (ability.type === 'dash') {
    const directionLength = distance || 1
    const dirX = distance ? dx / directionLength : Math.sin(facing)
    const dirZ = distance ? dz / directionLength : Math.cos(facing)
    const dashRange = Math.min(ability.range, distance || ability.range)
    next.dash = { abilityId: id, start: { ...origin }, target: { x: origin.x + dirX * dashRange, z: origin.z + dirZ * dashRange }, elapsed: 0, duration: ability.dashDuration ?? 0.24, hit: false }
    return { ok: true, runtime: next, effect: { type: 'dash', abilityId: id, target: next.dash.target } }
  }
  next.bursts.push({ id: next.nextProjectileId++, abilityId: id, x: target.x, z: target.z, radius: ability.areaRadius ?? 1, life: 0.38, duration: 0.38 })
  return { ok: true, runtime: next, effect: { type: 'area', abilityId: id, target: { ...target } } }
}

export function advanceAbilityRuntime(runtime: AbilityRuntime, dt: number, manaRegen = MANA_REGEN_PER_SECOND): AbilityRuntime {
  const cooldowns = { ...runtime.cooldowns }
  for (const id of ALL_ABILITY_IDS) cooldowns[id] = Math.max(0, cooldowns[id] - dt)
  const projectiles = runtime.projectiles.map((projectile) => ({ ...projectile, previousX: projectile.x, previousZ: projectile.z, x: projectile.x + projectile.vx * dt, z: projectile.z + projectile.vz * dt, travelled: projectile.travelled + Math.hypot(projectile.vx, projectile.vz) * dt }))
  const bursts = runtime.bursts.map((burst) => ({ ...burst, life: Math.max(0, burst.life - dt) })).filter((burst) => burst.life > 0)
  return { ...runtime, mana: Math.min(runtime.maxMana, runtime.mana + manaRegen * dt), cooldowns, projectiles, bursts, dash: runtime.dash ? { ...runtime.dash, elapsed: Math.min(runtime.dash.duration, runtime.dash.elapsed + dt) } : null }
}

export function calculateAbilityDamage(ability: AbilityDefinition, attacker: HeroStats, defender: { stats: HeroStats; combat: CombatState }, blocked: boolean): { damage: number; stunned: boolean; knockbackScale: number } {
  const guarding = blocked && defender.combat.mode === 'blocking'
  return { damage: Math.max(1, Math.round(ability.damage * attacker.damageScale * defender.stats.defense * (guarding ? defender.stats.blockChip : 1))), stunned: !guarding, knockbackScale: guarding ? 0.18 : 1 }
}

export function segmentTouchesPoint(from: WorldPoint, to: WorldPoint, point: WorldPoint, radius: number): boolean {
  const dx = to.x - from.x; const dz = to.z - from.z
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared)) : 0
  return Math.hypot(point.x - (from.x + t * dx), point.z - (from.z + t * dz)) <= radius
}
