'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { POST_STRIKE_RENDER_GUARDRAILS } from './postStrikeLookdev';
import { SchoolBox, SchoolTube } from './SchoolPrimitives';

type StartRoomProps = {
  coldOpen: boolean;
};

const CHARRED_CONCRETE = '#384f52';
const EXPOSED_BRICK = '#675d52';
const SMOKED_ALUMINIUM = '#51696b';
const SOOT = '#050b0d';
const CYAN_GLASS = '#0a1c1f';
const CYAN_WINDOW_EDGE = '#3b858c';
const SPLINTERED_WOOD = '#655d50';

type RubblePiece = readonly [x: number, z: number, size: number, rotation: number];

// The centre stays clear from spawn to the classroom slider. Damage is laid in
// side lanes so the authored destruction never lies about the collision route.
const CLASSROOM_RUBBLE: readonly RubblePiece[] = [
  [-5.55, 1.2, .22, .4], [-4.7, 2.5, .18, 1.2], [4.8, 2.1, .28, .1], [5.72, 3.6, .16, 2.2],
  [-5.9, 5.9, .25, .7], [-4.45, 6.65, .15, 1.4], [4.2, 5.65, .22, .2], [5.5, 7.2, .3, 2.5],
  [-2.7, 4.65, .18, .3], [-1.45, 5.15, .16, 1.1], [1.1, 4.8, .2, .6], [2.45, 5.35, .17, 2.2],
  [-2.35, 6.3, .22, .9], [-.95, 6.7, .14, .2], [1.2, 6.2, .19, 1.5], [2.6, 7.05, .2, .45],
  [-2.65, 7.75, .16, 2.4], [1.55, 7.55, .18, .7],
  [-1.55, 6.25, .16, .5], [1.42, 6.82, .22, 1.2], [-1.25, 8.15, .15, 2.1], [1.58, 9.15, .2, .3],
  [-5.2, 8.25, .18, .5], [-4.25, 9.8, .34, 1], [4.1, 9.2, .2, 1.9], [5.7, 10.8, .25, .3],
  [-5.8, 11.55, .28, 2.2], [-4.5, 12.15, .18, .4], [4.4, 11.9, .2, .8], [5.7, 12.55, .24, 1.6],
];

const CEILING_PANELS = [
  [-5.15, 7.25, 1.18], [5.1, 8.9, 1.26], [-5.05, 10.75, 1.34], [4.9, 12.15, 1.2],
] as const;

const WINDOW_BAYS = [1.25, 4.45, 7.65, 10.85] as const;

function RubbleField({ pieces }: { pieces: readonly RubblePiece[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrices = useMemo(() => {
    const dummy = new THREE.Object3D();
    return pieces.map(([x, z, size, rotation]) => {
      dummy.position.set(x, size * .38, z);
      dummy.rotation.set(rotation * .18, rotation, rotation * .12);
      dummy.scale.set(size * 1.6, size * .72, size);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, [pieces]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, pieces.length]} castShadow={false} receiveShadow={false}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#667572" emissive="#172d2f" emissiveIntensity={.12} roughness={.98} metalness={.02} />
    </instancedMesh>
  );
}

function BrokenDesk({ position, rotation = 0, toppled = false }: {
  position: [number, number, number];
  rotation?: number;
  toppled?: boolean;
}) {
  return (
    <group position={position} rotation={toppled ? [0, rotation, Math.PI / 2.15] : [0, rotation, 0]}>
      <SchoolBox position={[0, .92, 0]} args={[1.45, .09, .62]} color={SPLINTERED_WOOD} emissive="#222928" emissiveIntensity={.09} roughness={.86} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, .58, .22]} args={[1.12, .44, .045]} color="#55584f" emissive="#17201f" emissiveIntensity={.07} roughness={.9} castShadow={false} receiveShadow={false} />
      {([-1, 1] as const).flatMap((side) => ([-1, 1] as const).map((depth) => (
        <SchoolTube key={`${side}:${depth}`} position={[side * .56, .42, depth * .21]} length={.82} radius={.035} color="#405454" castShadow={false} receiveShadow={false} />
      )))}
    </group>
  );
}

function BrokenChair({ position, rotation = 0 }: {
  position: [number, number, number];
  rotation?: number;
}) {
  return (
    <group position={position} rotation={[Math.PI / 2.08, rotation, -.2]}>
      <SchoolBox position={[0, .52, 0]} args={[.68, .07, .64]} color={SPLINTERED_WOOD} emissive="#222928" emissiveIntensity={.08} roughness={.9} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, .86, .26]} args={[.68, .62, .06]} color="#5a554b" emissive="#1b2220" emissiveIntensity={.06} roughness={.92} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[-.26, .25, 0]} length={.64} radius={.032} color="#3d5151" rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false} />
    </group>
  );
}

