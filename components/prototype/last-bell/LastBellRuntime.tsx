'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import type { LastBellState } from '@/lib/prototypes/last-bell/state';
import { LAST_BELL_ANCHORS } from '@/lib/prototypes/last-bell/state';
import { clampLastBellPosition, LAST_BELL_FIXED_STEP, stepLastBellPosition } from '@/lib/prototypes/last-bell/engine/movement';
import { checkpointPositionFor } from '@/lib/prototypes/last-bell/engine/checkpoint';
import { LAST_BELL_CHASE_SPAWN, stepLastBellEscapeChase, type ChaseEnemy } from '@/lib/prototypes/last-bell/engine/chase';
import { LAST_BELL_ASSETS } from '@/lib/prototypes/last-bell/assets';
import styles from './last-bell.module.css';

type InputVector = { x: number; y: number };
type Position = { x: number; z: number };

export type LastBellRuntimeProps = {
  state: LastBellState;
  moveRef: MutableRefObject<InputVector>;
  lookRef: MutableRefObject<InputVector>;
  runRef: MutableRefObject<boolean>;
  resetNonce: number;
  checkpoint: LastBellState['checkpoint'];
  active: boolean;
  onPosition: (position: Position) => void;
  onDanger: (distance: number) => void;
  onCanvasInteract: () => void;
};

const wallMaterial = { color: '#c7beaa', roughness: .88, metalness: 0 };
const sageMaterial = { color: '#465b4a', roughness: .96, metalness: 0 };
const woodMaterial = { color: '#72563b', roughness: .9, metalness: 0 };

type SchoolTextures = Partial<Record<keyof typeof LAST_BELL_ASSETS.materials, THREE.Texture>>;
const schoolTextureCache: SchoolTextures = {};
const schoolTextureVariantCache = new Map<string, THREE.Texture>();
const SCHOOL_MATERIAL_KEYS: Array<Exclude<keyof typeof LAST_BELL_ASSETS.materials, 'atlas'>> = [
  'agedIvoryPlaster',
  'institutionalSagePaint',
  'darkGrayLinoleum',
  'wiredFrostedGlass',
  'beigeLockerMetal',
  'wornDeskWood',
];

function repeatedTexture(texture: THREE.Texture | undefined, cacheKey: string, repeatX: number, repeatY: number): THREE.Texture | undefined {
  if (!texture) return undefined;
  const cached = schoolTextureVariantCache.get(cacheKey);
  if (cached) return cached;
  const variant = texture.clone();
  variant.needsUpdate = true;
  variant.wrapS = THREE.RepeatWrapping;
  variant.wrapT = THREE.RepeatWrapping;
  variant.repeat.set(repeatX, repeatY);
  schoolTextureVariantCache.set(cacheKey, variant);
  return variant;
}

function useSchoolTextures(anisotropy: number): SchoolTextures {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    SCHOOL_MATERIAL_KEYS.forEach((textureKey) => {
      const path = LAST_BELL_ASSETS.materials[textureKey];
      if (schoolTextureCache[textureKey]) return;
      loader.load(path, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = anisotropy;
        schoolTextureCache[textureKey] = texture;
        setVersion((value) => value + 1);
      }, undefined, () => {
        // Generated material maps are an enhancement; procedural colors remain valid.
      });
    });
  }, [anisotropy]);
  return schoolTextureCache;
}

function Box({ position, args, color, emissive, intensity = 0, map, roughness = .84, metalness = 0, envMapIntensity = 1 }: { position: [number, number, number]; args: [number, number, number]; color: string; emissive?: string; intensity?: number; map?: THREE.Texture; roughness?: number; metalness?: number; envMapIntensity?: number }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={map ? '#ffffff' : color} map={map} roughness={roughness} metalness={metalness} envMapIntensity={envMapIntensity} emissive={emissive} emissiveIntensity={intensity} />
    </mesh>
  );
}

