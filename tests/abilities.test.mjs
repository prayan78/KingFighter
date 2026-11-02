import test from 'node:test'
import assert from 'node:assert/strict'
import { ABILITIES, advanceAbilityRuntime, calculateAbilityDamage, canCastAbility, createAbilityRuntime, segmentTouchesPoint, tryCastAbility } from '../src/game/abilities.ts'
import { createCombatState, HERO_STATS } from '../src/game/combat.ts'
import { createGame, stepGame } from '../src/game/simulation.ts'

test('casting spends mana, starts only that ability cooldown, and rejects cooldown, mana, and range failures', () => {
  const runtime = createAbilityRuntime()
  const cast = tryCastAbility(runtime, 'arc-bolt', { x: 0, z: 0 }, { x: 0, z: 4 }, 0)
  assert.equal(cast.ok, true)
  assert.equal(cast.runtime.mana, 82)
  assert.equal(cast.runtime.cooldowns['arc-bolt'], ABILITIES['arc-bolt'].cooldown)
  assert.equal(cast.runtime.cooldowns['rift-nova'], 0)
  assert.equal(canCastAbility(cast.runtime, 'arc-bolt'), 'cooldown')
  assert.deepEqual(tryCastAbility(cast.runtime, 'arc-bolt', { x: 0, z: 0 }, { x: 0, z: 4 }, 0), { ok: false, reason: 'cooldown', runtime: cast.runtime })
  assert.equal(tryCastAbility(createAbilityRuntime(4), 'arc-bolt', { x: 0, z: 0 }, { x: 0, z: 4 }, 0).reason, 'mana')
  assert.equal(tryCastAbility(runtime, 'arc-bolt', { x: 0, z: 0 }, { x: 0, z: 9 }, 0).reason, 'range')
})

test('projectile, area and dash skills create their configured effects', () => {
  const origin = { x: 1, z: 2 }
  const projectile = tryCastAbility(createAbilityRuntime(), 'arc-bolt', origin, { x: 1, z: 5 }, 0)
  assert.equal(projectile.ok, true)
  assert.equal(projectile.runtime.projectiles.length, 1)
  assert.ok(projectile.runtime.projectiles[0].vz > 0)
  const traveled = advanceAbilityRuntime(projectile.runtime, 0.2)
  assert.ok(traveled.projectiles[0].z > 2)

  const area = tryCastAbility(createAbilityRuntime(), 'rift-nova', origin, { x: 2, z: 3 }, 0)
  assert.equal(area.ok, true)
  assert.deepEqual(area.effect, { type: 'area', abilityId: 'rift-nova', target: { x: 2, z: 3 } })
  assert.equal(area.runtime.bursts.length, 1)

  const dash = tryCastAbility(createAbilityRuntime(), 'blink-step', origin, { x: 1, z: 5 }, 0)
  assert.equal(dash.ok, true)
  assert.deepEqual(dash.effect, { type: 'dash', abilityId: 'blink-step', target: { x: 1, z: 5 } })
  assert.deepEqual(dash.runtime.dash.start, origin)
})

test('ability damage respects configured hero damage, defense, and blocking', () => {
  const ability = ABILITIES['astral-cataclysm']
  const defender = { stats: HERO_STATS.ryo, combat: createCombatState() }
  assert.equal(calculateAbilityDamage(ability, HERO_STATS.kai, defender, false).damage, 35)
  const guarding = { ...defender, combat: { ...defender.combat, mode: 'blocking' } }
  const block = calculateAbilityDamage(ability, HERO_STATS.kai, guarding, true)
  assert.equal(block.damage, 7)
  assert.equal(block.stunned, false)
  assert.equal(block.knockbackScale, 0.18)
})

test('swept projectile collision catches targets between frames', () => {
  assert.equal(segmentTouchesPoint({ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0.2, z: 1 }, 0.3), true)
  assert.equal(segmentTouchesPoint({ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 1, z: 1 }, 0.3), false)
})

const noInput = { up: false, down: false, left: false, right: false, attack: false, attackPressed: false, block: false, dodge: false, dodgePressed: false, jump: false, jumpPressed: false }

test('simulation resolves projectile hits and consumes ability resources', () => {
  const game = createGame()
  game.player.x = 0; game.player.z = 0
  game.rival.x = 0; game.rival.z = 1.3
  let next = stepGame(game, { ...noInput, abilityRequest: { id: 'arc-bolt', target: { x: 0, z: 5 } } }, 0.05)
  for (let i = 0; i < 4; i += 1) next = stepGame(next, noInput, 0.05)
  assert.ok(next.rival.health < game.rival.health)
  assert.equal(next.player.abilities.cooldowns['arc-bolt'] > 0, true)
  assert.ok(next.player.abilities.mana < game.player.abilities.mana)
})

test('simulation resolves area damage and moves blink dash to its target', () => {
  const game = createGame()
  game.player.x = 0; game.player.z = 0
  game.rival.x = 0; game.rival.z = 1.2
  let next = stepGame(game, { ...noInput, abilityRequest: { id: 'rift-nova', target: { x: 0, z: 1.2 } } }, 0.05)
  assert.ok(next.rival.health < game.rival.health)

  const dashGame = createGame()
  dashGame.player.x = 0; dashGame.player.z = 0
  dashGame.rival.x = 6; dashGame.rival.z = 0
  next = stepGame(dashGame, { ...noInput, abilityRequest: { id: 'blink-step', target: { x: 0, z: 4 } } }, 0.05)
  for (let i = 0; i < 5; i += 1) next = stepGame(next, noInput, 0.05)
  assert.ok(next.player.z > 3.5)
  assert.equal(next.player.abilities.dash, null)
})
