import { attackIsActive, currentAttack, type HeroStats } from './combat.ts'
import { ABILITIES, canCastAbility, HERO_LOADOUTS, type AbilityId } from './abilities.ts'
import type { FighterState } from './simulation.ts'

export type AIDifficulty = 'easy' | 'medium' | 'hard'
export type AIIntent = { moveX: number; moveZ: number; attackPressed: boolean; block: boolean; dodgePressed: boolean; dashPressed: boolean; abilityRequest?: { id: AbilityId; target: { x: number; z: number } } }

const PROFILES: Record<AIDifficulty, { reaction: number; aggression: number; defense: number; abilityUse: number }> = {
  easy: { reaction: 0.3, aggression: 0.52, defense: 0.15, abilityUse: 0 },
  medium: { reaction: 0.68, aggression: 0.72, defense: 0.58, abilityUse: 0.62 },
  hard: { reaction: 1, aggression: 0.92, defense: 0.92, abilityUse: 1 },
}

function normalized(x: number, z: number) { const length = Math.hypot(x, z) || 1; return { x: x / length, z: z / length } }

function chooseAbility(self: FighterState, enemy: FighterState, distance: number, difficulty: AIDifficulty, enemyHealthRatio: number): AbilityId | null {
  const profile = PROFILES[difficulty]
  if (profile.abilityUse === 0 || self.abilities.mana < 14) return null
  const loadout = HERO_LOADOUTS[self.stats.heroId]
  const attackWarning = Boolean(currentAttack(enemy.combat) && enemy.combat.attackElapsed < (currentAttack(enemy.combat)?.startup ?? 0))
  const options: Array<{ id: AbilityId; score: number }> = []
  for (const id of loadout.skills) {
    const ability = ABILITIES[id]
    if (canCastAbility(self.abilities, id)) continue
    if (distance > ability.range || distance < 0.65) continue
    let score = 0
    if (ability.type === 'projectile') score = distance > 2 ? 2.1 + distance / 10 : 0.35
    if (ability.type === 'area') score = distance <= (ability.areaRadius ?? 0) + 1.2 ? 2.5 : distance < ability.range * 0.55 ? 1.6 : 0.2
    if (ability.type === 'dash') score = distance > 1.8 && distance < ability.range ? 2.2 + (self.stats.heroId === 'nyx' ? 0.55 : 0) : 0.3
    if (attackWarning && ability.type === 'dash') score += 0.6
    if (self.health / self.stats.maxHealth < 0.3 && ability.type === 'area') score += 0.4
    options.push({ id, score })
  }
  const ultimate = loadout.ultimate
  const ult = ABILITIES[ultimate]
  if (!canCastAbility(self.abilities, ultimate) && distance <= ult.range) {
    let score = enemyHealthRatio < 0.48 ? 4.8 : distance <= (ult.areaRadius ?? 0) + 1 ? 3.15 : 0.4
    if (attackWarning) score += 0.7
    options.push({ id: ultimate, score })
  }
  options.sort((a, b) => b.score - a.score)
  const best = options[0]
  if (!best || best.score < (difficulty === 'hard' ? 1.9 : 2.8)) return null
  return best.id
}

/** Deterministic tactical policy driven by spacing, health, active threats, and ready abilities. */
export function decideAI(self: FighterState, enemy: FighterState, difficulty: AIDifficulty, matchTime: number): AIIntent {
  const profile = PROFILES[difficulty]
  const dx = enemy.x - self.x; const dz = enemy.z - self.z
  const distance = Math.hypot(dx, dz) || 0.001
  const toward = normalized(dx, dz)
  const perpendicular = { x: -toward.z, z: toward.x }
  const preferred = self.stats.heroId === 'nyx' ? 2.2 : 1.55
  const intent: AIIntent = { moveX: 0, moveZ: 0, attackPressed: false, block: false, dodgePressed: false, dashPressed: false }

  if (distance > preferred + 0.28) { intent.moveX = toward.x; intent.moveZ = toward.z }
  else if (distance < preferred - 0.75 && difficulty !== 'easy') { intent.moveX = -toward.x * 0.72; intent.moveZ = -toward.z * 0.72 }
  else if (difficulty === 'hard' && self.combat.mode === 'idle') { const orbit = Math.sin(matchTime * 3) > 0 ? 0.22 : -0.22; intent.moveX = perpendicular.x * orbit; intent.moveZ = perpendicular.z * orbit }

  const selfHealth = self.health / self.stats.maxHealth
  const enemyHealth = enemy.health / enemy.stats.maxHealth
  const enemyAttack = currentAttack(enemy.combat)
  const enemyThreatened = Boolean(enemyAttack && distance <= enemyAttack.hitbox.range + 0.5)
  const warning = Boolean(enemyAttack && enemy.combat.attackElapsed < enemyAttack.startup && distance < 2.6)
  const activeThreat = enemyThreatened && attackIsActive(enemy.combat)

  if (warning && profile.defense > 0.45 && self.combat.mode === 'idle' && ((Math.floor(matchTime * 7) % 10) / 10) < profile.reaction) intent.block = true
  if (activeThreat && profile.defense > 0.72 && self.combat.mode === 'idle' && self.combat.dashCooldown <= 0 && (selfHealth < 0.62 || enemyAttack!.damage >= 12)) intent.dashPressed = true
  else if (activeThreat && profile.defense > 0.86 && self.combat.mode === 'idle' && (Math.floor(matchTime * 11) % 10) / 10 < profile.reaction) intent.dodgePressed = true

  const ownAttack = currentAttack(self.combat)
  if (self.combat.mode === 'attacking' && ownAttack && self.combat.attackIndex < 2 && self.combat.attackElapsed >= ownAttack.chainStart && self.combat.attackElapsed <= ownAttack.chainEnd && distance < ownAttack.hitbox.range + 0.5) intent.attackPressed = true
  const enemyRecovering = enemy.combat.mode === 'stunned' || enemy.combat.mode === 'recovery' || enemy.combat.mode === 'attacking' && enemyAttack && enemy.combat.attackElapsed > enemyAttack.startup + enemyAttack.active
  if ((self.combat.mode === 'idle' || self.combat.mode === 'blocking') && distance <= 2.05 && (enemyRecovering || difficulty === 'easy' || enemy.combat.mode !== 'blocking') && ((Math.floor(matchTime * 5) % 10) / 10) < profile.aggression) intent.attackPressed = true

  const ability = chooseAbility(self, enemy, distance, difficulty, enemyHealth)
  if (ability && self.combat.mode === 'idle' && !intent.dashPressed && !intent.block) intent.abilityRequest = { id: ability, target: { x: enemy.x, z: enemy.z } }
  return intent
}

export function heroTacticalRange(stats: HeroStats): number { return stats.heroId === 'nyx' ? 2.2 : 1.55 }
