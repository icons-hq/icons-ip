'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import { lastBellQualityTierForDpr } from '@/lib/prototypes/last-bell/environment3d';
import { hidingSpotById } from '@/lib/prototypes/last-bell/runtime/world';
import {
  LastBellSimulation,
  LAST_BELL_SIMULATION_STEP_SECONDS,
} from '@/lib/prototypes/last-bell/runtime/simulation';
import type {
  ChapterId,
  CollectibleKey,
  LastBellRuntimeEvent,
  LastBellSimulationSnapshot,
} from '@/lib/prototypes/last-bell/runtime/types';
import { ChapterOneScene } from './scene/ChapterOneScene';
import type { LastBellOpeningAssetStatus } from './scene/AuthoredEnvironment3d';
import { FlashlightRig, LAST_BELL_FLASHLIGHT_PROFILE } from './scene/FlashlightRig';
import { TwoChapterWorldScene } from './scene/campaign/TwoChapterWorldScene';
import type { LastBellQaNamraHybridMode } from './scene/campaign/campaignAssets';
import type { LastBellCampaignAssetKey } from './scene/campaign/campaignStreaming';
import { POST_STRIKE_RENDER_GUARDRAILS } from './scene/postStrikeLookdev';
import styles from './last-bell.module.css';

type InputVector = { x: number; y: number };

export type LastBellCampaignInteractionCommand = Readonly<{ interactionId: string; nonce: number }>;

export type LastBellCampaignRuntimeProps = Readonly<{
  initialChapter: ChapterId;
  runMode: 'first-play' | 'chapter-replay';
  progressStage: number;
  committedCollectibles: readonly CollectibleKey[];
  pendingCollectibles: readonly CollectibleKey[];
  readFrameInput: () => Readonly<{ movement: InputVector; look: InputVector; running: boolean }>;
  active: boolean;
  entryPhase: EntryDirectorPhase;
  flashlightOn: boolean;
  listening: boolean;
  crouching: boolean;
  resetNonce: number;
  openingHandoffNonce: number;
  retryNonce: number;
  assetRetryNonce: number;
  interactionCommand: LastBellCampaignInteractionCommand | null;
  reducedMotion: boolean;
  onSceneReady: () => void;
  onSnapshot: (snapshot: LastBellSimulationSnapshot) => void;
  onEvent: (event: LastBellRuntimeEvent, snapshot: LastBellSimulationSnapshot) => void;
  onCanvasInteract: () => void;
  onAssetStatus?: (status: Readonly<{ failedAssetKeys: readonly LastBellCampaignAssetKey[]; criticalAssetFailure: boolean }>) => void;
  onOpeningAssetStatus?: (status: LastBellOpeningAssetStatus) => void;
  onContextState?: (state: 'lost' | 'restored') => void;
  /** Development-only private image-impostor review. Never a release mode. */
  qaNamraHybridMode?: LastBellQaNamraHybridMode | null;
}>;

