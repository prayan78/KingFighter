import { useEffect, useRef, useState } from 'react'
import { Crosshair, Disc3, Gauge, Move, RotateCcw, Sparkles, Swords, Wind, Zap } from 'lucide-react'
import { ABILITIES, abilityOrderFor, canCastAbility, type AbilityId, type WorldPoint } from './abilities'
import type { GameState, Controls } from './simulation'
import type { TargetingState, WorldProjector } from './AbilityEffects'

type ControlId = 'joystick' | 'attack' | 'skill1' | 'skill2' | 'skill3' | 'ultimate' | 'dash'
type Setting = { x: number; y: number; size: number; opacity: number }
export type HudLayout = Record<ControlId, Setting>

const STORAGE_KEY = 'kingfighter.touch-hud.v1'
const CONTROL_NAMES: Record<ControlId, string> = { joystick: 'Joystick', attack: 'Basic attack', skill1: 'Skill 1 · Arc Bolt', skill2: 'Skill 2 · Rift Nova', skill3: 'Skill 3 · Blink Step', ultimate: 'Ultimate', dash: 'Dash' }
export const DEFAULT_HUD_LAYOUT: HudLayout = {
  joystick: { x: 0.2, y: 0.775, size: 1, opacity: 0.75 },
  attack: { x: 0.85, y: 0.72, size: 1.05, opacity: 0.94 },
  skill1: { x: 0.47, y: 0.865, size: 0.75, opacity: 0.9 },
  skill2: { x: 0.59, y: 0.865, size: 0.75, opacity: 0.9 },
  skill3: { x: 0.71, y: 0.865, size: 0.75, opacity: 0.9 },
  ultimate: { x: 0.85, y: 0.865, size: 0.85, opacity: 0.96 },
  dash: { x: 0.865, y: 0.55, size: 0.86, opacity: 0.84 },
}

function loadLayout(): HudLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<HudLayout> | null
    if (!parsed) return structuredClone(DEFAULT_HUD_LAYOUT)
    const next = structuredClone(DEFAULT_HUD_LAYOUT)
    for (const id of Object.keys(next) as ControlId[]) {
      const item = parsed[id]
      if (item && [item.x, item.y, item.size, item.opacity].every(Number.isFinite)) {
        next[id] = { x: Math.min(0.98, Math.max(0.02, item.x)), y: Math.min(0.96, Math.max(0.04, item.y)), size: Math.min(1.5, Math.max(0.55, item.size)), opacity: Math.min(1, Math.max(0.25, item.opacity)) }
      }
    }
    return next
  } catch { return structuredClone(DEFAULT_HUD_LAYOUT) }
}

type Props = {
  game: React.MutableRefObject<GameState>
  controls: React.MutableRefObject<Controls>
  hud: GameState
  paused: boolean
  editorOpen: boolean
  setEditorOpen: (open: boolean) => void
  editorRef: React.MutableRefObject<boolean>
  targeting: React.MutableRefObject<TargetingState | null>
  projector: WorldProjector
  defaultTarget: (id: AbilityId) => WorldPoint
  onCast: (id: AbilityId, target?: WorldPoint) => void
  onTargetingChange: (target: TargetingState | null) => void
  layoutOverride?: HudLayout | null
  onLayoutChange?: (layout: HudLayout) => void
}

