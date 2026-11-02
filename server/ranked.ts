export type Season = { id: string; name: string; startsAt: Date; endsAt: Date }
export function currentSeason(date = new Date()): Season {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  const startsAt = new Date(Date.UTC(date.getUTCFullYear(), (quarter - 1) * 3, 1))
  const endsAt = new Date(Date.UTC(date.getUTCFullYear(), quarter * 3, 1))
  return { id: `${date.getUTCFullYear()}-S${quarter}`, name: `Season ${quarter} · ${date.getUTCFullYear()}`, startsAt, endsAt }
}
export function rankTier(rating: number, placements: number): string {
  if (placements < 5) return `Placement ${placements}/5`
  if (rating >= 2000) return 'Mythic'
  if (rating >= 1750) return 'Diamond'
  if (rating >= 1500) return 'Platinum'
  if (rating >= 1250) return 'Gold'
  if (rating >= 1000) return 'Silver'
  return 'Bronze'
}
export function expectedScore(rating: number, opponent: number): number { return 1 / (1 + 10 ** ((opponent - rating) / 400)) }
export function ratingDelta(rating: number, opponent: number, won: boolean, kFactor = 32): number { return Math.round(kFactor * (Number(won) - expectedScore(rating, opponent))) }
export function matchmakingRange(waitedMs: number): number { return Math.min(900, 100 + Math.floor(Math.max(0, waitedMs) / 10000) * 75) }
