import { useEffect, useState } from 'react'
import { Award, LoaderCircle, X } from 'lucide-react'
import { fetchLeaderboard, type LeaderboardEntry } from './account'

export function LeaderboardPanel({ onClose }: { onClose: () => void }) {
  const [seasonName, setSeasonName] = useState('Current Season')
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetchLeaderboard().then((data) => { setSeasonName(data.season.name); setPlayers(data.players) }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Leaderboard unavailable')).finally(() => setLoading(false)) }, [])
  return <div className="account-overlay leaderboard-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="account-panel leaderboard-panel"><button className="account-close" onClick={onClose} aria-label="Close leaderboard"><X size={18}/></button><div className="account-kicker"><Award size={15}/> RANKED ARENA · {seasonName.toUpperCase()}</div><h2>LEADERBOARD</h2><p className="account-sub">Ranked public 1v1 matches · seasonal rating</p><div className="leaderboard-head"><span># / PLAYER</span><span>RATING</span><span>W</span></div>{loading?<div className="leaderboard-loading"><LoaderCircle size={18}/> Loading ranked players…</div>:error?<div className="account-error">{error}</div>:players.length===0?<div className="leaderboard-loading">No ranked matches in this season yet. Be first on the board.</div>:<div className="leaderboard-list">{players.map((player)=><div className={`leaderboard-row ${player.rank<=3?'top-rank':''}`} key={player.playerId}><span><i>{String(player.rank).padStart(2,'0')}</i><b>{player.displayName}</b><small>{player.tier}</small></span><strong>{player.rating}</strong><small>{player.wins}</small></div>)}</div>}<div className="leaderboard-foot">PLACEMENTS REQUIRE 5 COMPLETED RANKED MATCHES</div></section></div>
}