function BrokenWindow({ z, missing }: { z: number; missing: boolean }) {
  return (
    <group position={[-6.77, 2.32, z]}>
      {/* The opening stays dark; cyan belongs to its broken edge and the
          localized spill, not a glowing rectangular pane. */}
      <SchoolBox position={[0, 0, 0]} args={[.06, 1.95, 2.65]} color={CYAN_GLASS} emissive="#020d0f" emissiveIntensity={.12} roughness={.76} castShadow={false} receiveShadow={false} />
      {missing && <SchoolBox position={[.015, .12, -.45]} args={[.08, 1.36, 1.36]} color={SOOT} roughness={1} castShadow={false} receiveShadow={false} />}
      <SchoolBox position={[.07, 0, -1.3]} args={[.1, 2.18, .08]} color={CYAN_WINDOW_EDGE} emissive="#104b50" emissiveIntensity={.22} roughness={.56} metalness={.62} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[.07, 0, 1.3]} args={[.1, 2.18, .08]} color={CYAN_WINDOW_EDGE} emissive="#104b50" emissiveIntensity={.22} roughness={.56} metalness={.62} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[.07, -.7, 0]} args={[.1, .08, 2.65]} color={SMOKED_ALUMINIUM} emissive="#163335" emissiveIntensity={.1} roughness={.58} metalness={.64} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[.07, .62, missing ? -.42 : 0]} args={[.1, .07, missing ? 1.55 : 2.65]} color={CYAN_WINDOW_EDGE} emissive="#104b50" emissiveIntensity={.18} roughness={.56} metalness={.65} castShadow={false} receiveShadow={false} />
    </group>
  );
}

function ColdOpenOccluder() {
  const { foregroundOccluder } = POST_STRIKE_RENDER_GUARDRAILS.composition;
  return (
    // Lower-left foreground cue only. The guardrail limits it to 20% of the
    // rear-facing cinematic frame and keeps it away from the player seam.
    <group position={foregroundOccluder.position as [number, number, number]} scale={foregroundOccluder.scale as [number, number, number]} rotation={[.03, -.12, Math.PI / 2.35]}>
      <BrokenDesk position={[0, 0, 0]} rotation={.15} toppled />
      <SchoolBox position={[-.72, .14, .46]} args={[.95, .18, .72]} color="#435554" roughness={.98} castShadow={false} receiveShadow={false} />
    </group>
  );
}

/**
 * Destroyed post-strike classroom. The geometry has no gameplay collision;
 * movement retains its stable bounds and the clear centre lane communicates
 * the path to the existing first-door anchor.
 */
