'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import type { LastBellState } from '@/lib/prototypes/last-bell/state';
import { clampLastBellPosition, LAST_BELL_FIXED_STEP, stepLastBellPosition, type LastBellDoorHandoff } from '@/lib/prototypes/last-bell/engine/movement';
import { checkpointPositionFor } from '@/lib/prototypes/last-bell/engine/checkpoint';
import { createLastBellActivityClock, stepLastBellActivityClock } from '@/lib/prototypes/last-bell/engine/activity-clock';
import {
  CHAPTER_01_CLASSROOM_DOOR_PORTAL,
  CHAPTER_01_CONTENT,
  CHAPTER_01_PLAYER_START,
} from '@/lib/prototypes/last-bell/content/chapter-01';
import { createDoorSystem, type DoorCommand, type DoorLifecycle, type DoorSnapshot } from '@/lib/prototypes/last-bell/engine/doors';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import { HYOSAN_POST_STRIKE_NIGHT } from '@/lib/prototypes/last-bell/environment-profile';
import { lastBellQualityTierForDpr } from '@/lib/prototypes/last-bell/environment3d';
import {
  LastBellSimulation,
  LAST_BELL_SIMULATION_STEP_SECONDS,
} from '@/lib/prototypes/last-bell/runtime/simulation';
import type {
  LastBellRuntimeEvent,
  LastBellSimulationSnapshot,
} from '@/lib/prototypes/last-bell/runtime/types';
import { ChapterOneScene } from './scene/ChapterOneScene';
import { FlashlightRig } from './scene/FlashlightRig';
import { POST_STRIKE_RENDER_GUARDRAILS } from './scene/postStrikeLookdev';
import styles from './last-bell.module.css';

type InputVector = { x: number; y: number };
type Position = { x: number; z: number };
const NOOP_SCENE_READY = () => {};

type RuntimeQaMetrics = {
  renderer?: { calls: number; triangles: number; points: number; lines: number };
  fps?: number;
};

function publishRuntimeQaMetrics(patch: RuntimeQaMetrics): void {
  const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
  scope.__ICONS_LAST_BELL_QA__ = { ...scope.__ICONS_LAST_BELL_QA__, ...patch };
}

/** The pre-existing fire-door handoff is intentionally separate from the classroom slider. */
export type LastBellDoorHandoffCommand = LastBellDoorHandoff & { nonce: number };
export type EntryPhase = EntryDirectorPhase;
export type DoorPhase = DoorLifecycle;

export type LastBellSceneDoorCommand = {
  door: 'classroom' | 'fire';
  action: 'open' | 'close-lock';
  nonce: number;
};

/** Optional bridge for the verified two-chapter host. The legacy QA client can omit it. */
export type LastBellRuntimeCommand = {
  interactionId: string;
  nonce: number;
};

export type LastBellRuntimeProps = {
  state: LastBellState;
  moveRef: MutableRefObject<InputVector>;
  lookRef: MutableRefObject<InputVector>;
  runRef: MutableRefObject<boolean>;
  resetNonce: number;
  checkpoint: LastBellState['checkpoint'];
  active: boolean;
  /** Existing fire-door handoff; classroom passage is command-driven and never teleports. */
  handoff?: LastBellDoorHandoffCommand | null;
  entryPhase?: EntryPhase;
  flashlightOn?: boolean;
  crouching?: boolean;
  doorCommand?: LastBellSceneDoorCommand | null;
  runtimeCommand?: LastBellRuntimeCommand | null;
  /** 0 disables camera bob; values above 1 are clamped to the authored maximum. */
  headBobStrength?: number;
  /** Reduced motion removes JavaScript camera interpolation and bob. */
  reducedMotion?: boolean;
  onSceneReady?: () => void;
  onDoorStateChange?: (door: 'classroom' | 'fire', phase: DoorPhase) => void;
  onPosition: (position: Position) => void;
  onDanger: (distance: number) => void;
  onActiveTime: (durationMs: number) => void;
  onSimulationStep: (durationMs: number, flags: { listening: boolean; hiding: boolean; running: boolean }) => void;
  /** Emits renderer-independent campaign events; it never creates a reward locally. */
  onRuntimeEvent?: (event: LastBellRuntimeEvent) => void;
  onRuntimeSnapshot?: (snapshot: LastBellSimulationSnapshot) => void;
  onCanvasInteract: () => void;
};

