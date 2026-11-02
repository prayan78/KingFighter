import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { Activity, Award, Clock3, Crown, Heart, Orbit, Pause, Play, Radio, RotateCcw, SlidersHorizontal, Swords, UserRound, Volume2, VolumeX, Wind, Zap } from 'lucide-react'
import { Arena } from './game/Arena'
import { CameraRig } from './game/CameraRig'
import { Character } from './game/Character'
import { createGame, startNextRound, stepGame, type Controls, type GameState } from './game/simulation'
import { HERO_STATS, type HeroId } from './game/combat'
import { ABILITIES, abilityOrderFor, canCastAbility, type AbilityId } from './game/abilities'
import type { AIDifficulty } from './game/ai'
import { AbilityEffects, type TargetingState, type WorldProjector } from './game/AbilityEffects'
import { TouchHUD } from './game/TouchHUD'
import type { HudLayout } from './game/TouchHUD'
import { AccountPanel } from './game/AccountPanel'
import { clearSession, fetchProfile, getSessionToken, saveRemoteLayout, updateProfile, type PlayerProfile } from './game/account'
import { connectOnline, interpolateGame, type OnlineSocket } from './game/network'
import { OnlineLobby } from './game/OnlineLobby'
import { LeaderboardPanel } from './game/LeaderboardPanel'
import './game/touch-hud.css'
import './game/abilities.css'

