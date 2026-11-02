import { io, type Socket } from 'socket.io-client'
import { getSessionToken } from './account'
import type { GameState, FighterState } from './simulation'

const API_URL = import.meta.env.VITE_API_URL ?? window.location.origin
export type OnlineSocket = Socket
export function connectOnline(): OnlineSocket {
  const token = getSessionToken()
  if (!token) throw new Error('Sign in to play online.')
  return io(API_URL, { auth: { token }, transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 8000 })
}

const angleLerp = (from: number, to: number, alpha: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha
function interpolateFighter(from: FighterState, to: FighterState, alpha: number): FighterState {
  return { ...to, x: from.x + (to.x - from.x) * alpha, z: from.z + (to.z - from.z) * alpha, facing: angleLerp(from.facing, to.facing, alpha), health: from.health + (to.health - from.health) * alpha, elevation: from.elevation + (to.elevation - from.elevation) * alpha, vx: from.vx + (to.vx - from.vx) * alpha, vz: from.vz + (to.vz - from.vz) * alpha }
}
export function interpolateGame(from: GameState, to: GameState, alpha: number): GameState {
  const amount = Math.max(0, Math.min(1, alpha))
  return { ...to, player: interpolateFighter(from.player, to.player, amount), rival: interpolateFighter(from.rival, to.rival, amount) }
}