export function StartRoom({ coldOpen }: StartRoomProps) {
  const { coldOpenDeskPositions } = POST_STRIKE_RENDER_GUARDRAILS.composition;
  return (
    <group>
      <SchoolBox position={[0, -.14, 5.55]} args={[14, .28, 15.5]} color="#3a5457" emissive="#10292b" emissiveIntensity={.14} roughness={.98} receiveShadow />
      <SchoolBox position={[-6.9, 2.25, 5.55]} args={[.2, 3.55, 15.5]} color={CHARRED_CONCRETE} emissive="#10272a" emissiveIntensity={.09} roughness={.96} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[6.9, 2.25, 5.55]} args={[.2, 3.55, 15.5]} color="#243638" roughness={.98} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 2.3, -1.9]} args={[14, 3.45, .2]} color={CHARRED_CONCRETE} emissive="#10272a" emissiveIntensity={.1} roughness={.98} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, .92, -1.76]} args={[14, 1.84, .08]} color="#3b5659" emissive="#10282b" emissiveIntensity={.12} roughness={.94} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[-4.6, 2.52, -1.73]} args={[2.9, 1.42, .04]} color={EXPOSED_BRICK} emissive="#242825" emissiveIntensity={.1} roughness={1} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[4.75, 2.36, -1.73]} args={[2.15, 1.64, .04]} color={EXPOSED_BRICK} emissive="#242825" emissiveIntensity={.1} roughness={1} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 2.78, -1.67]} args={[7.85, 1.58, .08]} color="#29494c" emissive="#10282b" emissiveIntensity={.18} roughness={.96} castShadow={false} receiveShadow />
      <SchoolBox position={[0, 3.6, -1.6]} args={[8.04, .075, .14]} color="#678082" emissive="#1d3c3f" emissiveIntensity={.18} roughness={.72} metalness={.2} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[-3.98, 2.78, -1.6]} args={[.075, 1.66, .14]} color="#5d7576" emissive="#183336" emissiveIntensity={.12} roughness={.76} metalness={.2} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[3.98, 2.78, -1.6]} args={[.075, 1.66, .14]} color="#5d7576" emissive="#183336" emissiveIntensity={.12} roughness={.76} metalness={.2} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 1.9, -1.6]} args={[8.08, .07, .14]} color="#617778" emissive="#183538" emissiveIntensity={.16} roughness={.76} metalness={.22} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[-.7, 1.06, -.68]} args={[2.8, .7, .6]} color={SPLINTERED_WOOD} emissive="#222927" emissiveIntensity={.08} roughness={.94} castShadow={false} receiveShadow={false} />

      {CEILING_PANELS.map(([x, z, length]) => <SchoolBox key={`${x}:${z}`} position={[x, 4.18, z]} args={[2.7, .06, length]} color="#314548" roughness={.98} castShadow={false} receiveShadow={false} />)}
      {[-4.6, -.9, 2.8, 6.35, 9.95, 12.4].map((z) => <SchoolTube key={z} position={[0, 3.82, z]} length={13.45} radius={.06} color="#435759" rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false} />)}
      <SchoolTube position={[-4.25, 3.45, 6.3]} length={2.25} radius={.055} color="#485957" rotation={[.42, 0, .05]} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[3.2, 3.42, 9.15]} length={1.75} radius={.05} color="#485957" rotation={[-.46, .22, -.1]} castShadow={false} receiveShadow={false} />

      <SchoolBox position={[-4.42, 2.92, 13.1]} args={[5.15, 2.42, .24]} color={CHARRED_CONCRETE} roughness={.97} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[4.42, 2.72, 13.1]} args={[5.15, 2.8, .24]} color="#263a3d" roughness={.98} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 3.58, 13.1]} args={[14, .76, .24]} color={CHARRED_CONCRETE} roughness={.98} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[-5.65, 2.1, 13.03]} args={[.85, 1.45, .055]} color={EXPOSED_BRICK} roughness={1} castShadow={false} receiveShadow={false} />

      {WINDOW_BAYS.map((z, index) => <BrokenWindow key={z} z={z} missing={index === 1 || index === 3} />)}
      <RubbleField pieces={CLASSROOM_RUBBLE} />
      {/* The two overturned desks compose the rear-facing cold-open but stay
          off the stable spawn-to-door lane and carry no gameplay collision. */}
      <BrokenDesk position={coldOpenDeskPositions[0] as [number, number, number]} rotation={.7} toppled />
      <BrokenDesk position={coldOpenDeskPositions[1] as [number, number, number]} rotation={-.44} toppled />
      <BrokenDesk position={[-4.45, 0, 10.55]} rotation={.2} />
      <BrokenChair position={[4.9, .18, 4.25]} rotation={.7} />
      <BrokenChair position={[-4.3, .16, 8.55]} rotation={-.6} />
      {coldOpen && <ColdOpenOccluder />}
    </group>
  );
}