function publishCampaignQa(
  snapshot: LastBellSimulationSnapshot,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
  fps: number,
) {
  const scope = globalThis as typeof globalThis & { __ICONS_LAST_BELL_QA__?: Record<string, unknown> };
  const cameraForward = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  camera.getWorldPosition(cameraPosition);
  const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const hidingSpot = hidingSpotById(snapshot.player.hidingSpotId);
  const directFlashlightVisible = snapshot.player.flashlightOn
    && snapshot.rooftopPhase !== 'black'
    && !(hidingSpot?.camera.suppressFlashlight ?? false);
  scope.__ICONS_LAST_BELL_QA__ = {
    ...scope.__ICONS_LAST_BELL_QA__,
    campaign: {
      chapterId: snapshot.chapterId,
      zoneId: snapshot.zoneId,
      elapsedSeconds: snapshot.elapsedSeconds,
      objectiveId: snapshot.objectiveId,
      checkpointId: snapshot.checkpointId,
      captured: snapshot.captured,
      availableInteractions: snapshot.availableInteractions.map((interaction) => ({
        id: interaction.id,
        kind: interaction.kind,
        enabled: interaction.enabled,
      })),
      player: {
        position: { ...snapshot.player.position },
        facingRadians: snapshot.player.facingRadians,
        crouching: snapshot.player.crouching,
        stealthState: snapshot.player.stealthState,
        hidingSpotId: snapshot.player.hidingSpotId,
        cameraPosition: cameraPosition.toArray().map((value) => Number(value.toFixed(4))),
        cameraForward: cameraForward.toArray().map((value) => Number(value.toFixed(4))),
        cameraRight: cameraRight.toArray().map((value) => Number(value.toFixed(4))),
      },
      liveZombies: snapshot.zombies.length,
      zombies: snapshot.zombies.map((zombie) => ({
        id: zombie.id,
        variant: zombie.variant,
        state: zombie.state,
        position: { ...zombie.position },
        bounds: {
          min: [zombie.position.x - .34, 0, zombie.position.z - .34],
          max: [zombie.position.x + .34, 1.78, zombie.position.z + .34],
        },
      })),
      rooftopPhase: snapshot.rooftopPhase,
      doors: snapshot.doors.doors.map((door) => ({
        id: door.id,
        state: door.state,
        passable: door.passable,
        occupants: [...door.occupants],
      })),
      renderer: { calls: gl.info.render.calls, triangles: gl.info.render.triangles },
      lighting: {
        requestedFlashlightOn: snapshot.player.flashlightOn,
        directFlashlightVisible,
        hidingSuppressed: Boolean(hidingSpot?.camera.suppressFlashlight),
        fillLight: {
          angleDegrees: LAST_BELL_FLASHLIGHT_PROFILE.outerFillAngleDegrees,
          distanceMeters: LAST_BELL_FLASHLIGHT_PROFILE.outerFillDistance,
          intensity: LAST_BELL_FLASHLIGHT_PROFILE.outerFillIntensity,
        },
        nearBounce: {
          distanceMeters: LAST_BELL_FLASHLIGHT_PROFILE.nearBounceDistance,
          intensity: LAST_BELL_FLASHLIGHT_PROFILE.nearBounceIntensity,
        },
        sideBounce: {
          distanceMeters: LAST_BELL_FLASHLIGHT_PROFILE.sideBounceDistance,
          offsetMeters: LAST_BELL_FLASHLIGHT_PROFILE.sideBounceOffset,
          intensity: LAST_BELL_FLASHLIGHT_PROFILE.sideBounceIntensity,
        },
        ambientIntensity: LAST_BELL_FLASHLIGHT_PROFILE.ambientIntensity,
        hemisphereIntensity: LAST_BELL_FLASHLIGHT_PROFILE.hemisphereIntensity,
      },
      fps,
    },
  };
}

function clampFacingAround(facing: number, anchor: number, limit: number): number {
  const delta = Math.atan2(Math.sin(facing - anchor), Math.cos(facing - anchor));
  return anchor + THREE.MathUtils.clamp(delta, -limit, limit);
}

