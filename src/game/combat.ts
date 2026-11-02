export type HeroStats = {
  id: string
  heroId: 'kai' | 'nyx'
  name: string
  title: string
  archetype: string
  maxHealth: number
  moveSpeed: number
  damageScale: number
  defense: number
  blockChip: number
  dodgeSpeed: number
  jumpHeight: number
  maxMana: number
  manaRegen: number
  accent: string
  secondary: string
  outfit: string
}

export type HeroId = HeroStats['heroId']
export const HERO_STATS: Record<'kai' | 'nyx' | 'ryo', HeroStats> = {
  kai: { id: 'kai', heroId: 'kai', name: 'Kai', title: 'The Wayfinder', archetype: 'Balanced Swordsman', maxHealth: 110, moveSpeed: 4.1, damageScale: 1.05, defense: 1.08, blockChip: 0.14, dodgeSpeed: 8.1, jumpHeight: 1.65, maxMana: 100, manaRegen: 5.5, accent: '#58dce8', secondary: '#d9bf7c', outfit: '#263b4b' },
  nyx: { id: 'nyx', heroId: 'nyx', name: 'Nyx', title: 'The Veil Dancer', archetype: 'Fast Assassin', maxHealth: 88, moveSpeed: 5.55, damageScale: 1.16, defense: 0.84, blockChip: 0.24, dodgeSpeed: 10.2, jumpHeight: 2.05, maxMana: 100, manaRegen: 7.2, accent: '#c08aff', secondary: '#73f0dc', outfit: '#252238' },
  // Compatibility alias for earlier Phase 1 combat fixtures.
  ryo: { id: 'ryo', heroId: 'kai', name: 'Ryo the Ashen King', title: 'Legacy Rival', archetype: 'Legacy Placeholder', maxHealth: 110, moveSpeed: 3.65, damageScale: 0.95, defense: 0.88, blockChip: 0.2, dodgeSpeed: 7.6, jumpHeight: 1.55, maxMana: 100, manaRegen: 5.5, accent: '#f18b67', secondary: '#d9bf7c', outfit: '#49313e' },
}

export type AttackDefinition = {
  name: string
  damage: number
  startup: number
  active: number
  recovery: number
  chainStart: number
  chainEnd: number
  hitbox: { forward: number; range: number; halfWidth: number; minHeight: number; maxHeight: number }
  knockback: number
  hitstun: number
}

export const LIGHT_COMBO: readonly AttackDefinition[] = [
  { name: 'Rising Cut', damage: 9, startup: 0.12, active: 0.14, recovery: 0.27, chainStart: 0.2, chainEnd: 0.49, hitbox: { forward: 0.43, range: 1.82, halfWidth: 0.72, minHeight: 0.2, maxHeight: 1.42 }, knockback: 3.4, hitstun: 0.3 },
  { name: 'Crosswind', damage: 12, startup: 0.15, active: 0.15, recovery: 0.31, chainStart: 0.24, chainEnd: 0.57, hitbox: { forward: 0.48, range: 1.98, halfWidth: 0.78, minHeight: 0.2, maxHeight: 1.56 }, knockback: 4.5, hitstun: 0.38 },
  { name: 'Astral Breaker', damage: 17, startup: 0.22, active: 0.2, recovery: 0.56, chainStart: 0, chainEnd: 0, hitbox: { forward: 0.52, range: 2.15, halfWidth: 0.88, minHeight: 0.15, maxHeight: 2.05 }, knockback: 7.2, hitstun: 0.62 },
]

export type CombatMode = 'idle' | 'attacking' | 'blocking' | 'dodging' | 'jumping' | 'stunned' | 'recovery'
export type CombatState = {
  mode: CombatMode
  modeTime: number
  attackIndex: number
  attackElapsed: number
  comboQueued: boolean
  hitboxConnected: boolean
  jumpElapsed: number
  invulnerable: number
  dashCooldown: number
}
export type CombatInput = { attackPressed?: boolean; block?: boolean; dodgePressed?: boolean; jumpPressed?: boolean; dashPressed?: boolean }

export const createCombatState = (): CombatState => ({ mode: 'idle', modeTime: 0, attackIndex: 0, attackElapsed: 0, comboQueued: false, hitboxConnected: false, jumpElapsed: 0, invulnerable: 0, dashCooldown: 0 })

export function currentAttack(state: CombatState): AttackDefinition | null {
  return state.mode === 'attacking' ? LIGHT_COMBO[state.attackIndex] ?? null : null
}

export function attackIsActive(state: CombatState): boolean {
  const attack = currentAttack(state)
  return Boolean(attack && state.attackElapsed >= attack.startup && state.attackElapsed < attack.startup + attack.active)
}

