'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RefObject } from 'react';
import type { DoorSnapshot } from '@/lib/prototypes/last-bell/engine/doors';
import { SchoolBox, SchoolTube } from './SchoolPrimitives';

export type SchoolDoorProps = {
  snapshotRef: RefObject<DoorSnapshot | null>;
};

const SMOKED_ALUMINIUM = '#3b4f50';
const BENT_ALUMINIUM = '#61706d';
const SOOT = '#0a0e10';

function GlassFragments() {
  return (
    <>
      <mesh position={[-.18, .58, -.04]} rotation={[0, .1, 0]} castShadow={false} receiveShadow>
        <planeGeometry args={[.38, .86]} />
        <meshStandardMaterial color="#1b6e73" emissive="#0d4549" emissiveIntensity={.32} transparent opacity={.42} roughness={.84} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[.24, -.04, -.04]} rotation={[0, -.18, 0]} castShadow={false} receiveShadow>
        <planeGeometry args={[.3, .66]} />
        <meshStandardMaterial color="#14555b" emissive="#0d3338" emissiveIntensity={.24} transparent opacity={.32} roughness={.9} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/** A damaged classroom slider fallback, deliberately not an exterior hinge door. */
function DoorPanel({ direction }: { direction: -1 | 1 }) {
  const missingGlazing = direction === -1;

  return (
    <group rotation={[0, 0, direction * .025]}>
      <SchoolBox position={[-.49, 0, .01]} args={[.08, 2.68, .09]} color={SMOKED_ALUMINIUM} roughness={.7} metalness={.62} castShadow={false} receiveShadow />
      <SchoolBox position={[.49, direction * .03, .01]} args={[.08, 2.58, .09]} color={SMOKED_ALUMINIUM} roughness={.72} metalness={.62} castShadow={false} receiveShadow />
      <SchoolBox position={[0, 1.29, .01]} args={[1.06, .08, .09]} color={BENT_ALUMINIUM} roughness={.66} metalness={.68} castShadow={false} receiveShadow />
      <SchoolBox position={[0, -.55, .01]} args={[1.06, .075, .09]} color={BENT_ALUMINIUM} roughness={.72} metalness={.66} castShadow={false} receiveShadow />
      {missingGlazing ? <GlassFragments /> : (
        <mesh position={[0, .39, -.035]} castShadow={false} receiveShadow>
          <planeGeometry args={[.88, 1.68]} />
          <meshStandardMaterial color="#1a6268" emissive="#0b3035" emissiveIntensity={.28} transparent opacity={.5} roughness={.88} metalness={.04} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <SchoolBox position={[0, -.96, .01]} args={[.9, .7, .075]} color="#263537" roughness={.8} metalness={.38} castShadow={false} receiveShadow />
      <SchoolBox position={[0, -.66, -.04]} args={[.78, .035, .055]} color="#7d8d86" roughness={.48} metalness={.72} castShadow={false} receiveShadow />
      <SchoolTube position={[-direction * .18, -.25, -.09]} length={.48} radius={.032} color="#83938d" roughness={.42} metalness={.76} castShadow={false} receiveShadow />
      <SchoolTube position={[direction * .16, .18, -.085]} length={.42} radius={.012} color={SOOT} rotation={[0, 0, Math.PI / 3]} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[-direction * .08, .56, -.085]} length={.3} radius={.009} color={SOOT} rotation={[0, 0, -Math.PI / 4]} castShadow={false} receiveShadow={false} />
    </group>
  );
}

/**
 * DoorSystem remains the sole motion source: render motion and the fixed-step
 * collider read the same snapshot, including open -> cross -> close -> lock.
 */
export function SchoolDoor({ snapshotRef }: SchoolDoorProps) {
  const leftPanelRef = useRef<THREE.Group>(null);
  const rightPanelRef = useRef<THREE.Group>(null);
  const railRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    const base = snapshot.render.closedTransform.position;
    if (railRef.current) railRef.current.position.set(base.x, base.y, base.z);
    const panelTravel = snapshot.openProgress * 1.04;
    if (leftPanelRef.current) leftPanelRef.current.position.x = -.54 - panelTravel;
    if (rightPanelRef.current) rightPanelRef.current.position.x = .54 + panelTravel;
  });

  return (
    <group ref={railRef} position={[0, 1.5, 13]}>
      <SchoolBox position={[-1.3, .03, 0]} args={[.14, 3.06, .24]} color={SMOKED_ALUMINIUM} roughness={.68} metalness={.7} receiveShadow />
      <SchoolBox position={[1.3, -.05, 0]} args={[.12, 2.94, .22]} color={SMOKED_ALUMINIUM} roughness={.72} metalness={.66} receiveShadow />
      <SchoolBox position={[0, 1.43, 0]} args={[2.72, .15, .24]} color={BENT_ALUMINIUM} roughness={.58} metalness={.76} receiveShadow />
      <SchoolBox position={[.16, 1.69, -.05]} args={[3.18, .085, .18]} color="#283738" roughness={.76} metalness={.68} castShadow={false} receiveShadow />
      <SchoolTube position={[-.08, 1.61, -.17]} length={3.1} radius={.035} color="#74847e" rotation={[0, 0, Math.PI / 2]} roughness={.44} metalness={.82} castShadow={false} receiveShadow />
      <SchoolBox position={[0, -1.46, .03]} args={[2.72, .1, .28]} color="#263335" roughness={.84} metalness={.36} castShadow={false} receiveShadow />
      <SchoolTube position={[1.12, .72, -.15]} length={.6} radius={.014} color={SOOT} rotation={[0, 0, -.45]} castShadow={false} receiveShadow={false} />
      <group ref={leftPanelRef} position={[-.54, 0, 0]}><DoorPanel direction={-1} /></group>
      <group ref={rightPanelRef} position={[.54, 0, 0]}><DoorPanel direction={1} /></group>
    </group>
  );
}