function CampaignRuntimeScene(props: LastBellCampaignRuntimeProps) {
  const { camera, gl } = useThree();
  const dpr = useThree((state) => state.viewport.dpr);
  const quality = lastBellQualityTierForDpr(dpr);
  const [initialSimulation] = useState(() => new LastBellSimulation({
    chapterId: props.initialChapter,
    runMode: props.runMode,
    progressStage: props.progressStage,
    committedCollectibles: props.committedCollectibles,
    pendingCollectibles: props.pendingCollectibles,
  }));
  const simulationRef = useRef(initialSimulation);
  const [snapshot, setSnapshot] = useState(() => initialSimulation.snapshot());
  const snapshotRef = useRef(snapshot);
  const playerPositionRef = useRef({ ...snapshot.player.position });
  const classroomDoorRef = useRef(snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide') ?? null);
  const facingRef = useRef(snapshot.player.facingRadians);
  const hideFacingAnchorRef = useRef<number | null>(null);
  const pitchRef = useRef(0);
  const lastCommandNonceRef = useRef<number | null>(null);
  const lastResetNonceRef = useRef(props.resetNonce);
  const lastOpeningHandoffNonceRef = useRef(props.openingHandoffNonce);
  const lastRetryNonceRef = useRef(props.retryNonce);
  const reportAccumulatorRef = useRef(0);
  const qaElapsedRef = useRef(0);
  const qaFramesRef = useRef(0);
  const onSnapshotRef = useRef(props.onSnapshot);
  const onEventRef = useRef(props.onEvent);

  useEffect(() => {
    onSnapshotRef.current = props.onSnapshot;
    onEventRef.current = props.onEvent;
  }, [props.onEvent, props.onSnapshot]);

  const publishSnapshot = useCallback((next: LastBellSimulationSnapshot) => {
    snapshotRef.current = next;
    playerPositionRef.current = { ...next.player.position };
    classroomDoorRef.current = next.doors.doors.find((door) => door.id === 'door.classroom.slide') ?? null;
    setSnapshot(next);
    onSnapshotRef.current(next);
  }, []);

  useEffect(() => {
    if (lastResetNonceRef.current === props.resetNonce) return;
    lastResetNonceRef.current = props.resetNonce;
    const simulation = new LastBellSimulation({
      chapterId: props.initialChapter,
      runMode: props.runMode,
      progressStage: props.progressStage,
      committedCollectibles: props.committedCollectibles,
      pendingCollectibles: props.pendingCollectibles,
    });
    simulationRef.current = simulation;
    facingRef.current = 0;
    pitchRef.current = 0;
    publishSnapshot(simulation.snapshot());
  }, [props.committedCollectibles, props.initialChapter, props.pendingCollectibles, props.progressStage, props.resetNonce, props.runMode, publishSnapshot]);

  useEffect(() => {
    if (lastRetryNonceRef.current === props.retryNonce) return;
    lastRetryNonceRef.current = props.retryNonce;
    const retry = simulationRef.current.retryFrameFromCheckpoint();
    publishSnapshot(retry.snapshot);
    for (const event of retry.events) onEventRef.current(event, retry.snapshot);
  }, [props.retryNonce, publishSnapshot]);

  useEffect(() => {
    if (lastOpeningHandoffNonceRef.current === props.openingHandoffNonce) return;
    lastOpeningHandoffNonceRef.current = props.openingHandoffNonce;
    facingRef.current = 0;
    pitchRef.current = 0;
    publishSnapshot(simulationRef.current.prepareOpeningDoorInteraction());
  }, [props.openingHandoffNonce, publishSnapshot]);

  useEffect(() => {
    const command = props.interactionCommand;
    if (!command || command.nonce === lastCommandNonceRef.current) return;
    lastCommandNonceRef.current = command.nonce;
    simulationRef.current.queueInteraction(command.interactionId);
  }, [props.interactionCommand]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, .2);
    qaElapsedRef.current += rawDelta;
    qaFramesRef.current += 1;
    if (qaElapsedRef.current >= 1) {
      publishCampaignQa(snapshotRef.current, gl, camera, Number((qaFramesRef.current / qaElapsedRef.current).toFixed(1)));
      qaElapsedRef.current = 0;
      qaFramesRef.current = 0;
    }

    const frameInput = props.readFrameInput();
    const look = frameInput.look;
    const coverSpot = hidingSpotById(snapshotRef.current.player.hidingSpotId);
    const coverState = snapshotRef.current.player.stealthState;
    const inCover = coverState === 'entering-hide' || coverState === 'hidden' || coverState === 'exiting-hide';
    if (inCover && coverSpot && hideFacingAnchorRef.current === null) hideFacingAnchorRef.current = facingRef.current;
    if (!inCover) hideFacingAnchorRef.current = null;
    if (props.active) {
      facingRef.current -= look.x * .0022;
      if (coverSpot && hideFacingAnchorRef.current !== null) {
        facingRef.current = clampFacingAround(facingRef.current, hideFacingAnchorRef.current, coverSpot.camera.yawLimitRadians);
      }
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - look.y * .0018, -.82, .72);
    }
    if (props.active) {
      const frame = simulationRef.current.advance(delta, {
        movement: frameInput.movement,
        facingRadians: facingRef.current,
        flashlightOn: props.flashlightOn,
        crouching: props.crouching,
        listening: props.listening,
        running: frameInput.running,
      });
      reportAccumulatorRef.current += delta;
      for (const event of frame.events) onEventRef.current(event, frame.snapshot);
      if (frame.events.length > 0 || reportAccumulatorRef.current >= LAST_BELL_SIMULATION_STEP_SECONDS) {
        reportAccumulatorRef.current = 0;
        publishSnapshot(frame.snapshot);
      }
    }

    const current = snapshotRef.current;
    const cinematic = props.entryPhase !== 'playing';
    if (props.qaNamraHybridMode) {
      const isSixMeters = props.qaNamraHybridMode === 'idle-6';
      const isOblique = props.qaNamraHybridMode === 'idle-oblique';
      camera.position.set(isOblique ? .72 : 0, isSixMeters ? 1.58 : 1.48, isSixMeters ? 95.5 : 98.7);
      camera.rotation.set(isOblique ? -.035 : 0, Math.PI + (isOblique ? -.105 : 0), 0, 'YXZ');
    } else if (cinematic) {
      const exterior = props.entryPhase === 'preflight' || props.entryPhase === 'brand';
      const target = exterior
        ? POST_STRIKE_RENDER_GUARDRAILS.camera.entry
        : POST_STRIKE_RENDER_GUARDRAILS.camera.coldOpen;
      camera.position.set(target.position[0], target.position[1], target.position[2]);
      camera.rotation.set('pitch' in target ? target.pitch : 0, target.yaw, 0, 'YXZ');
    } else {
      // Cover is simulation-owned and only changes through the E anchor. C
      // merely crouches, so it lowers the viewpoint without freezing movement.
      const hidingSpot = hidingSpotById(current.player.hidingSpotId);
      const hiding = current.player.stealthState === 'entering-hide' || current.player.stealthState === 'hidden' || current.player.stealthState === 'exiting-hide';
      const eyeHeight = hiding && hidingSpot ? hidingSpot.camera.eyeHeightMeters : current.player.crouching ? 1.34 : 1.68;
      const bob = props.reducedMotion || hiding || current.player.crouching ? 0 : Math.sin(current.elapsedSeconds * (frameInput.running ? 12 : 8)) * .012;
      const recoveryShock = !props.reducedMotion && current.activeForeshadowing?.cue === 'rapid-recovery'
        ? Math.max(0, current.activeForeshadowing.remainingSeconds / 1.15)
        : 0;
      const jolt = recoveryShock * Math.sin(current.elapsedSeconds * 72) * .028;
      camera.position.set(
        current.player.position.x + (hidingSpot?.camera.offset.x ?? 0) + jolt,
        eyeHeight + bob + Math.abs(jolt) * .45,
        current.player.position.z + (hidingSpot?.camera.offset.z ?? 0),
      );
      camera.rotation.set(pitchRef.current + jolt * 1.8, facingRef.current + Math.PI + jolt * .9, 0, 'YXZ');
    }
  });

  return (
    <>
      {snapshot.chapterId === 'chapter-01' ? (
        <ChapterOneScene
          entryPhase={props.entryPhase}
          classroomDoorRef={classroomDoorRef}
          playerPositionRef={playerPositionRef}
          playerStealth={snapshot.player}
          quality={quality}
          reducedMotion={props.reducedMotion}
          onEnvironmentMounted={props.onSceneReady}
          assetRetryNonce={props.assetRetryNonce}
          onAssetStatus={props.onOpeningAssetStatus}
        />
      ) : (
        <>
          <color attach="background" args={['#02090b']} />
          <fog attach="fog" args={['#061316', 8, 34]} />
        </>
      )}
      <TwoChapterWorldScene
        snapshot={snapshot}
        reducedMotion={props.reducedMotion}
        entryPhase={props.entryPhase}
        assetRetryNonce={props.assetRetryNonce}
        qaNamraHybridMode={props.qaNamraHybridMode}
        onEnvironmentMounted={props.onSceneReady}
        onAssetStatus={props.onAssetStatus}
      />
      {props.entryPhase === 'playing' ? (
        <FlashlightRig
          on={
            props.flashlightOn
            && snapshot.rooftopPhase !== 'black'
            && !(hidingSpotById(snapshot.player.hidingSpotId)?.camera.suppressFlashlight ?? false)
          }
          shadowMapSize={quality.shadowMapSize}
        />
      ) : null}
    </>
  );
}

function WebGlContextObserver({ onContextState }: Pick<LastBellCampaignRuntimeProps, 'onContextState'>) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      onContextState?.('lost');
    };
    const onRestored = () => onContextState?.('restored');
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
    };
  }, [gl, onContextState]);

  return null;
}

export function LastBellCampaignRuntime(props: LastBellCampaignRuntimeProps) {
  return (
    <Canvas
      className={styles.canvas}
      camera={{ fov: 72, near: .08, far: 150, position: [0, 1.68, 4] }}
      dpr={[1, 1.65]}
      frameloop="always"
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
      shadows
      onPointerDown={props.onCanvasInteract}
    >
      <WebGlContextObserver onContextState={props.onContextState} />
      <CampaignRuntimeScene {...props} />
    </Canvas>
  );
}