function Desk({ x, z, rotation = 0, texture }: { x: number; z: number; rotation?: number; texture?: THREE.Texture }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <Box position={[0, 1, 0]} args={[1.7, .12, .7]} {...woodMaterial} map={texture} roughness={.62} />
      <Box position={[-.68, .5, -.24]} args={[.08, 1, .08]} color="#3e3329" />
      <Box position={[.68, .5, -.24]} args={[.08, 1, .08]} color="#3e3329" />
      <Box position={[-.68, .5, .24]} args={[.08, 1, .08]} color="#3e3329" />
      <Box position={[.68, .5, .24]} args={[.08, 1, .08]} color="#3e3329" />
      <Box position={[0, .57, .48]} args={[1.2, .75, .06]} color="#17271f" />
    </group>
  );
}

function Classroom({ textures }: { textures: SchoolTextures }) {
  const desks = useMemo(() => [-1.9, 1.1, 4.1, 7.1].flatMap((z) => [-3.5, -1.1, 1.3, 3.7].map((x) => ({ x, z }))), []);
  const plaster = repeatedTexture(textures.agedIvoryPlaster, 'plaster-4x1.5', 4, 1.5);
  const linoleum = repeatedTexture(textures.darkGrayLinoleum, 'linoleum-classroom-2x8', 2, 8);
  const wood = repeatedTexture(textures.wornDeskWood, 'desk-wood-1x1', 1, 1);
  return (
    <group>
      <Box position={[0, -.14, 6]} args={[14, .28, 16]} color="#3d4038" map={linoleum} roughness={.54} envMapIntensity={.2} />
      <Box position={[-7, 2, 6]} args={[.24, 4, 16]} {...wallMaterial} map={plaster} roughness={.82} />
      <Box position={[7, 2, 6]} args={[.24, 4, 16]} {...wallMaterial} map={plaster} roughness={.82} />
      <Box position={[0, 3.4, -2]} args={[14, 2.8, .24]} {...wallMaterial} map={plaster} roughness={.82} />
      <Box position={[-5.8, 2.8, 14]} args={[2.4, 2.4, .2]} color="#c7beaa" />
      <Box position={[5.8, 2.8, 14]} args={[2.4, 2.4, .2]} color="#c7beaa" />
      <Box position={[0, 2.7, -1.84]} args={[7.5, 1.65, .12]} color="#17271f" />
      <Box position={[0, 1, -.95]} args={[2.9, .95, .78]} color="#72563b" />
      <Box position={[0, 1.54, -.95]} args={[3.15, .07, .92]} color="#8f6c4b" />
      {desks.map((desk) => <Desk key={`${desk.x}:${desk.z}`} {...desk} texture={wood} />)}
      <Box position={[-5.8, 1.5, 5.5]} args={[.8, 2.8, 1.3]} color="#d1c8b5" />
      <Box position={[-5.8, 2.2, 5.5]} args={[.84, .08, 1.33]} color="#465b4a" />
      <Box position={[5.8, 1.5, 5.5]} args={[.8, 2.8, 1.3]} color="#d1c8b5" />
      {[1.5, 6.2, 10.8].map((z) => (
        <group key={`window-${z}`} position={[-6.84, 2.35, z]}>
          <Box position={[0, 0, 0]} args={[.04, 1.45, 2.7]} color="#b9dbd9" emissive="#b9dbd9" intensity={.12} />
          <Box position={[.05, 0, -.72]} args={[.07, 1.62, .08]} color="#9d927b" />
          <Box position={[.05, 0, .72]} args={[.07, 1.62, .08]} color="#9d927b" />
        </group>
      ))}
    </group>
  );
}