const emptyControls: Controls = { up: false, down: false, left: false, right: false, moveX: 0, moveZ: 0, attack: false, attackPressed: false, block: false, dodge: false, dodgePressed: false, jump: false, jumpPressed: false, dash: false, dashPressed: false }
type HeldControl = 'up' | 'down' | 'left' | 'right' | 'attack' | 'block' | 'dodge' | 'jump' | 'dash'
const keyMap: Record<string, HeldControl> = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'attack', shift: 'block', q: 'dodge', e: 'jump', r: 'dash' }
const clock = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`
const abilityIcons = [Zap, Orbit, Wind, Crown]
const oppositeSide = (side: 'player' | 'rival' | null) => side === 'player' ? 'rival' : side === 'rival' ? 'player' : null
function localPerspective(state: GameState, side: number): GameState {
  if (side === 0) return state
  return { ...state, player: state.rival, rival: state.player, playerRounds: state.rivalRounds, rivalRounds: state.playerRounds, playerHeroId: state.rivalHeroId, rivalHeroId: state.playerHeroId, roundWinner: oppositeSide(state.roundWinner), matchWinner: oppositeSide(state.matchWinner), winner: state.winner === 'MATCH WON' ? 'MATCH LOST' : state.winner === 'MATCH LOST' ? 'MATCH WON' : state.winner === 'ROUND WON' ? 'ROUND LOST' : state.winner === 'ROUND LOST' ? 'ROUND WON' : null }
}

function GameWorld({ game, controls, paused, online, mobile, onOnlineFrame, onUpdate, targeting, projector }: { game: React.MutableRefObject<GameState>; controls: React.MutableRefObject<Controls>; paused: boolean; online: boolean; mobile: boolean; onOnlineFrame: (dt: number) => void; onUpdate: (state: GameState) => void; targeting: React.MutableRefObject<TargetingState | null>; projector: WorldProjector }) {
  const publish = useRef(0)
  useFrame((_, dt) => {
    if (online) { if (!paused) onOnlineFrame(dt); return }
    if (paused) return
    game.current = stepGame(game.current, controls.current, dt)
    controls.current.attackPressed = false
    controls.current.dodgePressed = false
    controls.current.jumpPressed = false
    controls.current.dashPressed = false
    controls.current.abilityRequest = undefined
    publish.current += dt
    if (publish.current > 0.12) { publish.current = 0; onUpdate(game.current) }
  })
  return <>
    <color attach="background" args={['#090e17']} />
    <ambientLight intensity={0.8} />
    <hemisphereLight args={['#b5eaff', '#291c2b', 1.05]} />
    <directionalLight position={[-5, 10, 7]} intensity={2.6} color="#ffe4cc" castShadow={!mobile} shadow-mapSize={mobile ? [512, 512] : [1024, 1024]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
    <pointLight position={[0, 5, -4]} intensity={70} distance={22} color="#36cce6" />
    <pointLight position={[0, 4, 5]} intensity={45} distance={18} color="#ed794f" />
    <Arena mobile={mobile} />
    <Character game={game} side="player" />
    <Character game={game} side="rival" />
    <AbilityEffects game={game} targeting={targeting} projector={projector} />
    <CameraRig game={game} />
    {!mobile && <EffectComposer><Bloom intensity={0.32} luminanceThreshold={0.84} luminanceSmoothing={0.18} mipmapBlur /><Vignette eskil={false} offset={0.16} darkness={0.66} /></EffectComposer>}
  </>
}

export default function App() {
  const [mobileQuality, setMobileQuality] = useState(() => window.matchMedia('(max-width: 800px), (pointer: coarse)').matches)
  const [sceneReady, setSceneReady] = useState(false)
  const game = useRef(createGame(HERO_STATS.kai, HERO_STATS.nyx))
  const controls = useRef<Controls>({ ...emptyControls })
  const [hud, setHud] = useState<GameState>(game.current)
  const [screen, setScreen] = useState<'selection' | 'match'>('selection')
  const [selectedHero, setSelectedHero] = useState<HeroId>('kai')
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium')
  const [paused, setPaused] = useState(true)
  const [muted, setMuted] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const targeting = useRef<TargetingState | null>(null)
  const projector = useRef<WorldProjector['current']>(null)
  const drag = useRef<{ id: AbilityId; pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const [, setTargetingVisible] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [onlineSocket, setOnlineSocket] = useState<OnlineSocket | null>(null)
  const [onlineStatus, setOnlineStatus] = useState('disconnected')
  const [onlineRoomCode, setOnlineRoomCode] = useState('')
  const [onlineSide, setOnlineSide] = useState<number | null>(null)
  const [onlineOpponent, setOnlineOpponent] = useState<string | null>(null)
  const [playersReady, setPlayersReady] = useState<boolean[]>([])
  const [onlineActive, setOnlineActive] = useState(false)
  const inputSequence = useRef(0)
  const inputSendElapsed = useRef(0)
  const interpolation = useRef<{ from: GameState; to: GameState; elapsed: number; duration: number } | null>(null)
  const [layoutOverride, setLayoutOverride] = useState<HudLayout | null>(null)
  const layoutSaveTimer = useRef<number | undefined>(undefined)
  const editorRef = useRef(false)
  const updateHud = useCallback((next: GameState) => setHud({ ...next, player: { ...next.player }, rival: { ...next.rival } }), [])
  const rivalFor = (heroId: HeroId): HeroId => heroId === 'kai' ? 'nyx' : 'kai'
  const beginMatch = (heroId = selectedHero, level = difficulty) => {
    setOnlineActive(false)
    game.current = createGame(HERO_STATS[heroId], HERO_STATS[rivalFor(heroId)], level)
    setHud(game.current); controls.current = { ...emptyControls }; setScreen('match'); setPaused(false); setEditorOpen(false)
  }
  const resetMatch = () => beginMatch(selectedHero, difficulty)
  const continueRound = () => { game.current = startNextRound(game.current); setHud(game.current); controls.current = { ...emptyControls }; setPaused(false) }
  const returnToSelection = () => { if (onlineSocket && onlineStatus === 'complete') onlineSocket.emit('room:leave'); setOnlineActive(false); setScreen('selection'); setPaused(true); setEditorOpen(false); controls.current = { ...emptyControls } }
  const chooseHero = (heroId: HeroId) => { setSelectedHero(heroId); game.current = createGame(HERO_STATS[heroId], HERO_STATS[rivalFor(heroId)], difficulty); setHud(game.current); if (profile) updateProfile({ displayName: profile.displayName, selectedHero: heroId }).then(setProfile).catch((error) => console.warn('Could not save selected hero:', error)) }
  const chooseDifficulty = (level: AIDifficulty) => { setDifficulty(level); game.current = createGame(HERO_STATS[selectedHero], HERO_STATS[rivalFor(selectedHero)], level); setHud(game.current) }

  const defaultTarget = useCallback((id: AbilityId) => {
    const player = game.current.player
    const rival = game.current.rival
    const distanceToRival = Math.hypot(rival.x - player.x, rival.z - player.z)
    const distance = Math.min(ABILITIES[id].range * 0.9, Math.max(0.55, distanceToRival * 0.88))
    return { x: Math.max(-7.48, Math.min(7.48, player.x + Math.sin(player.facing) * distance)), z: Math.max(-4.38, Math.min(4.38, player.z + Math.cos(player.facing) * distance)) }
  }, [])
  const queueAbility = useCallback((id: AbilityId, target = defaultTarget(id)) => {
    if (screen !== 'match' || paused || editorRef.current || !game.current.running || canCastAbility(game.current.player.abilities, id)) return
    controls.current.abilityRequest = { id, target }
  }, [defaultTarget, paused, screen])
  const startAbilityPointer = (event: React.PointerEvent<HTMLButtonElement>, id: AbilityId) => {
    if (screen !== 'match' || paused || editorRef.current || !game.current.running || canCastAbility(game.current.player.abilities, id)) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const target = defaultTarget(id)
    drag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    targeting.current = { id, target }
    setTargetingVisible(true)
  }
  const moveAbilityPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) active.moved = true
    if (!active.moved) return
    const target = projector.current?.(event.clientX, event.clientY)
    if (target) targeting.current = { id: active.id, target: { x: Math.max(-7.48, Math.min(7.48, target.x)), z: Math.max(-4.38, Math.min(4.38, target.z)) } }
  }
  const releaseAbilityPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const moved = active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12
    const rawTarget = moved ? projector.current?.(event.clientX, event.clientY) ?? targeting.current?.target ?? null : null
    const dragged = rawTarget ? { x: Math.max(-7.48, Math.min(7.48, rawTarget.x)), z: Math.max(-4.38, Math.min(4.38, rawTarget.z)) } : null
    queueAbility(active.id, dragged ?? defaultTarget(active.id))
    drag.current = null
    targeting.current = null
    setTargetingVisible(false)
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (editorRef.current || screen !== 'match') return
      const key = event.key.toLowerCase(); const mapped = keyMap[key]
      const abilityOrder = abilityOrderFor(game.current.player.stats.heroId)
      const abilityIndex = Number(key) - 1
      if (!mapped && screen === 'match' && abilityIndex >= 0 && abilityIndex < abilityOrder.length) { event.preventDefault(); queueAbility(abilityOrder[abilityIndex]); return }
      if (!mapped) return
      event.preventDefault()
      if (mapped === 'attack' && !controls.current.attack) controls.current.attackPressed = true
      if (mapped === 'dodge' && !controls.current.dodge) controls.current.dodgePressed = true
      if (mapped === 'jump' && !controls.current.jump) controls.current.jumpPressed = true
      if (mapped === 'dash' && !controls.current.dash) controls.current.dashPressed = true
      controls.current[mapped] = true
    }
    const up = (event: KeyboardEvent) => { const mapped = keyMap[event.key.toLowerCase()]; if (mapped) { event.preventDefault(); controls.current[mapped] = false } }
    const clear = () => { controls.current = { ...emptyControls } }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear) }
  }, [queueAbility, screen])

  useEffect(() => { if (screen === 'match' && hud.phase !== 'fighting') setPaused(true) }, [hud.phase, screen])
  useEffect(() => {
    if (!getSessionToken()) return
    fetchProfile().then((next) => { setProfile(next); setSelectedHero(next.selectedHero); game.current = createGame(HERO_STATS[next.selectedHero], HERO_STATS[rivalFor(next.selectedHero)], difficulty); setHud(game.current); if (next.controlLayout) setLayoutOverride(next.controlLayout as HudLayout) }).catch(() => { clearSession(); setProfile(null) })
  }, [])
  const onLayoutChange = useCallback((layout: HudLayout) => {
    if (!getSessionToken()) return
    window.clearTimeout(layoutSaveTimer.current)
    layoutSaveTimer.current = window.setTimeout(() => { saveRemoteLayout(layout).catch((error) => console.warn('Could not sync HUD layout:', error)) }, 700)
  }, [])
  useEffect(() => { const media = window.matchMedia('(max-width: 800px), (pointer: coarse)'); const update = () => setMobileQuality(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  useEffect(() => {
    if (!onlineSocket) return
    const connected = () => setOnlineStatus(onlineActive ? 'in-match' : 'connected')
    const disconnected = () => { controls.current = { ...emptyControls }; setOnlineStatus('disconnected') }
    const connectError = () => setOnlineStatus('disconnected')
    const waiting = (info: { code?: string }) => { setOnlineStatus('waiting'); setOnlineRoomCode(info.code ?? ''); setOnlineSide(null); setOnlineOpponent(null); setPlayersReady([]) }
    const found = (info: { side: number; opponent: string | null; code?: string }) => { setOnlineSide(info.side); setOnlineOpponent(info.opponent); setOnlineRoomCode(info.code ?? ''); setPlayersReady([false, false]); setOnlineStatus('ready') }
    const readiness = (ready: boolean[]) => setPlayersReady(ready)
    const cancelled = () => { setOnlineStatus('connected'); setOnlineSide(null); setOnlineRoomCode(''); setOnlineOpponent(null); setPlayersReady([]) }
    const opponentDisconnected = () => setOnlineStatus('reconnecting-opponent')
    const resumed = () => setOnlineStatus('in-match')
    const reconnected = (info: { side: number }) => { setOnlineSide(info.side); setOnlineStatus('connected') }
    const state = (packet: { status: string; state: GameState; players: { side: number; username: string; ready: boolean }[] }) => {
      if (onlineSide === null) return
      const next = localPerspective(packet.state, onlineSide)
      if (onlineActive) interpolation.current = { from: game.current, to: next, elapsed: 0, duration: 0.05 }
      else { game.current = next; interpolation.current = null }
      setHud({ ...next, player: { ...next.player }, rival: { ...next.rival } })
      if (packet.status === 'playing' || packet.status === 'round-break' || packet.status === 'complete') {
        setOnlineActive(true); setScreen('match'); setPaused(packet.status === 'complete' || next.phase !== 'fighting')
        setOnlineStatus(packet.status === 'complete' ? 'complete' : packet.status === 'round-break' ? 'round-break' : 'in-match')
        if (packet.status === 'playing') setOnlineOpen(false)
      }
      const ownIndex = onlineSide
      const enemy = packet.players.find((player) => player.side !== ownIndex)
      if (enemy) setOnlineOpponent(enemy.username)
      setPlayersReady(packet.players.sort((a,b)=>a.side-b.side).map((player)=>player.ready))
    }
    const complete = () => { setPaused(true); setOnlineStatus('complete'); fetchProfile().then(setProfile).catch(() => undefined) }
    onlineSocket.on('connect', connected); onlineSocket.on('disconnect', disconnected); onlineSocket.on('connect_error', connectError)
    onlineSocket.on('matchmaking:waiting', waiting); onlineSocket.on('matchmaking:found', found); onlineSocket.on('matchmaking:cancelled', cancelled)
    onlineSocket.on('player:readiness', readiness); onlineSocket.on('match:state', state); onlineSocket.on('match:complete', complete)
    onlineSocket.on('match:opponent-disconnected', opponentDisconnected); onlineSocket.on('match:resumed', resumed); onlineSocket.on('match:reconnected', reconnected)
    if (onlineSocket.connected) connected()
    return () => { onlineSocket.off('connect', connected); onlineSocket.off('disconnect', disconnected); onlineSocket.off('connect_error', connectError); onlineSocket.off('matchmaking:waiting', waiting); onlineSocket.off('matchmaking:found', found); onlineSocket.off('matchmaking:cancelled', cancelled); onlineSocket.off('player:readiness', readiness); onlineSocket.off('match:state', state); onlineSocket.off('match:complete', complete); onlineSocket.off('match:opponent-disconnected', opponentDisconnected); onlineSocket.off('match:resumed', resumed); onlineSocket.off('match:reconnected', reconnected) }
  }, [onlineSocket, onlineSide, onlineActive])
  const openOnline = () => {
    if (!profile || !getSessionToken()) { setAccountOpen(true); return }
    try { if (!onlineSocket) { setOnlineStatus('connecting'); setOnlineSocket(connectOnline()) }; setOnlineOpen(true) }
    catch { setOnlineStatus('disconnected') }
  }
  const sendOnlineFrame = useCallback((dt: number) => {
    if (onlineActive && onlineSocket?.connected && onlineSide !== null) {
      inputSendElapsed.current += dt
      if (inputSendElapsed.current >= 0.05) {
        inputSendElapsed.current = 0
        const current = controls.current
        let moveX = Number(current.right) - Number(current.left) + current.moveX
        let moveZ = Number(current.down) - Number(current.up) + current.moveZ
        const magnitude = Math.hypot(moveX, moveZ)
        if (magnitude > 1) { moveX /= magnitude; moveZ /= magnitude }
        onlineSocket.emit('player:input', { sequence: ++inputSequence.current, moveX, moveZ, attackPressed: current.attackPressed, block: current.block, dodgePressed: current.dodgePressed, jumpPressed: current.jumpPressed, dashPressed: current.dashPressed, ability: current.abilityRequest })
        current.attackPressed = false; current.dodgePressed = false; current.jumpPressed = false; current.dashPressed = false; current.abilityRequest = undefined
      }
    }
    const buffer = interpolation.current
    if (onlineActive && buffer) { buffer.elapsed += dt; game.current = interpolateGame(buffer.from, buffer.to, buffer.elapsed / buffer.duration) }
  }, [onlineActive, onlineSide, onlineSocket])

  const playerStats = hud.player.stats
  const rivalStats = hud.rival.stats
  const selectedAbilities = abilityOrderFor(playerStats.heroId)
  const difficultySummary: Record<AIDifficulty, string> = { easy: 'A relaxed opponent with generous openings.', medium: 'A tactical rival that blocks and uses skills.', hard: 'A sharp duelist that adapts, punishes, and defends.' }

  return <main className="game-shell">
    <div className="scene"><Canvas shadows={!mobileQuality} dpr={mobileQuality ? [0.75, 1.15] : [1, 1.65]} camera={{ position: [0, 8, 13], fov: 43 }} gl={{ antialias: !mobileQuality, alpha: false, powerPreference: 'high-performance', stencil: false }} onCreated={({ gl }) => { gl.setPixelRatio(Math.min(window.devicePixelRatio, mobileQuality ? 1.15 : 1.65)); requestAnimationFrame(() => setSceneReady(true)) }}><GameWorld game={game} controls={controls} paused={paused} online={onlineActive} mobile={mobileQuality} onOnlineFrame={sendOnlineFrame} onUpdate={updateHud} targeting={targeting} projector={projector} /></Canvas></div>
    {!sceneReady && <div className="game-loader" role="status"><span className="loader-sigil"><Crown size={19}/></span><b>PREPARING THE ARENA</b><small>Loading champions and combat systems</small></div>}
    <div className="grain" />
    <header className="topbar">
      <a className="brand" href="#top" aria-label="KingFighter home"><span className="brand-mark"><Crown size={18} /></span><span>KING<span className="brand-light">FIGHTER</span><small>REALM OF CHAMPIONS</small></span></a>
      <div className="season"><span className="live-dot" /> SEASON 01 <i /> THE ASTRAL RING</div>
      <div className="top-actions">{screen === 'match' && <div className="round-label"><span>{onlineActive ? 'ONLINE · ROUND' : 'OFFLINE · ROUND'}</span><b>{hud.round} <em>/ 03</em></b></div>}{screen === 'selection' && <button className="icon-btn online-launch" onClick={openOnline} aria-label="Play online 1v1"><Radio size={16}/></button>}<button className="icon-btn" onClick={() => setAccountOpen(true)} aria-label={profile ? `Player profile for ${profile.displayName}` : 'Sign in or create account'}><UserRound size={16}/></button><button className="icon-btn" onClick={() => { const next = !editorOpen; editorRef.current = next; setEditorOpen(next) }} aria-label="Customize combat HUD"><SlidersHorizontal size={16}/></button><button className="icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? 'Enable sound' : 'Mute sound'}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><button className="icon-btn" onClick={() => setShowHelp(!showHelp)} aria-label="Toggle controls">?</button></div>
    </header>

    <section className="match-hud" aria-label="Match status">
      <div className="fighter-card player-card" style={{ '--hero-accent': playerStats.accent } as React.CSSProperties}><div className="fighter-id"><div className="avatar player-avatar">{playerStats.name.slice(0, 2).toUpperCase()}</div><div><div className="fighter-name">{playerStats.name.toUpperCase()} <span>{playerStats.title.toUpperCase()}</span></div><div className="fighter-level"><span>YOU</span><i /> <span>{playerStats.archetype.toUpperCase()}</span></div></div></div><div className="health-meta"><Heart size={13} /><span>VITALITY</span><b>{Math.ceil(hud.player.health)}<small> / {playerStats.maxHealth}</small></b></div><div className="health-track"><div className="health-fill player-fill" style={{ width: `${hud.player.health / playerStats.maxHealth * 100}%` }} /></div><div className="energy-track"><span style={{ width: `${hud.player.abilities.mana / hud.player.abilities.maxMana * 100}%` }} /></div></div>
      <div className="timer-card"><div className="timer-label"><span className="timer-line" />MATCH TIME<span className="timer-line" /></div><div className={`timer-value ${hud.time < 20 ? 'urgent' : ''}`}><Clock3 size={17} />{clock(hud.time)}</div><div className="timer-sub">{hud.playerRounds} — {hud.rivalRounds} · BEST OF THREE</div></div>
      <div className="fighter-card rival-card" style={{ '--hero-accent': rivalStats.accent } as React.CSSProperties}><div className="fighter-id"><div className="avatar rival-avatar">{rivalStats.name.slice(0, 2).toUpperCase()}</div><div><div className="fighter-name">{rivalStats.name.toUpperCase()} <span>{rivalStats.title.toUpperCase()}</span></div><div className="fighter-level"><span>{onlineActive ? 'ONLINE RIVAL' : `${hud.difficulty.toUpperCase()} AI`}</span><i /> <span>{rivalStats.archetype.toUpperCase()}</span></div></div></div><div className="health-meta"><Heart size={13} /><span>VITALITY</span><b>{Math.ceil(hud.rival.health)}<small> / {rivalStats.maxHealth}</small></b></div><div className="health-track"><div className="health-fill rival-fill" style={{ width: `${hud.rival.health / rivalStats.maxHealth * 100}%` }} /></div><div className="energy-track rival-energy"><span style={{ width: `${hud.rival.abilities.mana / hud.rival.abilities.maxMana * 100}%` }} /></div></div>
    </section>

    <div className="arena-caption"><span>✦ &nbsp; COMBAT ZONE &nbsp; ✦</span><div>BOUNDARY <b>ACTIVE</b></div></div>
    <div className="ability-tray" aria-label="Hero abilities"><div className="mana-readout"><span>MANA</span><b>{Math.floor(hud.player.abilities.mana)}<i> / {hud.player.abilities.maxMana}</i></b><div className="mana-track"><span style={{ width: `${hud.player.abilities.mana / hud.player.abilities.maxMana * 100}%` }} /></div></div>{selectedAbilities.map((id, index) => { const ability = ABILITIES[id]; const Icon = abilityIcons[index]; const cooldown = hud.player.abilities.cooldowns[id]; const reason = canCastAbility(hud.player.abilities, id); return <button key={id} className={`ability-card ${ability.ultimate ? 'ultimate' : ''} ${targeting.current?.id === id ? 'targeting' : ''}`} disabled={Boolean(reason)} title={`${ability.name} · ${ability.manaCost} mana · ${ability.cooldown}s cooldown — ${ability.description}`} onPointerDown={(event) => startAbilityPointer(event, id)} onPointerMove={moveAbilityPointer} onPointerUp={releaseAbilityPointer} onPointerCancel={() => { drag.current = null; targeting.current = null; setTargetingVisible(false) }}><span className="ability-key">{index + 1}</span><span className="ability-icon"><Icon size={17} /></span><span className="ability-label"><b>{ability.name}</b><small>{ability.manaCost} MP</small></span><span className="ability-status">{cooldown > 0 ? `${cooldown.toFixed(1)}s` : reason === 'mana' ? 'NO MP' : ability.type === 'projectile' ? 'BOLT' : ability.type.toUpperCase()}</span></button>})}</div>
    <div className="bottom-ui"><div className="left-meta"><div className="ping"><Activity size={13} /> {onlineActive?'ONLINE':'OFFLINE'}</div><span className="meta-divider" /> <span>MODE <b>BEST OF THREE</b></span></div><div className="control-hint"><span className="key">W</span><span className="key-stack"><i className="key">A</i><i className="key">S</i><i className="key">D</i></span><span className="hint-label">MOVE</span><span className="hint-sep" /><span className="key key-wide">SPACE</span><Swords size={15} /><span className="hint-label">STRIKE</span></div><div className="bottom-right">{screen === 'match' && <>{!onlineActive&&<button className="reset-btn" onClick={resetMatch}><RotateCcw size={14} /> REMATCH</button>}{onlineActive?<span className={`live-match-label ${onlineStatus==='disconnected'||onlineStatus==='reconnecting-opponent'?'reconnecting':''}`}><Radio size={13}/>{onlineStatus==='disconnected'?'RECONNECTING':onlineStatus==='reconnecting-opponent'?'RIVAL RECONNECTING':'LIVE'}</span>:<button className="pause-btn" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'RESUME' : 'PAUSE'}</button>}</>}</div></div>

    {screen === 'selection' && <section className="selection-overlay"><div className="selection-panel"><div className="selection-kicker"><span className="live-dot"/> OFFLINE DUEL · NO CONNECTION REQUIRED</div><h1>CHOOSE YOUR <em>CHAMPION</em></h1><p className="selection-intro">Two paths. One arena. Select a fighter to face their rival in a best-of-three showdown.</p><div className="hero-select-grid">{(['kai', 'nyx'] as const).map((heroId) => { const hero = HERO_STATS[heroId]; const order = abilityOrderFor(heroId); const selected = selectedHero === heroId; return <button key={heroId} className={`hero-select-card ${selected ? 'selected' : ''} ${heroId}`} onClick={() => chooseHero(heroId)} style={{ '--hero-accent': hero.accent, '--hero-secondary': hero.secondary } as React.CSSProperties}><span className="hero-card-top"><span className="hero-mark">{hero.name.slice(0,1)}</span><span className="hero-archetype">{hero.archetype}</span><span className="hero-check">{selected ? 'SELECTED' : 'SELECT'}</span></span><strong>{hero.name.toUpperCase()}</strong><small className="hero-title">{hero.title}</small><p>{heroId === 'kai' ? 'A measured blade master built to endure, counter, and control the center.' : 'A swift veil dancer who trades armor for explosive tempo and evasive reach.'}</p><span className="hero-stat-row"><i>VITALITY <b>{hero.maxHealth}</b></i><i>SPEED <b>{hero.moveSpeed.toFixed(1)}</b></i><i>POWER <b>{hero.damageScale.toFixed(2)}</b></i></span><span className="hero-ability-list">{order.map((id) => <i key={id}>{ABILITIES[id].name}</i>)}</span></button>})}</div><div className="selection-options"><div><span className="option-label">AI DIFFICULTY</span><div className="difficulty-options">{(['easy','medium','hard'] as const).map((level) => <button key={level} className={difficulty===level?'active':''} onClick={() => chooseDifficulty(level)}>{level.toUpperCase()}</button>)}</div><small>{difficultySummary[difficulty]}</small></div><div className="rival-preview"><span className="option-label">YOUR RIVAL</span><b>{HERO_STATS[rivalFor(selectedHero)].name} · {HERO_STATS[rivalFor(selectedHero)].archetype}</b><small>Controlled by offline tactical AI</small></div></div><button className="start-match-button" onClick={() => beginMatch()}><Swords size={17}/> BEGIN OFFLINE MATCH <span>BEST OF 3</span></button><button className="start-match-button online-start" onClick={openOnline}><Radio size={16}/> PLAY ONLINE 1V1 <span>NEEDS ACCOUNT</span></button><button className="start-match-button leaderboard-start" onClick={() => setLeaderboardOpen(true)}><Award size={16}/> SEASON LEADERBOARD</button><div className="selection-footnote">GUEST TRAINING WORKS OFFLINE · ONLINE RESULTS ARE SERVER VERIFIED</div></div></section>}

    {showHelp && <aside className="help-panel"><button className="help-close" onClick={() => setShowHelp(false)}>×</button><b>FIELD GUIDE</b><p>Move with <strong>W A S D</strong> or arrows, or use the virtual joystick on touch screens. Chain up to three <strong>SPACE</strong> strikes. Hold <strong>SHIFT</strong> to block, tap <strong>Q</strong> to dodge, <strong>E</strong> to jump, or <strong>R</strong> to dash. Cast abilities with <strong>1–4</strong> or tap a skill button. Hold a skill and drag into the arena to aim; release to cast. Use the sliders icon to reposition, resize, or fade touch controls. Mana regenerates over time.</p></aside>}
    {screen === 'match' && paused && hud.phase === 'fighting' && <div className="pause-overlay"><div className="pause-card"><div className="pause-emblem"><Pause size={21} /></div><div className="pause-kicker">THE ASTRAL RING · ROUND {hud.round}</div><h1>MATCH PAUSED</h1><p>Take a breath, then return to the duel.</p><div className="pause-actions"><button className="primary-action" onClick={() => setPaused(false)}><Play size={15} /> RETURN TO BATTLE</button><button className="secondary-action" onClick={returnToSelection}>CHANGE HERO</button></div></div></div>}
    {screen === 'match' && hud.phase === 'round-over' && <div className="pause-overlay"><div className="pause-card result-card"><div className="pause-emblem"><Crown size={23}/></div><div className="pause-kicker">ROUND {hud.round} COMPLETE</div><h1>{hud.roundWinner === 'player' ? 'ROUND WON' : 'ROUND LOST'}</h1><p>{hud.playerRounds} — {hud.rivalRounds} &nbsp; · &nbsp; First to two rounds takes the match.</p><div className="pause-actions">{onlineActive?<span className="intermission-note">NEXT ROUND STARTS AUTOMATICALLY</span>:<><button className="primary-action" onClick={continueRound}><Play size={15}/> FIGHT ROUND {hud.round + 1}</button><button className="secondary-action" onClick={resetMatch}>RESTART MATCH</button></>}</div></div></div>}
    {screen === 'match' && hud.phase === 'match-over' && <div className="pause-overlay"><div className="pause-card result-card"><div className="pause-emblem"><Crown size={23}/></div><div className="pause-kicker">{onlineActive?'SERVER VERIFIED ONLINE MATCH':'OFFLINE MATCH COMPLETE'}</div><h1>{hud.matchWinner === 'player' ? 'CHAMPION' : 'DEFEATED'}</h1><p>{playerStats.name} {hud.playerRounds} — {hud.rivalRounds} {rivalStats.name}</p><div className="pause-actions"><button className="primary-action" onClick={onlineActive?returnToSelection:resetMatch}>{onlineActive?<Radio size={15}/>:<RotateCcw size={15}/>} {onlineActive?'RETURN TO HERO SELECT':'REMATCH'}</button>{!onlineActive&&<button className="secondary-action" onClick={returnToSelection}>CHOOSE HERO</button>}</div></div></div>}
    <div className="version-tag">KF // PRE-ALPHA 0.1.0 <span>•</span> BUILD 001</div>
    <TouchHUD game={game} controls={controls} hud={hud} paused={paused || screen !== 'match'} editorOpen={editorOpen} setEditorOpen={setEditorOpen} editorRef={editorRef} targeting={targeting} projector={projector} defaultTarget={defaultTarget} onCast={queueAbility} onTargetingChange={(target) => { targeting.current = target; setTargetingVisible(Boolean(target)) }} layoutOverride={layoutOverride} onLayoutChange={onLayoutChange}/>
    {leaderboardOpen && <LeaderboardPanel onClose={() => setLeaderboardOpen(false)}/>}
    {accountOpen && <AccountPanel profile={profile} onProfile={(next) => { setProfile(next); if (next) { setSelectedHero(next.selectedHero); if (next.controlLayout) setLayoutOverride(next.controlLayout as HudLayout) } else { onlineSocket?.disconnect(); setOnlineSocket(null); setOnlineActive(false); setOnlineStatus('disconnected'); setLayoutOverride(null); localStorage.removeItem('kingfighter.session.v1') } }} onClose={() => setAccountOpen(false)}/>}
    {onlineOpen && onlineSocket && <OnlineLobby socket={onlineSocket} heroId={selectedHero} rating={profile?.seasonRating ?? 1000} status={onlineStatus} roomCode={onlineRoomCode} playersReady={playersReady} side={onlineSide} opponent={onlineOpponent} onClose={() => { if (onlineStatus === 'waiting' || onlineStatus === 'ready' || onlineSide !== null) onlineSocket.emit('room:leave'); setOnlineOpen(false) }}/>}
  </main>
}
