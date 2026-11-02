import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ABILITIES, type AbilityId, type WorldPoint } from './abilities'
import type { GameState } from './simulation'

export type TargetingState = { id: AbilityId; target: WorldPoint }
export type WorldProjector = { current: ((clientX: number, clientY: number) => WorldPoint | null) | null }

export function AbilityEffects({ game, targeting, projector }: { game: React.MutableRefObject<GameState>; targeting: React.MutableRefObject<TargetingState | null>; projector: WorldProjector }) {
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const intersection = useMemo(() => new THREE.Vector3(), [])
  const rangeRing = useRef<THREE.Mesh>(null)
  const targetMarker = useRef<THREE.Group>(null)
  const directionBeam = useRef<THREE.Mesh>(null)
  const rangeMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const targetMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const beamMaterial = useRef<THREE.MeshBasicMaterial>(null)
  useEffect(() => {
    projector.current = (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const point = raycaster.ray.intersectPlane(plane, intersection)
      return point ? { x: point.x, z: point.z } : null
    }
    return () => { projector.current = null }
  }, [camera, gl, intersection, plane, projector, raycaster])

  useFrame(() => {
    const target = targeting.current
    const player = game.current.player
    if (rangeRing.current) {
      rangeRing.current.visible = Boolean(target)
      if (target) rangeRing.current.position.set(player.x, 0.17, player.z)
    }
    if (targetMarker.current) {
      targetMarker.current.visible = Boolean(target)
      if (target) targetMarker.current.position.set(target.target.x, 0.19, target.target.z)
    }
    if (directionBeam.current) {
      directionBeam.current.visible = Boolean(target)
      if (target) {
        const dx = target.target.x - player.x; const dz = target.target.z - player.z
        const length = Math.hypot(dx, dz)
        directionBeam.current.position.set((target.target.x + player.x) / 2, 0.16, (target.target.z + player.z) / 2)
        directionBeam.current.rotation.set(Math.PI / 2, Math.atan2(dx, dz), 0)
        directionBeam.current.scale.set(1, 1, length)
      }
    }
    const ability = target ? ABILITIES[target.id] : null
    const withinRange = Boolean(target && ability && Math.hypot(target.target.x - player.x, target.target.z - player.z) <= ability.range)
    const activeColor = target ? (withinRange ? (target.id === 'astral-cataclysm' ? '#ffc46e' : '#66e4ef') : '#ff7778') : '#66e4ef'
    rangeMaterial.current?.color.set(activeColor)
    targetMaterial.current?.color.set(activeColor)
    beamMaterial.current?.color.set(activeColor)
  })

  const targetId = targeting.current?.id
  const range = targetId ? ABILITIES[targetId].range : 1
  const areaRadius = targetId ? ABILITIES[targetId].areaRadius ?? 0.42 : 0.42
  const targetColor = targetId === 'astral-cataclysm' ? '#ffc46e' : '#66e4ef'
  return <>
    <mesh ref={rangeRing} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[range - 0.035, range, 80]} /><meshBasicMaterial ref={rangeMaterial} color={targetColor} transparent opacity={0.45} depthWrite={false} /></mesh>
    <mesh ref={directionBeam} visible={false}><cylinderGeometry args={[0.018, 0.018, 1, 8]} /><meshBasicMaterial ref={beamMaterial} color={targetColor} transparent opacity={0.72} depthWrite={false} /></mesh>
    <group ref={targetMarker} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[areaRadius - 0.055, areaRadius, 48]} /><meshBasicMaterial ref={targetMaterial} color={targetColor} transparent opacity={0.85} depthWrite={false} /></mesh>
      <mesh position={[0, 0.05, 0]}><sphereGeometry args={[0.09, 12, 12]} /><meshBasicMaterial color={targetColor} /></mesh>
    </group>
    {(['player', 'rival'] as const).flatMap((side) => game.current[side].abilities.projectiles.map((projectile) => <ProjectileView key={`${side}-${projectile.id}`} game={game} side={side} id={projectile.id} />))}
    {(['player', 'rival'] as const).flatMap((side) => game.current[side].abilities.bursts.map((burst) => <BurstView key={`${side}-${burst.id}`} game={game} side={side} id={burst.id} />))}
  </>
}

function ProjectileView({ game, side, id }: { game: React.MutableRefObject<GameState>; side: 'player' | 'rival'; id: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    const projectile = game.current[side].abilities.projectiles.find((item) => item.id === id)
    if (!mesh.current) return
    mesh.current.visible = Boolean(projectile)
    if (projectile) mesh.current.position.set(projectile.x, 1.15, projectile.z)
    if (material.current) { material.current.color.set(game.current[side].stats.accent); material.current.emissive.set(game.current[side].stats.accent) }
  })
  return <mesh ref={mesh} visible={false}><sphereGeometry args={[0.22, 16, 16]} /><meshStandardMaterial ref={material} color="#74e8ff" emissive="#3dbfee" emissiveIntensity={2.2} /></mesh>
}

function BurstView({ game, side, id }: { game: React.MutableRefObject<GameState>; side: 'player' | 'rival'; id: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => {
    const burst = game.current[side].abilities.bursts.find((item) => item.id === id)
    if (!mesh.current || !material.current) return
    mesh.current.visible = Boolean(burst)
    if (burst) {
      const progress = 1 - burst.life / burst.duration
      mesh.current.position.set(burst.x, 0.22 + progress * 0.22, burst.z)
      mesh.current.scale.setScalar(0.55 + progress * 1.15)
      material.current.opacity = 1 - progress
    }
  })
  const color = game.current[side].stats.accent
  return <mesh ref={mesh} visible={false} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.75, 0.055, 8, 48]} /><meshBasicMaterial ref={material} color={color} transparent opacity={0.9} depthWrite={false} /></mesh>
}
