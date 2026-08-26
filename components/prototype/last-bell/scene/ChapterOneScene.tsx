'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RefObject } from 'react';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import type { DoorSnapshot } from '@/lib/prototypes/last-bell/engine/doors';
import type { LastBellPlayerSnapshot } from '@/lib/prototypes/last-bell/runtime/types';
import { HYOSAN_POST_STRIKE_NIGHT } from '@/lib/prototypes/last-bell/environment-profile';
import type { LastBellQualityTier } from '@/lib/prototypes/last-bell/environment3d';
import { AuthoredEnvironment3d, type LastBellOpeningAssetStatus } from './AuthoredEnvironment3d';
import { SchoolDoor } from './SchoolDoor';
import { POST_STRIKE_RENDER_GUARDRAILS } from './postStrikeLookdev';
import { SchoolBox, SchoolTube } from './SchoolPrimitives';
import { StartRoom } from './StartRoom';

export type ChapterOneSceneProps = {
  entryPhase: EntryDirectorPhase;
  classroomDoorRef: RefObject<DoorSnapshot | null>;
  playerPositionRef: RefObject<{ x: number; z: number }>;
  playerStealth: Pick<LastBellPlayerSnapshot, 'stealthState' | 'hidingSpotId' | 'stealthTransitionSeconds'>;
  quality: LastBellQualityTier;
  reducedMotion?: boolean;
  onEnvironmentMounted: () => void;
  /** The campaign retry CTA retries authored opening assets, never geometry. */
  assetRetryNonce?: number;
  onAssetStatus?: (status: LastBellOpeningAssetStatus) => void;
};

/** A small motivated lift preserves structural detail without flattening the
 * near-black fill or replacing the player's narrow flashlight. */
function ChapterExposure({ coldOpen }: { coldOpen: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- R3F renderer output configuration is scene-owned.
    gl.toneMappingExposure = coldOpen
      ? POST_STRIKE_RENDER_GUARDRAILS.lighting.exposure.coldOpen
      : POST_STRIKE_RENDER_GUARDRAILS.lighting.exposure.playing;
  }, [coldOpen, gl]);
  return null;
}

const CORRIDOR_WINDOW_BAYS = [16.25, 19.85, 23.15] as const;
const CORRIDOR_DEBRIS = [
  [-1.9, 16.8, .38, .14], [1.72, 18.1, .64, .1], [-2.15, 21.4, .42, .12], [1.7, 23.9, .56, .11],
] as const;
const HANGING_FLUORESCENTS = [
  [-.42, 17.2, -.32], [.3, 22.2, .12],
] as const;
const ENTRANCE_BRICK_PATCHES = [
  [-5.45, 1.1, 2.4], [-4.65, 2.35, 1.8], [-3.8, 3.6, 2.15], [4.95, 1.4, 2.35], [4.15, 2.75, 2.1], [5.25, 4.05, 1.6],
] as const;
const ENTRANCE_STRIP_GLYPHS = [
  [-4.55, .28], [-4.08, .16], [-3.72, .24], [-3.28, .18], [-2.86, .3],
  [2.78, .24], [3.18, .16], [3.54, .28], [3.98, .18], [4.36, .26],
] as const;

function CorridorWreck({ x, z, rotation }: { x: number; z: number; rotation: number }) {
  return (
    <group position={[x, .35, z]} rotation={[rotation * .12, rotation, Math.PI / 2.25]}>
      <SchoolBox position={[0, 0, 0]} args={[1.4, .09, .62]} color="#47524e" roughness={.94} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[.12, -.35, .12]} args={[.8, .52, .06]} color="#314548" roughness={.9} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[-.42, -.2, 0]} length={.76} radius={.032} color="#3c5051" rotation={[0, 0, Math.PI / 2]} castShadow={false} receiveShadow={false} />
    </group>
  );
}

