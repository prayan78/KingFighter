import { Float, Sparkles } from '@react-three/drei'

const pillars: [number, number][] = [[-7.8, -4.8], [7.8, -4.8], [-7.8, 4.8], [7.8, 4.8]]
export function Arena({ mobile = false }: { mobile?: boolean }) {
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow><planeGeometry args={[200, 200]} /><meshStandardMaterial color="#101520" roughness={0.95} /></mesh>
    <mesh position={[0, -0.08, 0]} receiveShadow><boxGeometry args={[17, 0.32, 10.6]} /><meshStandardMaterial color="#272735" metalness={0.25} roughness={0.72} /></mesh>
    <mesh position={[0, 0.09, 0]} receiveShadow><boxGeometry args={[16.3, 0.08, 9.9]} /><meshStandardMaterial color="#161d2b" metalness={0.32} roughness={0.48} /></mesh>
    <gridHelper args={[16, 32, '#386273', '#243544']} position={[0, 0.14, 0]} />
    {[0, 1].map((i) => <mesh key={`ring-${i}`} position={[0, 0.17 + i * 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[i ? 2.82 : 2.9, i ? 2.86 : 2.94, 96]} /><meshBasicMaterial color={i ? '#c18c56' : '#56c6d4'} transparent opacity={0.7} /></mesh>)}
    {pillars.map(([x, z], i) => <group key={i} position={[x, 0, z]}>
      <mesh position={[0, 1.25, 0]} castShadow><cylinderGeometry args={[0.19, 0.32, 2.5, 8]} /><meshStandardMaterial color="#3b3544" metalness={0.5} roughness={0.38} /></mesh>
      <mesh position={[0, 2.58, 0]}><torusGeometry args={[0.28, 0.045, 8, 20]} /><meshStandardMaterial color={i % 2 ? '#f2a868' : '#4dd9ee'} emissive={i % 2 ? '#b55320' : '#087c9d'} emissiveIntensity={1.7} /></mesh>
      <mesh position={[0, 2.85, 0]}><octahedronGeometry args={[0.12]} /><meshBasicMaterial color={i % 2 ? '#ffc391' : '#8ff7ff'} /></mesh>
      <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.46, 0.46, 0.12, 8]} /><meshStandardMaterial color="#927452" metalness={0.7} /></mesh>
    </group>)}
    <Float speed={0.8} floatIntensity={0.15}><mesh position={[0, 7, -5]}><octahedronGeometry args={[0.65]} /><meshBasicMaterial color="#54d9eb" wireframe transparent opacity={0.22} /></mesh></Float>
    <Sparkles count={mobile ? 18 : 72} scale={[18, 7, 13]} size={mobile ? 1.4 : 2.2} speed={mobile ? 0.12 : 0.25} color="#9acbd8" position={[0, 3.5, 0]} opacity={0.45} />
    <fog attach="fog" args={['#0a1019', 17, 38]} />
  </group>
}
