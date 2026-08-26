'use client';

export type SchoolBoxProps = {
  position: [number, number, number];
  args: [number, number, number];
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

/** A deliberately small shared primitive for authored school modules. */
export function SchoolBox({
  position,
  args,
  color,
  roughness = .84,
  metalness = 0,
  emissive,
  emissiveIntensity = 0,
  castShadow = true,
  receiveShadow = true,
}: SchoolBoxProps) {
  return (
    <mesh position={position} castShadow={castShadow} receiveShadow={receiveShadow}>
      <boxGeometry args={args} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
    </mesh>
  );
}

export type SchoolTubeProps = {
  position: [number, number, number];
  length: number;
  radius?: number;
  color: string;
  rotation?: [number, number, number];
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

/** An eight-sided tube gives school furniture rounded steel silhouettes while
 * staying cheap enough for the first chapter's repeatable prop language. */
export function SchoolTube({
  position,
  length,
  radius = .045,
  color,
  rotation = [0, 0, 0],
  roughness = .38,
  metalness = .66,
  castShadow = true,
  receiveShadow = true,
}: SchoolTubeProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow={castShadow} receiveShadow={receiveShadow}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}
