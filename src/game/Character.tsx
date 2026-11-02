import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { GameState } from './simulation'

type Props = { game: React.MutableRefObject<GameState>; side: 'player' | 'rival' }
function Capsule({ position, scale, color, radius = 0.2 }: { position: [number, number, number]; scale: [number, number, number]; color: string; radius?: number }) {
  return <mesh position={position} scale={scale} castShadow><capsuleGeometry args={[radius, 0.48, 5, 10]} /><meshStandardMaterial color={color} roughness={0.48} /></mesh>
}

/** Two distinct, rigged-from-primitives hero silhouettes with separate idle, attack, dash and hit motion. */
export function Character({ game, side }: Props) {
  const root = useRef<THREE.Group>(null)
  const detailed = useRef<THREE.Group>(null)
  const lowDetail = useRef<THREE.Group>(null)
  const torso = useRef<THREE.MeshStandardMaterial>(null)
  const blade = useRef<THREE.Group>(null)
  const offhand = useRef<THREE.Group>(null)
  const eye = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock, camera }, dt) => {
    if (!root.current) return
    const fighter = game.current[side]
    const assassin = fighter.stats.heroId === 'nyx'
    const useDetailedModel = camera.position.distanceTo(root.current.position) < 18
    if (detailed.current) detailed.current.visible = useDetailedModel
    if (lowDetail.current) lowDetail.current.visible = !useDetailedModel
    const attacking = fighter.combat.mode === 'attacking'
    const attackPulse = attacking ? Math.sin(Math.min(1, fighter.combat.attackElapsed / 0.3) * Math.PI) : 0
    const idleWave = clock.elapsedTime * (assassin ? 8.2 : 4.8) + (side === 'rival' ? 1.4 : 0)
    root.current.position.set(fighter.x, fighter.elevation + Math.sin(idleWave) * (assassin ? 0.045 : 0.028), fighter.z + (assassin ? attackPulse * 0.16 : 0))
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, fighter.facing, assassin ? 18 : 11, dt)
    root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, attacking && assassin ? -0.08 : 0, 12, dt)
    root.current.rotation.z = THREE.MathUtils.damp(root.current.rotation.z, fighter.combat.mode === 'stunned' ? 0.24 : fighter.combat.mode === 'dodging' ? assassin ? -0.32 : -0.16 : Math.sin(idleWave) * (assassin ? 0.035 : 0.012), 10, dt)
    root.current.scale.setScalar(assassin ? 0.9 : 1)
    if (blade.current) {
      const cut = attacking ? (assassin ? Math.sin(fighter.combat.attackElapsed * 23) * 0.65 : -0.8) : fighter.combat.mode === 'blocking' ? -0.4 : 0
      blade.current.rotation.x = THREE.MathUtils.damp(blade.current.rotation.x, cut, assassin ? 22 : 11, dt)
      blade.current.rotation.z = THREE.MathUtils.damp(blade.current.rotation.z, attacking && assassin ? 0.9 : attacking ? -0.42 : 0, assassin ? 22 : 11, dt)
    }
    if (offhand.current) {
      offhand.current.rotation.x = THREE.MathUtils.damp(offhand.current.rotation.x, attacking ? Math.sin(fighter.combat.attackElapsed * 25) * 0.6 : 0, 22, dt)
      offhand.current.rotation.z = THREE.MathUtils.damp(offhand.current.rotation.z, attacking ? -0.7 : 0.12, 22, dt)
    }
    if (torso.current) torso.current.emissiveIntensity = fighter.hitFlash > 0 ? 1.7 : 0.08
    if (eye.current) eye.current.emissiveIntensity = fighter.combat.mode === 'attacking' ? 2.8 : 1.25
  })

  const stats = game.current[side].stats
  const assassin = stats.heroId === 'nyx'
  const accent = stats.accent
  const secondary = stats.secondary
  const outfit = stats.outfit
  return <group ref={root}><group ref={detailed}>
    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.65, 0.4, 1]}><circleGeometry args={[1, 32]} /><meshBasicMaterial color={accent} transparent opacity={0.2} /></mesh>
    <Capsule position={[-0.18, 0.47, 0]} scale={[0.94, 1, 1]} color={outfit} radius={0.15} />
    <Capsule position={[0.18, 0.47, 0]} scale={[0.94, 1, 1]} color={outfit} radius={0.15} />
    <mesh position={[0, assassin ? 1.16 : 1.28, 0]} scale={assassin ? [0.37, 0.43, 0.25] : [0.43, 0.48, 0.3]} castShadow><capsuleGeometry args={[0.38, 0.24, 5, 12]} /><meshStandardMaterial ref={torso} color={accent} roughness={0.38} emissive={accent} emissiveIntensity={0.08} /></mesh>
    <mesh position={[0, assassin ? 1.62 : 1.77, 0.015]} castShadow><sphereGeometry args={[assassin ? 0.23 : 0.27, 24, 20]} /><meshStandardMaterial color="#eac5a8" roughness={0.55} /></mesh>
    {!assassin ? <>
      <mesh position={[0, 1.99, 0.015]} rotation={[0.16, 0, 0]} castShadow><sphereGeometry args={[0.29, 20, 12, 0, Math.PI * 2, 0, 0.83]} /><meshStandardMaterial color="#18242e" roughness={0.65} /></mesh>
      <mesh position={[0, 1.78, 0.25]}><boxGeometry args={[0.12, 0.035, 0.02]} /><meshBasicMaterial color="#c5fcff" /></mesh>
      <mesh position={[0.32, 1.38, 0.02]} rotation={[0.3, 0, -0.2]} castShadow><boxGeometry args={[0.2, 0.28, 0.22]} /><meshStandardMaterial color={secondary} metalness={0.48} roughness={0.38} /></mesh>
      <group position={[-0.36, 1.25, 0.01]} rotation={[0, 0, -0.18]}><Capsule position={[0, 0, 0]} scale={[0.85, 1, 0.9]} color={outfit} radius={0.14} /></group>
      <group position={[0.36, 1.25, 0.01]} rotation={[0, 0, 0.18]}><Capsule position={[0, 0, 0]} scale={[0.85, 1, 0.9]} color={outfit} radius={0.14} /></group>
      <Sword refGroup={blade} accent={accent} secondary={secondary} assassin={false} />
      <mesh position={[0, 2.24, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.12, 0.018, 8, 24]} /><meshBasicMaterial color={secondary} /></mesh>
    </> : <>
      <mesh position={[0, 1.78, 0]} rotation={[0.12, 0, 0]} castShadow><coneGeometry args={[0.34, 0.76, 6]} /><meshStandardMaterial color="#211d35" metalness={0.22} roughness={0.55} /></mesh>
      <mesh position={[0, 1.62, 0.205]}><boxGeometry args={[0.3, 0.105, 0.055]} /><meshStandardMaterial color="#171524" /></mesh>
      <mesh position={[-0.105, 1.67, 0.238]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial ref={eye} color={secondary} emissive={secondary} emissiveIntensity={1.25} /></mesh>
      <mesh position={[0.105, 1.67, 0.238]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial color={secondary} emissive={secondary} emissiveIntensity={1.25} /></mesh>
      <mesh position={[0, 1.13, -0.22]} rotation={[-0.12, 0, 0]} castShadow><coneGeometry args={[0.5, 1.12, 5]} /><meshStandardMaterial color="#211a31" side={THREE.DoubleSide} roughness={0.78} /></mesh>
      <mesh position={[0, 1.34, 0.025]} rotation={[0, 0, 0.16]} castShadow><boxGeometry args={[0.53, 0.1, 0.34]} /><meshStandardMaterial color={secondary} metalness={0.45} roughness={0.3} /></mesh>
      <group position={[-0.34, 1.19, 0.02]} rotation={[0, 0, -0.32]}><Capsule position={[0, 0, 0]} scale={[0.72, 1, 0.8]} color={outfit} radius={0.13} /></group>
      <group position={[0.34, 1.19, 0.02]} rotation={[0, 0, 0.32]}><Capsule position={[0, 0, 0]} scale={[0.72, 1, 0.8]} color={outfit} radius={0.13} /></group>
      <Sword refGroup={blade} accent={accent} secondary={secondary} assassin />
      <Sword refGroup={offhand} accent={accent} secondary={secondary} assassin leftHand />
    </>}
  </group><group ref={lowDetail} visible={false}><mesh position={[0, 0.82, 0]} castShadow><capsuleGeometry args={[0.3, 0.95, 3, 6]} /><meshStandardMaterial color={outfit} roughness={0.7} /></mesh><mesh position={[0, 1.53, 0]}><sphereGeometry args={[0.22, 8, 6]} /><meshStandardMaterial color={accent} roughness={0.8} /></mesh><mesh position={[0.3, 1.12, 0.04]} rotation={[0, 0, -0.55]}><boxGeometry args={[0.06, 0.56, 0.06]} /><meshBasicMaterial color={secondary} /></mesh></group></group>
}

function Sword({ refGroup, accent, secondary, assassin, leftHand = false }: { refGroup: React.RefObject<THREE.Group | null>; accent: string; secondary: string; assassin: boolean; leftHand?: boolean }) {
  return <group ref={refGroup} position={assassin ? [leftHand ? -0.36 : 0.36, 1.08, 0.3] : [0.43, 1.05, 0.33]} rotation={[0, 0, leftHand ? 0.18 : -0.18]}>
    <mesh position={[0, assassin ? 0.28 : 0.48, 0]} castShadow><boxGeometry args={assassin ? [0.055, 0.57, 0.035] : [0.075, 0.92, 0.045]} /><meshStandardMaterial color={accent} metalness={0.78} roughness={0.2} emissive={accent} emissiveIntensity={0.6} /></mesh>
    <mesh position={[0, 0.04, 0]}><boxGeometry args={[assassin ? 0.2 : 0.3, 0.055, 0.09]} /><meshStandardMaterial color={secondary} metalness={0.72} /></mesh>
    <mesh position={[0, -0.13, 0]}><cylinderGeometry args={[0.04, 0.05, 0.25, 8]} /><meshStandardMaterial color="#272333" /></mesh>
  </group>
}