export function advanceCombat(state: CombatState, input: CombatInput, dt: number): CombatState {
  const next = { ...state, invulnerable: Math.max(0, state.invulnerable - dt), dashCooldown: Math.max(0, state.dashCooldown - dt) }
  if (state.mode === 'stunned') {
    next.modeTime = Math.max(0, state.modeTime - dt)
    if (next.modeTime === 0) next.mode = 'recovery'
    return next
  }
  if (state.mode === 'dodging' || state.mode === 'jumping' || state.mode === 'recovery') {
    next.modeTime = Math.max(0, state.modeTime - dt)
    if (state.mode === 'jumping') next.jumpElapsed += dt
    if (next.modeTime === 0) { next.mode = 'idle'; next.attackIndex = 0; next.attackElapsed = 0; next.comboQueued = false }
    return next
  }
  if (state.mode === 'attacking') {
    const attack = LIGHT_COMBO[state.attackIndex]
    if (!attack) return { ...createCombatState(), mode: 'recovery', modeTime: 0.12 }
    next.attackElapsed += dt
    if (input.attackPressed && state.attackIndex < LIGHT_COMBO.length - 1 && next.attackElapsed >= attack.chainStart && next.attackElapsed <= attack.chainEnd) next.comboQueued = true
    if (next.comboQueued && next.attackElapsed >= attack.chainEnd) {
      next.attackIndex += 1; next.attackElapsed = 0; next.comboQueued = false; next.hitboxConnected = false
      return next
    }
    if (next.attackElapsed >= attack.startup + attack.active + attack.recovery) {
      next.mode = 'recovery'; next.modeTime = 0.11; next.attackElapsed = 0
    }
    return next
  }
  if (state.mode === 'blocking') {
    if (input.block) return next
    next.mode = 'idle'
  }
  if (input.dashPressed && next.dashCooldown <= 0) return { ...next, mode: 'dodging', modeTime: 0.22, invulnerable: 0.12, dashCooldown: 1.35, attackIndex: 0, attackElapsed: 0, comboQueued: false, hitboxConnected: false }
  if (input.dodgePressed) return { ...next, mode: 'dodging', modeTime: 0.36, invulnerable: 0.25, attackIndex: 0, attackElapsed: 0, comboQueued: false, hitboxConnected: false }
  if (input.jumpPressed) return { ...next, mode: 'jumping', modeTime: 0.62, jumpElapsed: 0, attackIndex: 0, attackElapsed: 0, comboQueued: false, hitboxConnected: false }
  if (input.block) return { ...next, mode: 'blocking', attackIndex: 0, attackElapsed: 0, comboQueued: false }
  if (input.attackPressed) return { ...next, mode: 'attacking', attackIndex: 0, attackElapsed: 0, comboQueued: false, hitboxConnected: false }
  return next
}

export type CombatBody = { x: number; z: number; facing: number; elevation: number; combat: CombatState; stats: HeroStats }

/** Oriented forward hitbox against a circular ground-plane hurtbox and vertical span. */
export function hitboxOverlaps(attacker: Pick<CombatBody, 'x' | 'z' | 'facing'>, defender: Pick<CombatBody, 'x' | 'z' | 'elevation'>, box: AttackDefinition['hitbox'], hurtRadius = 0.43, hurtHeight = 1.8): boolean {
  const dx = defender.x - attacker.x
  const dz = defender.z - attacker.z
  const forward = dx * Math.sin(attacker.facing) + dz * Math.cos(attacker.facing)
  const lateral = dx * Math.cos(attacker.facing) - dz * Math.sin(attacker.facing)
  const inDepth = forward + hurtRadius >= box.forward && forward - hurtRadius <= box.range
  const inWidth = Math.abs(lateral) <= box.halfWidth + hurtRadius
  const verticalOverlap = defender.elevation < box.maxHeight && defender.elevation + hurtHeight > box.minHeight
  return inDepth && inWidth && verticalOverlap
}

export type DamageResult = { damage: number; blocked: boolean; stunned: boolean; knockbackScale: number }
export function calculateDamage(attack: AttackDefinition, attacker: Pick<CombatBody, 'stats'>, defender: Pick<CombatBody, 'stats' | 'combat'>, blockIsFacingAttacker: boolean): DamageResult {
  const blocked = defender.combat.mode === 'blocking' && blockIsFacingAttacker
  const damage = Math.max(1, Math.round(attack.damage * attacker.stats.damageScale * defender.stats.defense * (blocked ? defender.stats.blockChip : 1)))
  return { damage, blocked, stunned: !blocked, knockbackScale: blocked ? 0.18 : 1 }
}

export function blockFacesAttacker(defender: Pick<CombatBody, 'x' | 'z' | 'facing'>, attacker: Pick<CombatBody, 'x' | 'z'>, maxAngle = Math.PI * 0.38): boolean {
  const angleToAttacker = Math.atan2(attacker.x - defender.x, attacker.z - defender.z)
  const difference = Math.atan2(Math.sin(angleToAttacker - defender.facing), Math.cos(angleToAttacker - defender.facing))
  return Math.abs(difference) <= maxAngle
}