/** Only the first corridor bay is mounted for the current human review. */
function Corridor({ coldOpen }: { coldOpen: boolean }) {
  const cyanIntensity = coldOpen ? 1.18 : 1.04;
  return (
    <group>
      <SchoolBox position={[0, -.15, 19.05]} args={[6, .3, 11.9]} color="#2a3d40" roughness={.98} castShadow={false} receiveShadow />
      <SchoolBox position={[2.92, 2, 19.05]} args={[.18, 4, 11.9]} color="#131f22" roughness={1} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 4, 19.05]} args={[6, .2, 11.9]} color="#26383b" roughness={.98} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[0, 2, 25]} args={[6, 4, .18]} color="#091316" roughness={1} castShadow={false} receiveShadow={false} />
      {CORRIDOR_WINDOW_BAYS.map((z, index) => (
        <group key={z} position={[-2.88, 2.35, z]}>
          <SchoolBox position={[0, 0, 0]} args={[.06, 1.92, 2.8]} color="#287984" emissive="#17545c" emissiveIntensity={index === 1 ? .16 : .44} roughness={.84} castShadow={false} receiveShadow={false} />
          {index === 1 && <SchoolBox position={[.03, .1, .45]} args={[.1, 1.32, 1.55]} color="#0b171a" roughness={1} castShadow={false} receiveShadow={false} />}
          <SchoolBox position={[.07, 0, -1.38]} args={[.1, 2.18, .08]} color="#506466" roughness={.72} metalness={.58} castShadow={false} receiveShadow={false} />
          <SchoolBox position={[.07, 0, 1.38]} args={[.1, 2.18, .08]} color="#506466" roughness={.72} metalness={.58} castShadow={false} receiveShadow={false} />
          <SchoolBox position={[.07, -.72, 0]} args={[.1, .08, 2.8]} color="#506466" roughness={.7} metalness={.62} castShadow={false} receiveShadow={false} />
        </group>
      ))}
      {HANGING_FLUORESCENTS.map(([x, z, rotation]) => (
        <group key={z} position={[x, 3.75, z]} rotation={[0, 0, rotation]}>
          <SchoolBox position={[0, 0, 0]} args={[1.34, .08, .32]} color="#485b5d" roughness={.7} metalness={.48} castShadow={false} receiveShadow={false} />
          <SchoolBox position={[.08, -.07, 0]} args={[.88, .03, .16]} color="#a0d4d2" emissive="#63cbd0" emissiveIntensity={.48} roughness={.62} castShadow={false} receiveShadow={false} />
        </group>
      ))}
      {CORRIDOR_DEBRIS.map(([x, z, width, height]) => <SchoolBox key={`${x}:${z}`} position={[x, height / 2, z]} args={[width, height, width * .75]} color="#4a5c5c" roughness={1} castShadow={false} receiveShadow={false} />)}
      <CorridorWreck x={1.85} z={17.2} rotation={.45} />
      <CorridorWreck x={-1.9} z={22.8} rotation={-.62} />
      <pointLight position={[-2.5, 2.25, 17.1]} color="#238e98" intensity={cyanIntensity * 6.6} distance={7.4} decay={1.7} castShadow={false} />
      <pointLight position={[-2.5, 2.4, 23.4]} color="#217985" intensity={cyanIntensity * 5} distance={6.8} decay={1.7} castShadow={false} />
    </group>
  );
}

const ASH_POSITIONS = new Float32Array([
  -4.8, 1.2, 1.5, -2.8, 2.8, 3.2, 1.2, 1.4, 6.8, 4.3, 2.3, 8.1,
  -3.7, 3.1, 10.2, 2.5, 1.7, 11.7, -1.8, 2.1, 14.4, 1.5, 3.2, 17.6,
  -2.1, 1.4, 20.3, .5, 2.5, 22.1, -1.4, 3.1, 24.2,
]);
const LIGHT_SHAFTS = [
  { position: [-4.85, 1.4, 2.3], size: [2.35, 1.55], opacity: .12, rotation: [0, .82, -.5] },
  { position: [-5.1, 1.25, 5.05], size: [1.55, 1.1], opacity: .06, rotation: [0, .88, -.42] },
  { position: [-2.6, 2.35, 17.4], size: [3.2, 2.25], opacity: .22, rotation: [0, Math.PI / 2, -.15] },
  { position: [-2.35, 2.25, 23.2], size: [2.5, 1.85], opacity: .15, rotation: [0, Math.PI / 2, -.15] },
] as const;

