import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceCombat, attackIsActive, calculateDamage, createCombatState, hitboxOverlaps, HERO_STATS, LIGHT_COMBO } from '../src/game/combat.ts'
import { createGame, stepGameWithControls } from '../src/game/simulation.ts'

test('attack hitbox is inactive during startup, active in its window, then inactive', () => {
  let combat = advanceCombat(createCombatState(), { attackPressed: true }, 0)
  assert.equal(attackIsActive(combat), false)
  combat = advanceCombat(combat, {}, 0.12)
  assert.equal(attackIsActive(combat), true)
  combat = advanceCombat(combat, {}, 0.14)
  assert.equal(attackIsActive(combat), false)
})

test('three-hit combo queues the next strike only from its timing window', () => {
  let combat = advanceCombat(createCombatState(), { attackPressed: true }, 0)
  combat = advanceCombat(combat, {}, 0.21)
  combat = advanceCombat(combat, { attackPressed: true }, 0.01)
  assert.equal(combat.comboQueued, true)
  combat = advanceCombat(combat, {}, 0.28)
  assert.equal(combat.attackIndex, 1)
  combat = advanceCombat(combat, {}, 0.24)
  combat = advanceCombat(combat, { attackPressed: true }, 0.01)
  combat = advanceCombat(combat, {}, 0.33)
  assert.equal(combat.attackIndex, 2)
  assert.equal(combat.mode, 'attacking')
})

test('combo input outside the chain window is ignored and attack recovers', () => {
  let combat = advanceCombat(createCombatState(), { attackPressed: true }, 0)
  combat = advanceCombat(combat, {}, 0.51)
  combat = advanceCombat(combat, { attackPressed: true }, 0.01)
  assert.equal(combat.comboQueued, false)
  combat = advanceCombat(combat, {}, 0.02)
  assert.equal(combat.mode, 'recovery')
})

test('oriented hitbox overlaps in front, but rejects side, rear, distant, and airborne hurtboxes', () => {
  const attacker = { x: 0, z: 0, facing: 0 }
  const box = LIGHT_COMBO[0].hitbox
  assert.equal(hitboxOverlaps(attacker, { x: 0, z: 1.2, elevation: 0 }, box), true)
  assert.equal(hitboxOverlaps(attacker, { x: 2.1, z: 1.2, elevation: 0 }, box), false)
  assert.equal(hitboxOverlaps(attacker, { x: 0, z: -1, elevation: 0 }, box), false)
  assert.equal(hitboxOverlaps(attacker, { x: 0, z: 3, elevation: 0 }, box), false)
  assert.equal(hitboxOverlaps(attacker, { x: 0, z: 1.2, elevation: 2 }, box), false)
})

test('damage applies hero attack and defense stats; a facing block reduces chip and knockback', () => {
  const attack = LIGHT_COMBO[0]
  const kai = { stats: HERO_STATS.kai }
  const ryo = { stats: HERO_STATS.ryo, combat: { ...createCombatState(), mode: 'idle' } }
  const normal = calculateDamage(attack, kai, ryo, true)
  assert.equal(normal.damage, 8)
  assert.equal(normal.stunned, true)
  const blocked = calculateDamage(attack, kai, { ...ryo, combat: { ...ryo.combat, mode: 'blocking' } }, true)
  assert.equal(blocked.damage, 2)
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.stunned, false)
  assert.equal(blocked.knockbackScale, 0.18)
  const rearHit = calculateDamage(attack, kai, { ...ryo, combat: { ...ryo.combat, mode: 'blocking' } }, false)
  assert.equal(rearHit.damage, normal.damage)
})

test('two-control simulation delivers one hit per strike, applies damage, and stuns the target', () => {
  const game = createGame()
  game.player.x = 0; game.player.z = 0
  game.rival.x = 0; game.rival.z = 1.2
  let next = stepGameWithControls(game, { attackPressed: true }, {}, 0.05)
  for (let i = 0; i < 5; i += 1) next = stepGameWithControls(next, {}, {}, 0.05)
  assert.equal(next.rival.health, 102)
  assert.equal(next.rival.combat.mode, 'stunned')
  for (let i = 0; i < 8; i += 1) next = stepGameWithControls(next, {}, {}, 0.05)
  assert.equal(next.rival.health, 102)
})

test('simulation lets a defending fighter block an incoming active strike', () => {
  const game = createGame()
  game.player.x = 0; game.player.z = 0
  game.rival.x = 0; game.rival.z = 1.2; game.rival.aiCooldown = 0
  const input = { block: true }
  let next = game
  next = stepGameWithControls(next, input, { attackPressed: true }, 0.05)
  for (let i = 0; i < 4; i += 1) next = stepGameWithControls(next, input, {}, 0.05)
  assert.equal(next.player.health, 109)
  assert.equal(next.player.combat.mode, 'blocking')
})