export function TouchHUD({ game, controls, hud, paused, editorOpen, setEditorOpen, editorRef, targeting, projector, defaultTarget, onCast, onTargetingChange, layoutOverride, onLayoutChange }: Props) {
  const abilityOrder = abilityOrderFor(hud.player.stats.heroId)
  const root = useRef<HTMLDivElement>(null)
  const joystickPointer = useRef<number | null>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const editDrag = useRef<{ id: ControlId; pointerId: number } | null>(null)
  const abilityDrag = useRef<{ id: AbilityId; pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const [layout, setLayout] = useState<HudLayout>(loadLayout)
  const [selected, setSelected] = useState<ControlId>('joystick')
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const yScale = viewport.width / viewport.height > 1.25 ? 0.84 : 1

  useEffect(() => { editorRef.current = editorOpen; if (editorOpen) clearControls() }, [editorOpen, editorRef, controls])
  useEffect(() => { const timeout = window.setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch { /* Storage can be unavailable in private browsing. */ } }, 150); return () => window.clearTimeout(timeout) }, [layout])
  useEffect(() => { if (layoutOverride) setLayout(layoutOverride) }, [layoutOverride])
  useEffect(() => { onLayoutChange?.(layout) }, [layout, onLayoutChange])
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])

  function clearControls() {
    controls.current = { ...controls.current, up: false, down: false, left: false, right: false, moveX: 0, moveZ: 0, attack: false, attackPressed: false, block: false, dodge: false, dodgePressed: false, jump: false, jumpPressed: false, dash: false, dashPressed: false, abilityRequest: undefined }
    joystickPointer.current = null
    if (knob.current) knob.current.style.transform = 'translate(-50%, -50%)'
  }

  const updateTarget = (id: AbilityId, clientX: number, clientY: number) => {
    const point = projector.current?.(clientX, clientY)
    if (point) targeting.current = { id, target: { x: clamp(point.x, -7.48, 7.48), z: clamp(point.z, -4.38, 4.38) } }
  }
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const beginControl = (id: ControlId, event: React.PointerEvent<HTMLElement>) => {
    if (!editorOpen) return false
    event.preventDefault(); event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    editDrag.current = { id, pointerId: event.pointerId }
    setSelected(id)
    return true
  }
  const moveControl = (event: React.PointerEvent<HTMLElement>) => {
    const active = editDrag.current
    if (!editorOpen || !active || active.pointerId !== event.pointerId || !root.current) return
    const bounds = root.current.getBoundingClientRect()
    setLayout((current) => ({ ...current, [active.id]: { ...current[active.id], x: clamp((event.clientX - bounds.left) / bounds.width, 0.02, 0.98), y: clamp((event.clientY - bounds.top) / bounds.height / yScale, 0.04, 0.96) } }))
  }
  const endControl = (event: React.PointerEvent<HTMLElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) editDrag.current = null
  }

  const joystickDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (beginControl('joystick', event)) return
    if (paused || editorOpen) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); joystickPointer.current = event.pointerId
    updateJoystick(event)
  }
  const updateJoystick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointer.current !== event.pointerId || !event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const radius = Math.min(rect.width, rect.height) * 0.36
    const rawX = event.clientX - (rect.left + rect.width / 2)
    const rawY = event.clientY - (rect.top + rect.height / 2)
    const length = Math.hypot(rawX, rawY)
    const scale = length > radius ? radius / length : 1
    const knobX = rawX * scale; const knobY = rawY * scale
    controls.current.moveX = knobX / radius
    controls.current.moveZ = knobY / radius
    if (knob.current) knob.current.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`
  }
  const joystickUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { endControl(event); return }
    if (joystickPointer.current !== event.pointerId) return
    joystickPointer.current = null; controls.current.moveX = 0; controls.current.moveZ = 0
    if (knob.current) knob.current.style.transform = 'translate(-50%, -50%)'
  }

  const attackDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (beginControl('attack', event)) return
    if (paused || editorOpen) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    if (!controls.current.attack) controls.current.attackPressed = true
    controls.current.attack = true
  }
  const attackUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { endControl(event); return }
    controls.current.attack = false
  }
  const dashDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (beginControl('dash', event)) return
    if (paused || editorOpen || game.current.player.combat.dashCooldown > 0) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    controls.current.dash = true; controls.current.dashPressed = true
  }
  const dashUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { endControl(event); return }
    controls.current.dash = false
  }
  const abilityDown = (id: AbilityId, controlId: ControlId) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (beginControl(controlId, event)) return
    if (paused || editorOpen || canCastAbility(game.current.player.abilities, id)) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    abilityDrag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    targeting.current = { id, target: defaultTarget(id) }
    onTargetingChange(targeting.current)
  }
  const abilityMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { moveControl(event); return }
    const active = abilityDrag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12) active.moved = true
    if (active.moved) updateTarget(active.id, event.clientX, event.clientY)
  }
  const abilityUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { endControl(event); return }
    const active = abilityDrag.current
    if (!active || active.pointerId !== event.pointerId) return
    const moved = active.moved || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 12
    if (moved) updateTarget(active.id, event.clientX, event.clientY)
    const target = moved ? targeting.current?.target : null
    onCast(active.id, target ?? defaultTarget(active.id))
    abilityDrag.current = null; targeting.current = null; onTargetingChange(null)
  }
  const cancelAbility = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (editDrag.current?.pointerId === event.pointerId) { endControl(event); return }
    if (abilityDrag.current?.pointerId !== event.pointerId) return
    abilityDrag.current = null; targeting.current = null; onTargetingChange(null)
  }

  const settingStyle = (id: ControlId, baseSize: number): React.CSSProperties => ({ left: `${layout[id].x * 100}%`, top: `${layout[id].y * yScale * 100}%`, opacity: layout[id].opacity, width: baseSize, height: baseSize, ['--hud-scale' as string]: layout[id].size })
  const common = (id: ControlId) => ({ className: `touch-control ${editorOpen ? 'editable' : ''} ${selected === id && editorOpen ? 'selected-control' : ''}`, style: settingStyle(id, id === 'joystick' ? 142 : id === 'attack' ? 72 : id === 'ultimate' ? 66 : 58), onPointerMove: moveControl, onPointerUp: endControl, onPointerCancel: endControl, 'aria-label': CONTROL_NAMES[id] })

  return <div ref={root} className={`touch-hud ${editorOpen ? 'editing' : ''}`}>
    <div {...common('joystick')} className={`virtual-stick touch-control ${editorOpen ? 'editable' : ''} ${selected === 'joystick' && editorOpen ? 'selected-control' : ''}`} onPointerDown={joystickDown} onPointerMove={(event) => { moveControl(event); updateJoystick(event) }} onPointerUp={joystickUp} onPointerCancel={joystickUp}>
      <div className="stick-rings"><span className="stick-axis-x"/><span className="stick-axis-y"/></div><span className="stick-knob" ref={knob}><Move size={19}/></span>{editorOpen && <span className="edit-tag">MOVE</span>}
    </div>

    <button {...common('attack')} className={`touch-control touch-action attack-action ${editorOpen ? 'editable' : ''} ${selected === 'attack' && editorOpen ? 'selected-control' : ''}`} onPointerDown={attackDown} onPointerUp={attackUp} onPointerCancel={attackUp}><Swords size={25}/><b>ATTACK</b><small>HOLD / TAP</small></button>
    <button {...common('dash')} className={`touch-control touch-action dash-action ${editorOpen ? 'editable' : ''} ${selected === 'dash' && editorOpen ? 'selected-control' : ''}`} disabled={!editorOpen && game.current.player.combat.dashCooldown > 0} onPointerDown={dashDown} onPointerUp={dashUp} onPointerCancel={dashUp}><Wind size={20}/><b>DASH</b><small>{Math.ceil(game.current.player.combat.dashCooldown * 10) / 10 > 0 ? `${game.current.player.combat.dashCooldown.toFixed(1)}s` : 'READY'}</small><span className="touch-cooldown" style={{ '--cooldown-angle': `${Math.min(360, game.current.player.combat.dashCooldown / 1.35 * 360)}deg` } as React.CSSProperties}/></button>

    {abilityOrder.map((id, index) => {
      const ability = ABILITIES[id]; const controlId: ControlId = ability.ultimate ? 'ultimate' : `skill${index + 1}` as ControlId
      const Icon = ability.ultimate ? Sparkles : index === 0 ? Zap : index === 1 ? Disc3 : Crosshair
      const cooldown = hud.player.abilities.cooldowns[id]
      const reason = canCastAbility(game.current.player.abilities, id)
      const unavailable = Boolean(reason) && !editorOpen
      return <button key={id} {...common(controlId)} className={`touch-control touch-skill ${ability.ultimate ? 'touch-ultimate' : ''} ${editorOpen ? 'editable' : ''} ${selected === controlId && editorOpen ? 'selected-control' : ''}`} disabled={unavailable} onPointerDown={abilityDown(id, controlId)} onPointerMove={abilityMove} onPointerUp={abilityUp} onPointerCancel={cancelAbility} title={`${ability.name} · ${ability.manaCost} mana · ${ability.cooldown}s cooldown`}>
        <span className="touch-skill-icon"><Icon size={20}/></span><b>{ability.ultimate ? 'ULT' : index === 0 ? 'BOLT' : index === 1 ? 'NOVA' : 'BLINK'}</b><small>{ability.manaCost} MP</small>
        {cooldown > 0 && !editorOpen && <span className="touch-cooldown" style={{ '--cooldown-angle': `${Math.min(360, cooldown / ability.cooldown * 360)}deg` } as React.CSSProperties}><i>{cooldown.toFixed(1)}</i></span>}
        {reason === 'mana' && !editorOpen && <span className="touch-no-mana">MP LOW</span>}
        {editorOpen && <span className="edit-tag">MOVE</span>}
      </button>
    })}

    <div className="mobile-mana"><Gauge size={13}/><span>MP</span><b>{Math.floor(hud.player.abilities.mana)}</b><div className="mobile-mana-track"><i style={{ width: `${hud.player.abilities.mana / hud.player.abilities.maxMana * 100}%` }}/></div></div>

    {editorOpen && <section className="hud-editor" aria-label="HUD customization editor">
      <header><div><b>HUD CUSTOMIZER</b><small>Drag controls · layout saves on this device</small></div><button onClick={() => setEditorOpen(false)} aria-label="Close editor">×</button></header>
      <label className="editor-control-select">EDIT CONTROL<select value={selected} onChange={(event) => setSelected(event.target.value as ControlId)}>{(Object.keys(CONTROL_NAMES) as ControlId[]).map((id) => <option key={id} value={id}>{CONTROL_NAMES[id]}</option>)}</select></label>
      <label className="editor-slider">SIZE <span>{Math.round(layout[selected].size * 100)}%</span><input type="range" min="55" max="150" value={Math.round(layout[selected].size * 100)} onChange={(event) => setLayout((current) => ({ ...current, [selected]: { ...current[selected], size: Number(event.target.value) / 100 } }))}/></label>
      <label className="editor-slider">OPACITY <span>{Math.round(layout[selected].opacity * 100)}%</span><input type="range" min="25" max="100" value={Math.round(layout[selected].opacity * 100)} onChange={(event) => setLayout((current) => ({ ...current, [selected]: { ...current[selected], opacity: Number(event.target.value) / 100 } }))}/></label>
      <footer><button onClick={() => setLayout(structuredClone(DEFAULT_HUD_LAYOUT))}><RotateCcw size={13}/> RESTORE DEFAULTS</button><button className="editor-done" onClick={() => setEditorOpen(false)}>DONE</button></footer>
    </section>}
    {editorOpen && <div className="editor-tip">DRAG ANY CONTROL TO REPOSITION</div>}
  </div>
}