function PostStrikeAtmosphere({ reducedMotion, particleCount }: { reducedMotion: boolean; particleCount: number }) {
  const ashRef = useRef<THREE.Points>(null);
  useFrame((_, delta) => {
    const ash = ashRef.current;
    if (!ash || reducedMotion) return;
    ash.rotation.y += delta * .012;
    ash.position.y = Math.sin(performance.now() * .00011) * .025;
  });
  return (
    <group>
      <points ref={ashRef} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[ASH_POSITIONS.slice(0, particleCount * 3), 3]} /></bufferGeometry>
        <pointsMaterial color="#8faead" size={.028} sizeAttenuation transparent opacity={.32} depthWrite={false} />
      </points>
      {LIGHT_SHAFTS.map((shaft, index) => (
        <mesh key={index} position={shaft.position as [number, number, number]} rotation={shaft.rotation as [number, number, number]} castShadow={false} receiveShadow={false}>
          <planeGeometry args={shaft.size as [number, number]} />
          <meshBasicMaterial color="#218f98" transparent opacity={shaft.opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Exterior hinged entrance presentation. It deliberately remains a separate
 * facade from SchoolDoor, whose authored geometry is a classroom slider.
 */
function HyosanEntrance({ visible }: { visible: boolean }) {
  return (
    <group visible={visible} position={[0, 0, -12.6]}>
      <SchoolBox position={[0, 2.7, 0]} args={[14, 5.4, .42]} color="#263638" emissive="#0a1517" emissiveIntensity={.22} roughness={1} castShadow={false} receiveShadow={false} />
      {ENTRANCE_BRICK_PATCHES.map(([x, y, width], index) => (
        <SchoolBox key={index} position={[x, y, -.24]} args={[width, .62, .08]} color={index % 2 ? '#48413c' : '#393d3c'} emissive="#101617" emissiveIntensity={.18} roughness={.98} castShadow={false} receiveShadow={false} />
      ))}
      <SchoolBox position={[0, 2.32, -.3]} args={[12.8, .48, .1]} color="#c6a84f" emissive="#806526" emissiveIntensity={.72} roughness={.72} metalness={.18} castShadow={false} receiveShadow={false} />
      {ENTRANCE_STRIP_GLYPHS.map(([x, width], index) => <SchoolBox key={index} position={[x, 2.32, -.37]} args={[width, .12, .035]} color="#283131" roughness={.9} castShadow={false} receiveShadow={false} />)}
      <SchoolBox position={[0, 1.9, -.32]} args={[7.1, 3.58, .14]} color="#506466" emissive="#152628" emissiveIntensity={.22} roughness={.56} metalness={.68} castShadow={false} receiveShadow={false} />
      {[-2.35, 0, 2.35].map((x) => <SchoolBox key={x} position={[x, 1.9, -.42]} args={[.13, 3.5, .12]} color="#8da5a2" emissive="#1a2c2e" emissiveIntensity={.15} roughness={.42} metalness={.82} castShadow={false} receiveShadow={false} />)}
      <SchoolBox position={[0, 3.55, -.42]} args={[7.15, .13, .12]} color="#8da5a2" emissive="#1a2c2e" emissiveIntensity={.15} roughness={.42} metalness={.82} castShadow={false} receiveShadow={false} />
      <mesh position={[-1.18, 1.95, -.5]} rotation={[0, .04, 0]} castShadow={false} receiveShadow={false}>
        <planeGeometry args={[2.12, 2.86]} />
        <meshStandardMaterial color="#2d7c85" emissive="#11545b" emissiveIntensity={.74} transparent opacity={.62} roughness={.8} metalness={.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[1.18, 1.95, -.5]} rotation={[0, -.04, 0]} castShadow={false} receiveShadow={false}>
        <planeGeometry args={[2.12, 2.86]} />
        <meshStandardMaterial color="#286d76" emissive="#10464c" emissiveIntensity={.6} transparent opacity={.54} roughness={.88} metalness={.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <SchoolTube position={[-.68, 2.55, -.56]} length={1.35} radius={.018} color="#b7d6d2" rotation={[0, 0, .82]} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[.85, 1.5, -.56]} length={.94} radius={.014} color="#b7d6d2" rotation={[0, 0, -.74]} castShadow={false} receiveShadow={false} />
      <SchoolTube position={[1.56, 2.72, -.56]} length={.76} radius={.012} color="#b7d6d2" rotation={[0, 0, .38]} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[-1.15, .66, -.47]} args={[2.08, .15, .12]} color="#46595a" roughness={.54} metalness={.7} castShadow={false} receiveShadow={false} />
      <SchoolBox position={[1.15, .66, -.47]} args={[2.08, .15, .12]} color="#46595a" roughness={.54} metalness={.7} castShadow={false} receiveShadow={false} />
    </group>
  );
}

function ExteriorLighting() {
  const { exterior } = POST_STRIKE_RENDER_GUARDRAILS.lighting;
  return (
    <>
      <directionalLight position={[-4.8, 6.8, -8]} color="#75b4b5" intensity={exterior.directionalCyan} castShadow={false} />
      <pointLight position={[-4, 3.15, -4.2]} color="#2e8e97" intensity={exterior.facadePool} distance={10} decay={1.7} castShadow={false} />
      <pointLight position={[3.5, 2.1, -3.5]} color="#5c8586" intensity={exterior.facadeRim} distance={8} decay={1.65} castShadow={false} />
    </>
  );
}

function InteriorLighting({ coldOpen }: { coldOpen: boolean }) {
  const { interior } = POST_STRIKE_RENDER_GUARDRAILS.lighting;
  const directionalIntensity = coldOpen ? interior.coldOpenDirectionalCyan : interior.directionalCyan;
  return (
    <>
      <directionalLight position={[-4.8, 5.7, 1.2]} color="#77b5b7" intensity={directionalIntensity} castShadow={false} />
      <pointLight position={[-5.75, 2.75, 4.45]} intensity={interior.windowPool} color="#2a95a0" distance={8.6} decay={1.55} castShadow={false} />
      <pointLight position={[2.65, 2.25, 8.65]} intensity={interior.floorPool} color="#4d8589" distance={7.6} decay={1.55} castShadow={false} />
      {coldOpen && (
        <>
          {/* Camera-side cyan key plus one short-range rear pool leave the
              classroom's negative fill intact until the torch turns on. */}
          <directionalLight position={[2.5, 5.6, 11.2]} color="#8bc4c4" intensity={interior.coldOpenDirectionalCyan} castShadow={false} />
          <pointLight position={[2.5, 4.7, 10.8]} intensity={interior.coldOpenRearPool} color="#5aa5a9" distance={9.5} decay={1.45} castShadow={false} />
        </>
      )}
    </>
  );
}

function CorridorWindowLightRig({
  classroomDoorRef,
  playerPositionRef,
}: Pick<ChapterOneSceneProps, 'classroomDoorRef' | 'playerPositionRef'>) {
  const nearWindowRef = useRef<THREE.PointLight>(null);
  const farWindowRef = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const playerZ = playerPositionRef.current?.z ?? 4;
    const doorOpen = (classroomDoorRef.current?.openProgress ?? 0) > .025;
    const visible = doorOpen || playerZ > 12.6;
    if (nearWindowRef.current) nearWindowRef.current.visible = visible;
    if (farWindowRef.current) farWindowRef.current.visible = visible;
  });
  return (
    <>
      {/* Motivated moonlight from the three corridor window bays reveals PBR
          relief and debris only after the opaque classroom portal opens. */}
      <pointLight ref={nearWindowRef} visible={false} position={[-2.55, 2.35, 17.1]} color="#2d929b" intensity={9} distance={8.2} decay={1.72} castShadow={false} />
      <pointLight ref={farWindowRef} visible={false} position={[-2.55, 2.4, 22.6]} color="#267b86" intensity={6.4} distance={7.4} decay={1.72} castShadow={false} />
    </>
  );
}

/**
 * Explicit legacy/QA-only seam. Campaign production never passes this into
 * the authored loader: a failed GLB stays fail-closed and uses the retry CTA.
 */
export function DebugProceduralEnvironmentFallback({
  exteriorEntry,
  coldOpen,
  classroomDoorRef,
}: Pick<ChapterOneSceneProps, 'classroomDoorRef'> & { exteriorEntry: boolean; coldOpen: boolean }) {
  return (
    <>
      <HyosanEntrance visible={exteriorEntry} />
      {!exteriorEntry && (
        <group>
          <StartRoom coldOpen={coldOpen} />
          <Corridor coldOpen={coldOpen} />
          <SchoolDoor snapshotRef={classroomDoorRef} />
        </group>
      )}
    </>
  );
}

export function ChapterOneScene({
  entryPhase,
  classroomDoorRef,
  playerPositionRef,
  playerStealth,
  quality,
  reducedMotion = false,
  onEnvironmentMounted,
  assetRetryNonce,
  onAssetStatus,
}: ChapterOneSceneProps) {
  const coldOpen = entryPhase === 'cold-open';
  const exteriorEntry = entryPhase === 'preflight' || entryPhase === 'brand';

  return (
    <>
      <ChapterExposure coldOpen={coldOpen} />
      <color attach="background" args={[HYOSAN_POST_STRIKE_NIGHT.lighting.background]} />
      <fog attach="fog" args={[HYOSAN_POST_STRIKE_NIGHT.lighting.fog, 8, 32]} />
      {exteriorEntry ? <ExteriorLighting /> : <InteriorLighting coldOpen={coldOpen} />}
      {!exteriorEntry && (
        <CorridorWindowLightRig classroomDoorRef={classroomDoorRef} playerPositionRef={playerPositionRef} />
      )}
      <AuthoredEnvironment3d
        entryPhase={entryPhase}
        classroomDoorRef={classroomDoorRef}
        playerPositionRef={playerPositionRef}
        playerStealth={playerStealth}
        quality={quality}
        onMounted={onEnvironmentMounted}
        retryNonce={assetRetryNonce}
        onAssetStatus={onAssetStatus}
      />
      <PostStrikeAtmosphere reducedMotion={reducedMotion} particleCount={quality.particleCount} />
    </>
  );
}
