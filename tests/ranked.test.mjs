import test from 'node:test'
import assert from 'node:assert/strict'
import { currentSeason, expectedScore, matchmakingRange, rankTier, ratingDelta } from '../server/ranked.ts'

test('season ids follow UTC calendar quarters with exact boundaries', () => {
  assert.equal(currentSeason(new Date('2026-03-31T23:59:59Z')).id, '2026-S1')
  assert.equal(currentSeason(new Date('2026-04-01T00:00:00Z')).id, '2026-S2')
  assert.equal(currentSeason(new Date('2026-12-31T23:59:59Z')).id, '2026-S4')
})

test('Elo changes are outcome and opponent-rating aware and zero-sum at equal ratings', () => {
  assert.equal(expectedScore(1000, 1000), 0.5)
  assert.equal(ratingDelta(1000, 1000, true), 16)
  assert.equal(ratingDelta(1000, 1000, false), -16)
  assert.ok(ratingDelta(1000, 1500, true) > ratingDelta(1500, 1000, true))
})

test('rank tiers require five placements and queue search widens with waiting time', () => {
  assert.equal(rankTier(1500, 0), 'Placement 0/5')
  assert.equal(rankTier(1500, 5), 'Platinum')
  assert.equal(matchmakingRange(0), 100)
  assert.ok(matchmakingRange(60000) > matchmakingRange(0))
  assert.equal(matchmakingRange(1_000_000), 900)
})