function Corridor({ textures }: { textures: SchoolTextures }) {
  const doors = useMemo(() => [18, 24, 31, 37, 44].map((z) => z), []);
  const plaster = repeatedTexture(textures.agedIvoryPlaster, 'plaster-4x1.5', 4, 1.5);
  const sage = repeatedTexture(textures.institutionalSagePaint, 'sage-4x1', 4, 1);
  const linoleum = repeatedTexture(textures.darkGrayLinoleum, 'linoleum-corridor-2x20', 2, 20);
  const locker = repeatedTexture(textures.beigeLockerMetal, 'locker-1x2', 1, 2);
  return (
    <group>
      <Box position={[0, -.15, 34]} args={[6, .3, 42]} color="#343a35" map={linoleum} roughness={.54} envMapIntensity={.2} />
      <Box position={[-3, .92, 34]} args={[.24, 1.85, 42]} {...sageMaterial} map={sage} roughness={.78} />
      <Box position={[-3, 2.87, 34]} args={[.24, 2.05, 42]} {...wallMaterial} map={plaster} roughness={.82} />
      <Box position={[3, .92, 34]} args={[.24, 1.85, 42]} {...sageMaterial} map={sage} roughness={.78} />
      <Box position={[3, 2.87, 34]} args={[.24, 2.05, 42]} {...wallMaterial} map={plaster} roughness={.82} />
      <Box position={[0, 4, 34]} args={[6, .24, 42]} color="#242b27" />
      {doors.map((z) => (
        <group key={z} position={[-2.82, 1.5, z]}>
          <Box position={[0, 0, 0]} args={[.1, 2.8, 1.9]} color="#9e967f" />
          <Box position={[.08, .15, 0]} args={[.06, 2.1, 1.45]} color="#465b4a" />
        </group>
      ))}
      {[22, 34].map((z) => (
        <group key={`locker-${z}`} position={[-2.82, 1.35, z]}>
          {[0, .55, 1.1].map((offset) => <Box key={offset} position={[0, 0, offset - .55]} args={[.16, 2.35, .45]} color="#687064" map={locker} roughness={.58} metalness={.08} />)}
          <Box position={[.1, -.04, 0]} args={[.05, .06, 1.8]} color="#b9dbd9" emissive="#b9dbd9" intensity={.12} />
        </group>
      ))}
      {[26, 38].map((z) => (
        <group key={`alcove-${z}`} position={[2.72, .62, z]}>
          <Box position={[0, 0, -.72]} args={[.36, 1.25, .12]} color="#9d927b" />
          <Box position={[0, 0, .72]} args={[.36, 1.25, .12]} color="#9d927b" />
          <Box position={[0, .08, 0]} args={[.36, .12, 1.55]} color="#72563b" />
        </group>
      ))}
      {[20, 28, 36, 44].map((z) => <Box key={z} position={[2.82, 1.8, z]} args={[.1, 2.8, 2]} color="#b2aa97" />)}
      {[17, 26, 35, 44].map((z) => (
        <group key={z}>
          <Box position={[0, 3.83, z]} args={[1.2, .08, .34]} color="#b9dbd9" emissive="#b9dbd9" intensity={1.15} />
          <pointLight position={[0, 3.45, z]} color="#b9dbd9" intensity={2.1} distance={8} decay={2} />
        </group>
      ))}
      <pointLight position={[0, 1.9, 41]} color="#c3292e" intensity={2.4} distance={7} decay={2} />
      {[19, 30, 43].map((z) => (
        <group key={`poster-${z}`} position={[2.84, 2.25, z]}>
          <Box position={[0, 0, 0]} args={[.04, .9, .62]} color={z === 30 ? '#c7beaa' : '#72563b'} />
          <Box position={[-.03, .05, 0]} args={[.04, .05, .38]} color="#e5a45c" emissive="#e5a45c" intensity={.2} />
        </group>
      ))}
      <group position={[2.78, 1.12, 33.2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <cylinderGeometry args={[.18, .18, .72, 10]} />
          <meshStandardMaterial color="#c3292e" roughness={.55} />
        </mesh>
        <Box position={[0, -.44, 0]} args={[.16, .12, .12]} color="#a99e8a" />
      </group>
      <mesh position={[-2.86, 2.9, 29]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[.055, .055, 3.2, 8]} />
        <meshStandardMaterial color="#858276" metalness={.65} roughness={.35} />
      </mesh>
    </group>
  );
}

function Door({ z, locked, fire = false, textures }: { z: number; locked: boolean; fire?: boolean; textures: SchoolTextures }) {
  const glass = repeatedTexture(textures.wiredFrostedGlass, 'glass-1.2x1.6', 1.2, 1.6);
  return (
    <group position={[0, 1.5, z]}>
      <Box position={[-1.14, 0, 0]} args={[.16, 3, .22]} color="#9d927b" />
      <Box position={[1.14, 0, 0]} args={[.16, 3, .22]} color="#9d927b" />
      <Box position={[0, 1.42, 0]} args={[2.45, .16, .22]} color="#9d927b" />
      <group position={[locked ? 1.55 : 0, 0, .02]}>
        <Box position={[0, 0, 0]} args={[2.05, 2.75, .1]} color={fire ? '#6e2e2d' : '#465b4a'} />
        <mesh position={[0, .25, .07]}>
          <planeGeometry args={[1.48, 1.75]} />
          <meshPhysicalMaterial color={glass ? '#ffffff' : '#b9dbd9'} map={glass} roughness={.68} metalness={0} transmission={.2} transparent opacity={.62} />
        </mesh>
        <Box position={[.78, .05, .14]} args={[.08, .15, .06]} color={locked ? '#c3292e' : '#e5a45c'} emissive={locked ? '#c3292e' : '#e5a45c'} intensity={.7} />
      </group>
      <Box position={[0, -.65, .13]} args={[2.1, .08, .12]} color="#72563b" />
    </group>
  );
}

function UtilityPanel({ active }: { active: boolean }) {
  return (
    <group position={[3, 1.55, 29]} rotation={[0, -Math.PI / 2, 0]}>
      <Box position={[0, 0, 0]} args={[1.5, 2.35, .18]} color="#858276" />
      <Box position={[0, .3, .12]} args={[1.15, 1.45, .03]} color="#202825" />
      <Box position={[-.3, .28, .16]} args={[.18, .76, .07]} color={active ? '#b9dbd9' : '#c3292e'} emissive={active ? '#b9dbd9' : '#c3292e'} intensity={active ? .9 : .35} />
      <Box position={[.15, .28, .16]} args={[.18, .76, .07]} color={active ? '#b9dbd9' : '#c3292e'} emissive={active ? '#b9dbd9' : '#c3292e'} intensity={active ? .9 : .35} />
      <Box position={[.5, .28, .16]} args={[.18, .76, .07]} color={active ? '#b9dbd9' : '#c3292e'} emissive={active ? '#b9dbd9' : '#c3292e'} intensity={active ? .9 : .35} />
    </group>
  );
}

function Bell({ active }: { active: boolean }) {
  return (
    <group position={[0, 3.1, 48]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[.52, .75, .8, 20]} />
        <meshStandardMaterial color="#8e7350" metalness={.7} roughness={.32} emissive={active ? '#c3292e' : '#000'} emissiveIntensity={active ? .9 : 0} />
      </mesh>
      <pointLight color={active ? '#c3292e' : '#e5a45c'} intensity={active ? 7 : .4} distance={8} />
    </group>
  );
}

function Enemy({ z, x, active, enemyRef }: { z: number; x: number; active: boolean; enemyRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={enemyRef} position={[x, 0, z]} visible={active}>
      <mesh position={[0, 1.65, 0]}>
        <capsuleGeometry args={[.3, 1.05, 4, 8]} />
        <meshStandardMaterial color="#101613" roughness={1} transparent opacity={.9} />
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <sphereGeometry args={[.38, 8, 6]} />
        <meshStandardMaterial color="#111915" roughness={1} transparent opacity={.9} />
      </mesh>
      <mesh position={[-.47, 1.65, .04]} rotation={[0, 0, -.28]}>
        <capsuleGeometry args={[.1, .75, 3, 6]} />
        <meshStandardMaterial color="#101613" roughness={1} transparent opacity={.86} />
      </mesh>
      <mesh position={[.47, 1.56, -.03]} rotation={[0, 0, .4]}>
        <capsuleGeometry args={[.1, .8, 3, 6]} />
        <meshStandardMaterial color="#101613" roughness={1} transparent opacity={.86} />
      </mesh>
      <mesh position={[-.18, .55, 0]} rotation={[0, 0, -.1]}>
        <capsuleGeometry args={[.12, .74, 3, 6]} />
        <meshStandardMaterial color="#101613" roughness={1} transparent opacity={.86} />
      </mesh>
      <mesh position={[.2, .55, .02]} rotation={[0, 0, .1]}>
        <capsuleGeometry args={[.12, .74, 3, 6]} />
        <meshStandardMaterial color="#101613" roughness={1} transparent opacity={.86} />
      </mesh>
      <pointLight position={[0, 1.4, -.2]} color="#c3292e" intensity={.35} distance={2.4} />
    </group>
  );
}

function Scene({ state, moveRef, lookRef, runRef, resetNonce, checkpoint, active, onPosition, onDanger, onCanvasInteract }: LastBellRuntimeProps) {
  const { camera, gl } = useThree();
  const textures = useSchoolTextures(Math.min(gl.capabilities.getMaxAnisotropy(), 4));
  const positionRef = useRef<Position>({ x: 0, z: 9 });
  const yawRef = useRef(Math.PI);
  const pitchRef = useRef(0);
  const chaseRef = useRef(0);
  const patrolRef = useRef(0);
  const chaseStartedRef = useRef(false);
  const enemyPositionsRef = useRef<ChaseEnemy[]>(LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy })));
  const accumulatorRef = useRef(0);
  const lastReportRef = useRef(0);
  const enemyOneRef = useRef<THREE.Group>(null);
  const enemyTwoRef = useRef<THREE.Group>(null);
  const checkpointRef = useRef(checkpoint);

  useEffect(() => {
    checkpointRef.current = checkpoint;
  }, [checkpoint]);

  useEffect(() => {
    gl.domElement.addEventListener('pointerdown', onCanvasInteract);
    return () => gl.domElement.removeEventListener('pointerdown', onCanvasInteract);
  }, [gl, onCanvasInteract]);

  useEffect(() => {
    const checkpointState = checkpointPositionFor(checkpointRef.current);
    const checkpointPosition = { x: checkpointState.x, z: checkpointState.z };
    positionRef.current = checkpointPosition;
    yawRef.current = checkpointState.yaw;
    pitchRef.current = 0;
    chaseRef.current = checkpointState.chaseSeconds;
    patrolRef.current = 0;
    chaseStartedRef.current = false;
    enemyPositionsRef.current = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
    accumulatorRef.current = 0;
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    camera.position.set(checkpointPosition.x, 1.68, checkpointPosition.z);
    camera.rotation.set(0, checkpointState.yaw, 0, 'YXZ');
  }, [camera, moveRef, lookRef, resetNonce, runRef]);

  useFrame((_, delta) => {
    if (!active) {
      moveRef.current = { x: 0, y: 0 };
      lookRef.current = { x: 0, y: 0 };
      runRef.current = false;
      return;
    }
    const input = state.hiding ? { x: 0, y: 0 } : moveRef.current;
    accumulatorRef.current += Math.min(delta, .1);
    while (accumulatorRef.current >= LAST_BELL_FIXED_STEP) {
      positionRef.current = clampLastBellPosition(
        stepLastBellPosition(positionRef.current, input, yawRef.current, LAST_BELL_FIXED_STEP, runRef.current ? 3.35 : 1.85),
        { doorLocked: state.doorLocked, fireDoorLocked: state.fireDoorLocked },
      );
      accumulatorRef.current -= LAST_BELL_FIXED_STEP;
    }
    const next = positionRef.current;

    yawRef.current -= lookRef.current.x * .0022;
    pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - lookRef.current.y * .0022, -1.15, 1.15);
    lookRef.current.x = 0;
    lookRef.current.y = 0;
    camera.position.set(next.x, 1.68 + (state.hiding ? -.22 : 0), next.z);
    camera.rotation.set(pitchRef.current, yawRef.current, 0, 'YXZ');

    const now = performance.now();
    const shouldReport = now - lastReportRef.current > 120;
    if (shouldReport) {
      onPosition(next);
      lastReportRef.current = now;
    }

    const activeChase = state.bellTriggered && state.phase !== 'complete' && state.phase !== 'opening';
    patrolRef.current += delta;
    if (activeChase && !chaseStartedRef.current) {
      chaseStartedRef.current = true;
      enemyPositionsRef.current = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
    }
    let distance: number;
    if (activeChase) {
      distance = stepLastBellEscapeChase(next, enemyPositionsRef.current, delta, state.hiding);
    } else {
      enemyPositionsRef.current[0] = { x: 1.4, z: 45 + Math.sin(patrolRef.current * .45) * 2 };
      enemyPositionsRef.current[1] = { x: -1.1, z: 47 + Math.sin(patrolRef.current * .38 + 1.2) * 1.5 };
      distance = Math.min(
        Math.hypot(next.x - enemyPositionsRef.current[0].x, next.z - enemyPositionsRef.current[0].z),
        Math.hypot(next.x - enemyPositionsRef.current[1].x, next.z - enemyPositionsRef.current[1].z),
      );
    }
    if (shouldReport) onDanger(distance);
    if (enemyOneRef.current) enemyOneRef.current.position.set(enemyPositionsRef.current[0].x, 0, enemyPositionsRef.current[0].z);
    if (enemyTwoRef.current) enemyTwoRef.current.position.set(enemyPositionsRef.current[1].x, 0, enemyPositionsRef.current[1].z);
    const sway = Math.sin(performance.now() * .006) * (state.bellTriggered ? .08 : .025);
    if (enemyOneRef.current) enemyOneRef.current.rotation.z = sway;
    if (enemyTwoRef.current) enemyTwoRef.current.rotation.z = -sway * 1.2;
  });

  return (
    <>
      <color attach="background" args={[state.bellTriggered ? '#251d1d' : '#202a25']} />
      <fog attach="fog" args={[state.bellTriggered ? '#251d1d' : '#202a25', 12, 58]} />
      <ambientLight intensity={state.phase === 'classroom' ? .9 : .46} color={state.phase === 'classroom' ? '#e5d3b8' : '#b9dbd9'} />
      <directionalLight position={[-5, 9, 2]} intensity={state.phase === 'classroom' ? 2.2 : .55} color={state.phase === 'classroom' ? '#e5a45c' : '#b9dbd9'} />
      <pointLight position={[0, 2.6, 15]} intensity={state.phase === 'classroom' ? .2 : 1.1} color="#c3292e" distance={12} />
      <pointLight position={[0, 2.4, 48]} intensity={state.bellTriggered ? 5.5 : .15} color="#c3292e" distance={14} decay={2} />
      <Classroom textures={textures} />
      <Corridor textures={textures} />
      <Door z={13} locked={state.doorLocked} textures={textures} />
      <Door z={41} locked={state.fireDoorLocked} fire textures={textures} />
      <UtilityPanel active={state.powerRestored} />
      <Bell active={state.bellTriggered} />
      <Enemy enemyRef={enemyOneRef} z={52} x={1.4} active={state.doorLocked && state.phase !== 'complete'} />
      <Enemy enemyRef={enemyTwoRef} z={54.4} x={-1.1} active={state.doorLocked && state.phase !== 'complete'} />
      <mesh position={[LAST_BELL_ANCHORS.chapter_exit.x, .02, LAST_BELL_ANCHORS.chapter_exit.z]}>
        <circleGeometry args={[1.25, 32]} />
        <meshBasicMaterial color="#e5a45c" transparent opacity={state.phase === 'complete' ? .22 : 0} />
      </mesh>
    </>
  );
}

export function LastBellRuntime(props: LastBellRuntimeProps) {
  return (
    <Canvas
      className={styles.canvas}
      camera={{ position: [0, 1.68, 9], fov: 68, near: .05, far: 80 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => { gl.setClearColor('#171d1a'); }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
