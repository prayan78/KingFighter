import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { GameState } from './simulation'

/** Smooth, opponent-aware arena camera. */
export function CameraRig({ game }: { game: React.MutableRefObject<GameState> }) {
  const { camera } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    const { player, rival } = game.current
    const midX = (player.x + rival.x) * 0.5
    const midZ = (player.z + rival.z) * 0.5
    const span = Math.hypot(player.x - rival.x, player.z - rival.z)
    const target = new THREE.Vector3(midX, 7.8 + Math.min(span * 0.11, 1.1), midZ + 11.8 + span * 0.12)
    camera.position.lerp(target, 1 - Math.exp(-delta * 2.4))
    look.set(midX, 0.8, midZ)
    camera.lookAt(look)
  })
  return null
}
