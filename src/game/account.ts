export type PlayerProfile = {
  id: string; username: string; displayName: string; email: string; ownedHeroes: ('kai' | 'nyx')[]
  selectedHero: 'kai' | 'nyx'; experience: number; level: number; achievements: string[]
  seasonId: string; seasonRating: number; seasonPeakRating: number; seasonExperience: number; seasonMatches: number; seasonWins: number; rankTier: string
  matchHistory: { heroId: 'kai' | 'nyx'; difficulty: 'easy' | 'medium' | 'hard' | 'online'; result: 'win' | 'loss'; roundsWon: number; roundsLost: number; playedAt: string }[]
  controlLayout: Record<string, { x: number; y: number; size: number; opacity: number }> | null
}

const TOKEN_KEY = 'kingfighter.session.v1'
const API_BASE = import.meta.env.VITE_API_URL ?? ''
export const getSessionToken = () => localStorage.getItem(TOKEN_KEY)
export const clearSession = () => localStorage.removeItem(TOKEN_KEY)

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getSessionToken()
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data as T
}

export async function authenticate(mode: 'register' | 'login', values: { username?: string; displayName?: string; email: string; password: string }) {
  const result = await request<{ token: string; player: PlayerProfile }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(values) })
  localStorage.setItem(TOKEN_KEY, result.token)
  return result.player
}
export const fetchProfile = async () => (await request<{ player: PlayerProfile }>('/profile')).player
export const updateProfile = async (values: { displayName: string; selectedHero: 'kai' | 'nyx' }) => (await request<{ player: PlayerProfile }>('/profile', { method: 'PUT', body: JSON.stringify(values) })).player
export const saveRemoteLayout = async (layout: unknown) => request('/profile/control-layout', { method: 'PUT', body: JSON.stringify(layout) })
export type LeaderboardEntry = { rank: number; playerId: string; displayName: string; rating: number; peakRating: number; seasonExperience: number; matches: number; wins: number; tier: string }
export const fetchLeaderboard = async (limit = 50) => request<{ season: { id: string; name: string; startsAt: string; endsAt: string }; players: LeaderboardEntry[] }>(`/leaderboard?limit=${limit}`)