function playerOccupant(position: Position) {
  return {
    id: 'player',
    bounds: {
      min: { x: position.x - .26, y: 0, z: position.z - .26 },
      max: { x: position.x + .26, y: 1.8, z: position.z + .26 },
    },
  };
}

function classroomDoorSnapshot(system: ReturnType<typeof createDoorSystem>): DoorSnapshot | null {
  return system.snapshot().doors.find((door) => door.id === 'door.classroom.slide') ?? null;
}

function enqueueClassroomDoorCommand(pending: DoorCommand[], action: LastBellSceneDoorCommand['action']): void {
  if (action === 'open') {
    pending.push({ doorId: 'door.classroom.slide', type: 'open' });
    return;
  }
  pending.push({ doorId: 'door.classroom.slide', type: 'close' });
  pending.push({ doorId: 'door.classroom.slide', type: 'lock' });
}

function RuntimeScene({
  state,
  moveRef,
  lookRef,
  runRef,
  resetNonce,
  checkpoint,
  active,
  handoff,
  entryPhase = 'playing',
  flashlightOn = true,
  crouching = false,
  doorCommand = null,
  runtimeCommand = null,
  headBobStrength = 1,
  reducedMotion = false,
  onDoorStateChange,
  onPosition,
  onDanger,
  onActiveTime,
  onSimulationStep,
  onRuntimeEvent,
  onRuntimeSnapshot,
  onCanvasInteract,
  onSceneReady,
}: LastBellRuntimeProps) {
  const { camera, gl } = useThree();
  const dpr = useThree((three) => three.viewport.dpr);
  const quality = lastBellQualityTierForDpr(dpr);
  const positionRef = useRef<Position>({ x: CHAPTER_01_PLAYER_START.x, z: CHAPTER_01_PLAYER_START.z });
  const yawRef = useRef(Math.PI);
  const pitchRef = useRef(0);
  const accumulatorRef = useRef(0);
  const lastReportRef = useRef(0);
  const qaElapsedRef = useRef(0);
  const qaFramesRef = useRef(0);
  const activityClockRef = useRef(createLastBellActivityClock());
  const activeRef = useRef(active);
  const checkpointRef = useRef(checkpoint);
  const headBobPhaseRef = useRef(0);
  const lastResetNonceRef = useRef<number | null>(null);
  const lastDoorCommandNonceRef = useRef<number | null>(null);
  const lastLegacyHandoffNonceRef = useRef<number | null>(null);
  const pendingDoorCommandsRef = useRef<DoorCommand[]>([]);
  const campaignSimulationRef = useRef(new LastBellSimulation());
  const runtimeEventCallbackRef = useRef(onRuntimeEvent);
  const runtimeSnapshotCallbackRef = useRef(onRuntimeSnapshot);
  const lastRuntimeCommandNonceRef = useRef<number | null>(null);
  const [initialDoorSystem] = useState(() => createDoorSystem(CHAPTER_01_CONTENT.doors));
  const [initialClassroomDoor] = useState(() => classroomDoorSnapshot(initialDoorSystem));
  const doorSystemRef = useRef(initialDoorSystem);
  const classroomDoorRef = useRef<DoorSnapshot | null>(initialClassroomDoor);
  const lastClassroomDoorPhaseRef = useRef<DoorPhase>(initialClassroomDoor?.state ?? 'closed');
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    cameraRef.current = camera as THREE.PerspectiveCamera;
  }, [camera]);

  useEffect(() => {
    checkpointRef.current = checkpoint;
  }, [checkpoint]);

  useEffect(() => {
    activeRef.current = active;
    activityClockRef.current = createLastBellActivityClock(
      active && document.visibilityState === 'visible' ? performance.now() : undefined,
    );
  }, [active]);

  useEffect(() => {
    const resetActivityClock = () => {
      activityClockRef.current = createLastBellActivityClock(
        activeRef.current && document.visibilityState === 'visible' ? performance.now() : undefined,
      );
    };
    document.addEventListener('visibilitychange', resetActivityClock);
    return () => document.removeEventListener('visibilitychange', resetActivityClock);
  }, []);

  useEffect(() => {
    gl.domElement.addEventListener('pointerdown', onCanvasInteract);
    return () => gl.domElement.removeEventListener('pointerdown', onCanvasInteract);
  }, [gl, onCanvasInteract]);

  useEffect(() => {
    if (!doorCommand || doorCommand.door !== 'classroom') return;
    if (lastDoorCommandNonceRef.current === doorCommand.nonce) return;
    lastDoorCommandNonceRef.current = doorCommand.nonce;
    enqueueClassroomDoorCommand(pendingDoorCommandsRef.current, doorCommand.action);
    campaignSimulationRef.current.queueInteraction(
      doorCommand.action === 'open' ? 'ch1.classroom-door.open' : 'ch1.classroom-door.lock',
    );
  }, [doorCommand]);

  useEffect(() => {
    runtimeEventCallbackRef.current = onRuntimeEvent;
    runtimeSnapshotCallbackRef.current = onRuntimeSnapshot;
  }, [onRuntimeEvent, onRuntimeSnapshot]);

  useEffect(() => {
    if (!runtimeCommand || lastRuntimeCommandNonceRef.current === runtimeCommand.nonce) return;
    lastRuntimeCommandNonceRef.current = runtimeCommand.nonce;
    campaignSimulationRef.current.queueInteraction(runtimeCommand.interactionId);
  }, [runtimeCommand]);

  useEffect(() => {
    if (!handoff || lastLegacyHandoffNonceRef.current === handoff.nonce) return;
    lastLegacyHandoffNonceRef.current = handoff.nonce;
    positionRef.current = { ...handoff.position };
    yawRef.current = handoff.yaw;
    pitchRef.current = 0;
    accumulatorRef.current = 0;
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    camera.position.set(handoff.position.x, 1.68, handoff.position.z);
    camera.rotation.set(0, handoff.yaw, 0, 'YXZ');
  }, [camera, handoff, lookRef, moveRef, runRef]);

  useEffect(() => {
    if (lastResetNonceRef.current === resetNonce) return;
    lastResetNonceRef.current = resetNonce;
    const checkpointState = checkpointPositionFor(checkpointRef.current);
    const checkpointPosition = { x: checkpointState.x, z: checkpointState.z };
    positionRef.current = checkpointPosition;
    yawRef.current = checkpointState.yaw;
    pitchRef.current = 0;
    headBobPhaseRef.current = 0;
    const checkpointAfterClassroomDoor = checkpointPosition.z >= CHAPTER_01_CLASSROOM_DOOR_PORTAL.max.z + .26;
    accumulatorRef.current = 0;
    pendingDoorCommandsRef.current = [];
    const system = createDoorSystem(CHAPTER_01_CONTENT.doors);
    if (state.doorLocked || checkpointAfterClassroomDoor) system.advance({ deltaSeconds: 0, commands: [{ doorId: 'door.classroom.slide', type: 'lock' }] });
    doorSystemRef.current = system;
    // The authored first-bay renderer retains its existing contract. The full
    // campaign sim is reset beside it, never by a mesh transform or React UI.
    campaignSimulationRef.current = new LastBellSimulation();
    classroomDoorRef.current = classroomDoorSnapshot(system);
    lastClassroomDoorPhaseRef.current = classroomDoorRef.current?.state ?? 'closed';
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    camera.position.set(checkpointPosition.x, 1.68, checkpointPosition.z);
    camera.rotation.set(0, checkpointState.yaw, 0, 'YXZ');
  }, [camera, lookRef, moveRef, resetNonce, runRef, state.doorLocked]);

  useFrame((_, delta) => {
    const sceneCamera = cameraRef.current;
    if (!sceneCamera) return;
    qaElapsedRef.current += delta;
    qaFramesRef.current += 1;
    if (qaElapsedRef.current >= 1) {
      publishRuntimeQaMetrics({
        renderer: {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          points: gl.info.render.points,
          lines: gl.info.render.lines,
        },
        fps: Number((qaFramesRef.current / qaElapsedRef.current).toFixed(1)),
      });
      qaElapsedRef.current = 0;
      qaFramesRef.current = 0;
    }
    const cinematicPhase = entryPhase !== 'playing';
    if (cinematicPhase) {
      const exteriorEntry = entryPhase === 'preflight' || entryPhase === 'brand';
      const lowInteriorColdOpen = entryPhase === 'cold-open';
      // The entry facade is separate. Cold-open takes the authored rear-room
      // composition, while aperture resolves to the stable player-start seam.
      const targetX = exteriorEntry
        ? POST_STRIKE_RENDER_GUARDRAILS.camera.entry.position[0]
        : lowInteriorColdOpen
          ? POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen.position[0]
          : CHAPTER_01_PLAYER_START.x;
      const targetHeight = exteriorEntry
        ? POST_STRIKE_RENDER_GUARDRAILS.camera.entry.position[1]
        : lowInteriorColdOpen
          ? POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen.position[1]
          : CHAPTER_01_PLAYER_START.y;
      const targetZ = exteriorEntry
        ? POST_STRIKE_RENDER_GUARDRAILS.camera.entry.position[2]
        : lowInteriorColdOpen
          ? POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen.position[2]
          : CHAPTER_01_PLAYER_START.z;
      const targetYaw = exteriorEntry
        ? POST_STRIKE_RENDER_GUARDRAILS.camera.entry.yaw
        : lowInteriorColdOpen
          ? POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen.yaw
          : Math.PI;
      const targetPitch = lowInteriorColdOpen ? POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen.pitch : 0;
      if (reducedMotion) {
        sceneCamera.position.set(targetX, targetHeight, targetZ);
        yawRef.current = targetYaw;
        pitchRef.current = targetPitch;
      } else {
        sceneCamera.position.x = THREE.MathUtils.damp(sceneCamera.position.x, targetX, 8, delta);
        sceneCamera.position.y = THREE.MathUtils.damp(sceneCamera.position.y, targetHeight, 8, delta);
        sceneCamera.position.z = THREE.MathUtils.damp(sceneCamera.position.z, targetZ, 8, delta);
        yawRef.current = THREE.MathUtils.damp(yawRef.current, targetYaw, 8, delta);
        pitchRef.current = THREE.MathUtils.damp(pitchRef.current, targetPitch, 8, delta);
      }
      sceneCamera.rotation.set(pitchRef.current, yawRef.current, 0, 'YXZ');
    }

    const activityFrame = stepLastBellActivityClock(activityClockRef.current, performance.now(), {
      active,
      visible: document.visibilityState === 'visible',
    });
    activityClockRef.current = activityFrame.clock;
    if (activityFrame.activeDurationMs > 0) onActiveTime(activityFrame.activeDurationMs);

    if (!active || cinematicPhase) {
      moveRef.current = { x: 0, y: 0 };
      lookRef.current = { x: 0, y: 0 };
      runRef.current = false;
      return;
    }

    const input = state.hiding ? { x: 0, y: 0 } : moveRef.current;
    accumulatorRef.current += Math.min(delta, .1);
    while (accumulatorRef.current >= LAST_BELL_FIXED_STEP) {
      const previousPosition = positionRef.current;
      const system = doorSystemRef.current!;
      const doorFrame = system.advance({
        deltaSeconds: LAST_BELL_FIXED_STEP,
        commands: pendingDoorCommandsRef.current.splice(0),
        occupants: [playerOccupant(previousPosition)],
      });
      const nextDoor = doorFrame.doors.find((door) => door.id === 'door.classroom.slide') ?? null;
      classroomDoorRef.current = nextDoor;
      if (nextDoor && nextDoor.state !== lastClassroomDoorPhaseRef.current) {
        lastClassroomDoorPhaseRef.current = nextDoor.state;
        onDoorStateChange?.('classroom', nextDoor.state);
      }

      positionRef.current = clampLastBellPosition(
        stepLastBellPosition(previousPosition, input, yawRef.current, LAST_BELL_FIXED_STEP, crouching ? 1.12 : runRef.current ? 3.35 : 1.85),
        {
          fireDoorLocked: true,
          classroomDoorPassable: nextDoor?.passable === true,
          classroomDoorPortal: {
            min: CHAPTER_01_CLASSROOM_DOOR_PORTAL.min,
            max: CHAPTER_01_CLASSROOM_DOOR_PORTAL.max,
          },
        },
        previousPosition,
      );
      onSimulationStep(LAST_BELL_FIXED_STEP * 1000, {
        listening: state.listening,
        hiding: state.hiding,
        running: runRef.current,
      });
      const campaignFrame = campaignSimulationRef.current.advance(LAST_BELL_SIMULATION_STEP_SECONDS, {
        movement: input,
        facingRadians: yawRef.current,
        flashlightOn,
        listening: state.listening,
        hiding: state.hiding,
        running: runRef.current,
      });
      for (const event of campaignFrame.events) runtimeEventCallbackRef.current?.(event);
      runtimeSnapshotCallbackRef.current?.(campaignFrame.snapshot);
      accumulatorRef.current -= LAST_BELL_FIXED_STEP;
    }

    yawRef.current -= lookRef.current.x * .0022;
    pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - lookRef.current.y * .0022, -1.15, 1.15);
    lookRef.current.x = 0;
    lookRef.current.y = 0;
    const next = positionRef.current;
    const moving = !state.hiding && Math.hypot(input.x, input.y) > .08;
    const clampedHeadBob = reducedMotion ? 0 : THREE.MathUtils.clamp(headBobStrength, 0, 1);
    if (moving && !reducedMotion) headBobPhaseRef.current += delta * (runRef.current ? 12.5 : 8.2);
    const bob = moving ? Math.sin(headBobPhaseRef.current) * .012 * clampedHeadBob : 0;
    sceneCamera.position.set(next.x, 1.68 + (state.hiding ? -.74 : crouching ? -.34 : 0) + bob, next.z);
    sceneCamera.rotation.set(pitchRef.current, yawRef.current, 0, 'YXZ');

    const now = performance.now();
    const shouldReport = now - lastReportRef.current > 120;
    if (shouldReport) {
      onPosition(next);
      lastReportRef.current = now;
    }

    if (shouldReport) onDanger(99);
  });

  return (
    <>
      {/* The torch stays off for the low post-strike cold-open; it starts only
          at the existing aperture/player handoff, without changing control. */}
      <FlashlightRig on={flashlightOn && entryPhase === 'playing'} shadowMapSize={quality.shadowMapSize} />
      <ChapterOneScene
        entryPhase={entryPhase}
        classroomDoorRef={classroomDoorRef}
        playerPositionRef={positionRef}
        playerStealth={{
          stealthState: state.hiding ? 'hidden' : crouching ? 'crouched' : 'standing',
          hidingSpotId: state.hiding ? 'ch1.hide.desk' : null,
          stealthTransitionSeconds: 0,
        }}
        quality={quality}
        reducedMotion={reducedMotion}
        onEnvironmentMounted={onSceneReady ?? NOOP_SCENE_READY}
      />
    </>
  );
}

export function LastBellRuntime(props: LastBellRuntimeProps) {
  return (
    <Canvas
      className={styles.canvas}
      camera={{
        position: POST_STRIKE_RENDER_GUARDRAILS.camera.entry.position as [number, number, number],
        fov: POST_STRIKE_RENDER_GUARDRAILS.camera.projection.fov,
        near: POST_STRIKE_RENDER_GUARDRAILS.camera.projection.near,
        far: POST_STRIKE_RENDER_GUARDRAILS.camera.projection.far,
      }}
      dpr={[1, 1.35]}
      shadows="soft"
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = HYOSAN_POST_STRIKE_NIGHT.lighting.exposure;
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.setClearColor('#05090c');
      }}
    >
      <RuntimeScene {...props} />
    </Canvas>
  );
}

export default LastBellRuntime;
