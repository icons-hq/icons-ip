'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  initialLastBellState,
  nearestInteractableAnchor,
  objectiveForState,
  reduceLastBellState,
} from '@/lib/prototypes/last-bell/state';
import { CHAPTER_01_PLAYER_START } from '@/lib/prototypes/last-bell/content/chapter-01';
import { LAST_BELL_ASSETS } from '@/lib/prototypes/last-bell/assets';
import {
  INTERACTION_DESCRIPTORS,
  interactionDescriptorFor,
  type LastBellInteractionAnchor,
} from '@/lib/prototypes/last-bell/interactions';
import { lastBellFireDoorHandoff } from '@/lib/prototypes/last-bell/engine/movement';
import {
  EntryDirector,
  skipEntryToPlaying,
  type EntryDirectorPhase,
  type EntryDirectorSnapshot,
} from '@/lib/prototypes/last-bell/entry-director';
import type { LastBellDoorHandoffCommand } from './LastBellRuntime';
import {
  checkpointIdLabel,
  clearLastBellCheckpoint,
  loadLastBellCheckpoint,
  saveLastBellCheckpoint,
  type LastBellCheckpointPayload,
} from '@/lib/prototypes/last-bell/persistence';
import {
  advanceLastBellActiveDuration,
  advanceLastBellSimulationMetrics,
  clearLastBellCompletion,
  createLastBellCompletionRecord,
  createLastBellRunMetrics,
  loadLastBellCompletion,
  recordLastBellRetry,
  saveLastBellCompletion,
  type LastBellCompletionRecord,
  type LastBellRunMetrics,
} from '@/lib/prototypes/last-bell/completion';
import {
  comparisonResultFromLastBell,
  saveAouadComparisonResult,
} from '@/lib/campaigns/aouad/lab/comparison';
import { getOptionalStorage } from '@/lib/campaigns/aouad/browser-storage';
import { requestLastBellPointerLock } from '@/lib/prototypes/last-bell/pointer-lock';
import { LAST_BELL_ROUTE_LABELS } from '@/lib/prototypes/last-bell/routes';
import { ComparisonResultActions } from '@/components/campaigns/aouad/lab/ComparisonResultActions';
import { EntryOverlay } from './EntryOverlay';
import { useLastBellAudio } from './useLastBellAudio';
import styles from './last-bell.module.css';

const LastBellRuntime = dynamic(
  () => import('./LastBellRuntime').then((module) => module.LastBellRuntime),
  { ssr: false, loading: () => <div aria-label="3D 학교 공간을 불러오는 중" /> },
);

type InputVector = { x: number; y: number };
type MotionPreference = 'system' | 'reduce' | 'full';
type ClassroomDoorStage = 'closed' | 'opening' | 'open' | 'crossed' | 'locking' | 'locked';
type RuntimeDoorId = 'classroom' | 'fire';
type RuntimeDoorCommand = { door: RuntimeDoorId; action: 'open' | 'close-lock'; nonce: number };
type RuntimeDoorChange = { door?: RuntimeDoorId; doorId?: RuntimeDoorId; state?: string };

const PLAY_STYLE_LABEL = {
  listener: '소리를 읽은 생존자',
  shadow: '그림자를 따른 생존자',
  runner: '끝까지 달린 생존자',
  resilient: '다시 일어난 생존자',
} as const;

// Every prompt uses the authored interaction registry; no separate review
// boundary can silently remove a reachable action from the runtime.
const INTERACTIVE_ANCHORS = INTERACTION_DESCRIPTORS.map(({ anchor }) => anchor) as readonly LastBellInteractionAnchor[];
const ENTRY_PREFLIGHT_SNAPSHOT = new EntryDirector().reset();

function getPortraitState() {
  return typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
}

/**
 * Compact landscape uses the touch HUD even in a desktop browser resized to
 * the target viewport. Pointer lock is a desktop-only affordance there: the
 * right-side action control and swipe-look surface remain usable without it.
 */
function usesTouchGameplayHud() {
  return typeof window !== 'undefined' && (
    window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches
  );
}

function createLocalRunMetrics(now = new Date()): LastBellRunMetrics {
  const startedAt = now.toISOString();
  const entropy = Math.random().toString(36).slice(2, 10);
  return createLastBellRunMetrics({
    runId: `last-bell-${now.getTime().toString(36)}-${entropy}`,
    startedAt,
  });
}

function formatActiveDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(totalSeconds / 60)}분 ${String(totalSeconds % 60).padStart(2, '0')}초`;
}

function entrySnapshotChanged(current: EntryDirectorSnapshot, next: EntryDirectorSnapshot) {
  return current.phase !== next.phase
    || current.sceneVisibility !== next.sceneVisibility
    || current.inputEnabled !== next.inputEnabled
    || current.transition.kind !== next.transition.kind
    || current.handoff !== next.handoff;
}

function FlashlightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h10l-1.2 5H8.2L7 3Z" />
      <path d="m9 8-2.2 11h10.4L15 8" />
      <path d="M12 20v1" />
    </svg>
  );
}

type ComfortSettingsProps = {
  brightness: number;
  motionPreference: MotionPreference;
  headBobStrength: number;
  directionCaptions: boolean;
  onBrightnessChange: (value: number) => void;
  onMotionPreferenceChange: (value: MotionPreference) => void;
  onHeadBobStrengthChange: (value: number) => void;
  onDirectionCaptionsChange: (value: boolean) => void;
};

function ComfortSettings({
  brightness,
  motionPreference,
  headBobStrength,
  directionCaptions,
  onBrightnessChange,
  onMotionPreferenceChange,
  onHeadBobStrengthChange,
  onDirectionCaptionsChange,
}: ComfortSettingsProps) {
  return (
    <div className={styles.comfortSettings}>
      <label>
        밝기 <output>{brightness}%</output>
        <input type="range" min="60" max="140" step="10" value={brightness} onChange={(event) => onBrightnessChange(Number(event.target.value))} />
      </label>
      <label>
        화면 움직임
        <select value={motionPreference} onChange={(event) => onMotionPreferenceChange(event.target.value as MotionPreference)}>
          <option value="system">기기 설정 따름</option>
          <option value="reduce">줄이기</option>
          <option value="full">기본</option>
        </select>
      </label>
      <label>
        카메라 흔들림
        <select value={headBobStrength} onChange={(event) => onHeadBobStrengthChange(Number(event.target.value))}>
          <option value="1">기본</option>
          <option value="0.35">약하게</option>
          <option value="0">끔</option>
        </select>
      </label>
      <label className={styles.comfortCheck}>
        <input type="checkbox" checked={directionCaptions} onChange={(event) => onDirectionCaptionsChange(event.target.checked)} />
        방향 자막
      </label>
    </div>
  );
}

export function LastBellClient() {
  const [state, dispatch] = useReducer(reduceLastBellState, initialLastBellState);
  const [nearest, setNearest] = useState<LastBellInteractionAnchor | null>(null);
  const [danger, setDanger] = useState(0);
  const [paused, setPaused] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [handoff, setHandoff] = useState<LastBellDoorHandoffCommand | null>(null);
  const [doorCommand, setDoorCommand] = useState<RuntimeDoorCommand | null>(null);
  const [classroomDoorStage, setClassroomDoorStage] = useState<ClassroomDoorStage>('closed');
  const [flashlightOn, setFlashlightOn] = useState(true);
  const [crouching, setCrouching] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [entryStarted, setEntryStarted] = useState(false);
  const [entrySnapshot, setEntrySnapshot] = useState<EntryDirectorSnapshot>(ENTRY_PREFLIGHT_SNAPSHOT);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [motionPreference, setMotionPreference] = useState<MotionPreference>('system');
  const [brightness, setBrightness] = useState(100);
  const [headBobStrength, setHeadBobStrength] = useState(1);
  const [directionCaptions, setDirectionCaptions] = useState(true);
  const [entrySettingsOpen, setEntrySettingsOpen] = useState(false);
  const [pointerLockHint, setPointerLockHint] = useState(false);
  const [savedCheckpoint, setSavedCheckpoint] = useState<LastBellCheckpointPayload | null>(null);
  const [completionRecord, setCompletionRecord] = useState<LastBellCompletionRecord | null>(null);
  const nearestRef = useRef<LastBellInteractionAnchor | null>(null);
  const phaseRef = useRef(state.phase);
  const routeIdRef = useRef(state.routeId);
  const moveRef = useRef<InputVector>({ x: 0, y: 0 });
  const lookRef = useRef<InputVector>({ x: 0, y: 0 });
  const runRef = useRef(false);
  const positionRef = useRef<{ x: number; z: number }>({ x: CHAPTER_01_PLAYER_START.x, z: CHAPTER_01_PLAYER_START.z });
  const stickPointerRef = useRef<number | null>(null);
  const touchLookRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastDangerReportRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const hadPointerLockRef = useRef(false);
  const gameplayInputEnabledRef = useRef(false);
  const runMetricsRef = useRef<LastBellRunMetrics>(createLocalRunMetrics());
  const completionSavedRef = useRef(false);
  const classroomDoorStageRef = useRef<ClassroomDoorStage>('closed');
  const entryDirectorRef = useRef(new EntryDirector());
  const entrySnapshotRef = useRef<EntryDirectorSnapshot>(ENTRY_PREFLIGHT_SNAPSHOT);
  const entryHandoffDispatchedRef = useRef(false);
  const audio = useLastBellAudio();
  const reduceMotion = motionPreference === 'reduce' || (motionPreference === 'system' && systemReducedMotion);
  const reviewCheckpoint = savedCheckpoint?.checkpointId === 'ch1_handoff' ? savedCheckpoint : null;
  const entryPhase: EntryDirectorPhase = entrySnapshot.phase;
  const activeModal = state.phase === 'complete'
    ? 'complete'
    : state.captured
      ? 'captured'
      : paused && state.phase !== 'opening'
        ? 'paused'
        : null;
  const modalOpen = activeModal !== null;
  const modalOpenRef = useRef(false);
  const modalRef = useRef<HTMLElement | null>(null);
  const modalPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const setClassroomDoorStageValue = useCallback((next: ClassroomDoorStage) => {
    if (classroomDoorStageRef.current === next) return;
    classroomDoorStageRef.current = next;
    setClassroomDoorStage(next);
  }, []);

  const onSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);

  useEffect(() => { modalOpenRef.current = modalOpen; }, [modalOpen]);
  useEffect(() => { phaseRef.current = state.phase; }, [state.phase]);
  useEffect(() => { routeIdRef.current = state.routeId; }, [state.routeId]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storage = getOptionalStorage();
      if (!storage) {
        setSavedCheckpoint(null);
        setCompletionRecord(null);
        return;
      }
      try {
        setSavedCheckpoint(loadLastBellCheckpoint(storage));
        setCompletionRecord(loadLastBellCompletion(storage));
      } catch {
        setSavedCheckpoint(null);
        setCompletionRecord(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const update = () => {
      const nextPortrait = getPortraitState();
      setPortrait(nextPortrait);
      if (nextPortrait) setPaused(true);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!entryStarted || state.phase !== 'opening') return;
    let frameId = 0;
    const advance = (now: number) => {
      const director = entryDirectorRef.current;
      let next = director.advance({ nowMs: now, sceneReady, reducedMotion: reduceMotion });
      if (next.phase === 'handoff' && !entryHandoffDispatchedRef.current) {
        entryHandoffDispatchedRef.current = true;
        next = director.advance({ nowMs: now, sceneReady, reducedMotion: reduceMotion });
        dispatch({ type: 'START_PLAY' });
      }
      if (entrySnapshotChanged(entrySnapshotRef.current, next)) {
        entrySnapshotRef.current = next;
        setEntrySnapshot(next);
      }
      if (state.phase === 'opening') frameId = window.requestAnimationFrame(advance);
    };
    frameId = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frameId);
  }, [entryStarted, reduceMotion, sceneReady, state.phase]);

  useEffect(() => {
    const storage = getOptionalStorage();
    if (!storage) return;
    try {
      if (state.phase === 'corridor' && state.checkpoint === 'corridor' && state.doorLocked && !state.captured) {
        const payload = saveLastBellCheckpoint(storage, 'ch1_handoff', state, runMetricsRef.current, state.routeId, state.routeObjective);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'power' && state.powerRestored && !state.captured) {
        const payload = saveLastBellCheckpoint(storage, 'ch1_power_restored', state, runMetricsRef.current, state.routeId, state.routeObjective);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'complete') {
        clearLastBellCheckpoint(storage);
        window.setTimeout(() => setSavedCheckpoint(null), 0);
      }
    } catch {
      // Local progress is optional; a storage-blocked browser still plays.
    }
  }, [state]);

  useEffect(() => {
    audio.syncPhase(state.phase, state.listening, state.hiding);
  }, [audio, state.hiding, state.listening, state.phase]);

  const setNearestValue = useCallback((next: LastBellInteractionAnchor | null) => {
    nearestRef.current = next;
    setNearest((current) => current === next ? current : next);
  }, []);

  const onPosition = useCallback((position: { x: number; z: number }) => {
    positionRef.current = position;
    if (state.phase === 'classroom' && classroomDoorStageRef.current === 'open' && position.z > 13.25) {
      setClassroomDoorStageValue('crossed');
    }
    const next = nearestInteractableAnchor(state, INTERACTIVE_ANCHORS, position);
    setNearestValue(next);
  }, [setClassroomDoorStageValue, setNearestValue, state]);

  const onDanger = useCallback((distance: number) => {
    const value = state.bellTriggered
      ? Math.max(0, Math.min(1, 1 - (distance - 1.5) / 25))
      : Math.min(.28, Math.max(0, 1 - distance / 25));
    const now = performance.now();
    if (now - lastDangerReportRef.current < 120) return;
    lastDangerReportRef.current = now;
    setDanger(value);
  }, [state.bellTriggered]);

  const onActiveTime = useCallback((durationMs: number) => {
    runMetricsRef.current = advanceLastBellActiveDuration(runMetricsRef.current, durationMs);
  }, []);

  const onSimulationStep = useCallback((durationMs: number, flags: { listening: boolean; hiding: boolean; running: boolean }) => {
    runMetricsRef.current = advanceLastBellSimulationMetrics(runMetricsRef.current, durationMs, flags);
  }, []);

  const requestDoorCommand = useCallback((door: RuntimeDoorId, action: RuntimeDoorCommand['action']) => {
    setDoorCommand((current) => ({ door, action, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const requestFireDoorHandoff = useCallback(() => {
    const nextHandoff = lastBellFireDoorHandoff();
    setHandoff((current) => ({ ...nextHandoff, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const onDoorStateChange = useCallback((change: RuntimeDoorChange | RuntimeDoorId, suppliedState?: string) => {
    const door = typeof change === 'string' ? change : change.door ?? change.doorId;
    const doorState = typeof change === 'string' ? suppliedState : change.state;
    if (door !== 'classroom' || !doorState) return;
    if (doorState === 'open') setClassroomDoorStageValue('open');
    if (doorState === 'locked' && classroomDoorStageRef.current === 'locking') {
      setClassroomDoorStageValue('locked');
      dispatch({ type: 'LOCK_CLASSROOM_DOOR' });
    }
  }, [setClassroomDoorStageValue]);

  const finalizeCompletion = useCallback(() => {
    const routeId = routeIdRef.current;
    if (!routeId || completionSavedRef.current) return;
    completionSavedRef.current = true;
    const record = createLastBellCompletionRecord(runMetricsRef.current, routeId, new Date().toISOString());
    let saved = record;
    const storage = getOptionalStorage();
    try {
      if (storage) {
        saved = saveLastBellCompletion(storage, record) ?? record;
        const comparisonResult = comparisonResultFromLastBell(saved);
        if (comparisonResult) saveAouadComparisonResult(storage, comparisonResult);
      }
    } catch {
      // Storage can be blocked; the in-memory completion and game flow remain valid.
    }
    setCompletionRecord(saved);
  }, []);

  const interact = useCallback(() => {
    audio.unlock();
    const descriptor = interactionDescriptorFor(nearestRef.current);
    if (!descriptor) return;
    switch (descriptor.action) {
      case 'lockClassroomDoor':
        if (classroomDoorStageRef.current === 'closed') {
          setClassroomDoorStageValue('opening');
          requestDoorCommand('classroom', 'open');
        } else if (classroomDoorStageRef.current === 'crossed') {
          setClassroomDoorStageValue('locking');
          requestDoorCommand('classroom', 'close-lock');
        }
        break;
      case 'selectRoute':
        if (descriptor.routeId) dispatch({ type: 'SELECT_ROUTE', routeId: descriptor.routeId });
        break;
      case 'completeRouteObjective':
        if (descriptor.routeId) dispatch({ type: 'COMPLETE_ROUTE_OBJECTIVE', routeId: descriptor.routeId });
        break;
      case 'toggleHide':
        if (!state.hiding) setFlashlightOn(false);
        dispatch({ type: 'TOGGLE_HIDE' });
        break;
      case 'restorePower':
        dispatch({ type: 'RESTORE_POWER' });
        break;
      case 'lockFireDoor':
        dispatch({ type: 'LOCK_FIRE_DOOR' });
        requestFireDoorHandoff();
        break;
      case 'triggerBell':
        dispatch({ type: 'TRIGGER_BELL' });
        break;
      case 'reachChapterExit':
        finalizeCompletion();
        dispatch({ type: 'REACH_CHAPTER_EXIT' });
        break;
    }
    if (descriptor.audio) audio.play(descriptor.audio.id, { volume: descriptor.audio.volume });
  }, [audio, finalizeCompletion, requestDoorCommand, requestFireDoorHandoff, setClassroomDoorStageValue, state.hiding]);

  const toggleListen = useCallback(() => {
    audio.unlock();
    dispatch({ type: 'TOGGLE_LISTEN' });
  }, [audio]);

  const toggleCrouch = useCallback(() => {
    audio.unlock();
    setCrouching((value) => !value);
  }, [audio]);

  const toggleFlashlight = useCallback(() => {
    audio.unlock();
    setFlashlightOn((value) => !value);
  }, [audio]);

  const retryFromCheckpoint = useCallback(() => {
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    setNearestValue(null);
    setDanger(0);
    setPaused(false);
    setFlashlightOn(true);
    runMetricsRef.current = recordLastBellRetry(runMetricsRef.current);
    setRetryNonce((value) => value + 1);
    dispatch({ type: 'RETRY' });
  }, [setNearestValue]);

  const restartFromComplete = useCallback(() => {
    const storage = getOptionalStorage();
    try { if (storage) clearLastBellCompletion(storage); } catch { /* Local presentation is optional. */ }
    window.location.reload();
  }, []);

  const modalPrimaryAction = useCallback(() => {
    if (activeModal === 'paused') setPaused(false);
    else if (activeModal === 'captured') retryFromCheckpoint();
    else if (activeModal === 'complete') restartFromComplete();
  }, [activeModal, restartFromComplete, retryFromCheckpoint]);

  useEffect(() => {
    if (!modalOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pressedKeysRef.current.clear();
    moveRef.current = { x: 0, y: 0 };
    runRef.current = false;
    const focusFrame = window.requestAnimationFrame(() => modalPrimaryRef.current?.focus());
    const onModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        modalPrimaryAction();
      } else if (event.key === 'Tab') {
        const container = modalRef.current;
        const focusable = container
          ? Array.from(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
          : [];
        if (focusable.length === 0) event.preventDefault();
        else {
          const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
          const nextIndex = currentIndex < 0 ? 0 : event.shiftKey
            ? (currentIndex === 0 ? focusable.length - 1 : currentIndex - 1)
            : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
          event.preventDefault();
          focusable[nextIndex]?.focus();
        }
      }
      event.stopPropagation();
    };
    document.addEventListener('keydown', onModalKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onModalKeyDown, true);
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [activeModal, modalOpen, modalPrimaryAction]);

  const requestPointerLock = useCallback(async () => {
    if (usesTouchGameplayHud()) {
      setPointerLockHint(false);
      return;
    }
    const canvas = document.querySelector('canvas');
    const locked = await requestLastBellPointerLock(canvas);
    setPointerLockHint(!locked);
  }, []);

  const beginEntry = useCallback(() => {
    audio.unlock();
    audio.play('classroomAmbience', { volume: .26, loop: true });
    void requestPointerLock();
    completionSavedRef.current = false;
    setCompletionRecord(null);
    setEntrySettingsOpen(false);
    setEntryStarted(true);
  }, [audio, requestPointerLock]);

  const skipOpening = useCallback(() => {
    audio.unlock();
    // A skip requested before mounting completes is retained by EntryDirector
    // and resolves through the same handoff as soon as the scene is ready.
    setEntryStarted(true);
    entryHandoffDispatchedRef.current = false;
    const playingSnapshot = skipEntryToPlaying(entryDirectorRef.current, { sceneReady, reducedMotion: reduceMotion, deltaMs: 0 });
    if (!playingSnapshot) return;
    entryHandoffDispatchedRef.current = true;
    entrySnapshotRef.current = playingSnapshot;
    setEntrySnapshot(playingSnapshot);
    dispatch({ type: 'START_PLAY' });
  }, [audio, reduceMotion, sceneReady]);

  const continueFromCheckpoint = useCallback(() => {
    if (!reviewCheckpoint || !sceneReady) return;
    audio.unlock();
    void requestPointerLock();
    setNearestValue(null);
    setDanger(0);
    setRetryNonce((value) => value + 1);
    setFlashlightOn(true);
    runMetricsRef.current = reviewCheckpoint.runMetrics;
    completionSavedRef.current = false;
    const playingSnapshot = skipEntryToPlaying(entryDirectorRef.current, { sceneReady, reducedMotion: reduceMotion, deltaMs: 0 });
    if (!playingSnapshot) return;
    entryHandoffDispatchedRef.current = true;
    entrySnapshotRef.current = playingSnapshot;
    setEntrySnapshot(playingSnapshot);
    dispatch({
      type: 'RESTORE_CHECKPOINT',
      checkpointId: reviewCheckpoint.checkpointId,
      routeId: reviewCheckpoint.routeId ?? undefined,
      routeObjective: reviewCheckpoint.routeObjective,
    });
  }, [audio, reduceMotion, requestPointerLock, reviewCheckpoint, sceneReady, setNearestValue]);

  const runtimeActive = state.phase !== 'opening' && !paused && !portrait && !state.captured && state.phase !== 'complete';
  useEffect(() => { gameplayInputEnabledRef.current = runtimeActive; }, [runtimeActive]);

  useEffect(() => {
    const refreshMovement = () => {
      const keys = pressedKeysRef.current;
      moveRef.current = {
        x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')),
        y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')),
      };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (modalOpenRef.current || !gameplayInputEnabledRef.current) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        pressedKeysRef.current.add(key);
        refreshMovement();
      }
      if (event.repeat) return;
      if (event.key === 'Shift') runRef.current = true;
      if (key === 'e') interact();
      if (key === 'q') toggleListen();
      if (key === 'c') toggleCrouch();
      if (key === 'f') toggleFlashlight();
      if (event.key === 'Escape') setPaused((value) => !value);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (modalOpenRef.current || !gameplayInputEnabledRef.current) return;
      const key = event.key.toLowerCase();
      pressedKeysRef.current.delete(key);
      refreshMovement();
      if (event.key === 'Shift') runRef.current = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (gameplayInputEnabledRef.current && document.pointerLockElement) {
        lookRef.current.x += event.movementX;
        lookRef.current.y += event.movementY;
      }
    };
    const onTouchStart = (event: PointerEvent) => {
      if (!gameplayInputEnabledRef.current) return;
      if (event.pointerType === 'touch' && event.clientX > window.innerWidth * .48 && event.clientY < window.innerHeight * .8) {
        touchLookRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const onTouchLook = (event: PointerEvent) => {
      const previous = touchLookRef.current;
      if (!gameplayInputEnabledRef.current || event.pointerType !== 'touch' || !previous || previous.id !== event.pointerId) return;
      lookRef.current.x += event.clientX - previous.x;
      lookRef.current.y += event.clientY - previous.y;
      touchLookRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (touchLookRef.current?.id === event.pointerId) touchLookRef.current = null;
    };
    const onPointerLock = () => {
      if (document.pointerLockElement) {
        hadPointerLockRef.current = true;
        setPointerLockHint(false);
      } else if (hadPointerLockRef.current && phaseRef.current !== 'opening') {
        setPaused(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onTouchStart);
    window.addEventListener('pointermove', onTouchLook);
    window.addEventListener('pointerup', onTouchEnd);
    window.addEventListener('pointercancel', onTouchEnd);
    document.addEventListener('pointerlockchange', onPointerLock);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onTouchStart);
      window.removeEventListener('pointermove', onTouchLook);
      window.removeEventListener('pointerup', onTouchEnd);
      window.removeEventListener('pointercancel', onTouchEnd);
      document.removeEventListener('pointerlockchange', onPointerLock);
    };
  }, [interact, toggleCrouch, toggleFlashlight, toggleListen]);

  const pointerLock = useCallback(() => {
    if (!gameplayInputEnabledRef.current) return;
    audio.unlock();
    void requestPointerLock();
  }, [audio, requestPointerLock]);

  const changeStick = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2);
    const y = (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2);
    const length = Math.hypot(x, y);
    const scale = length > 1 ? 1 / length : 1;
    moveRef.current = { x: x * scale, y: y * scale };
  }, []);

  const releaseStick = useCallback(() => {
    moveRef.current = { x: 0, y: 0 };
    stickPointerRef.current = null;
  }, []);

  const prompt = useMemo(() => {
    if (nearest !== 'classroom_door') return interactionDescriptorFor(nearest)?.copy ?? null;
    if (classroomDoorStage === 'closed') return '교실 문 열기';
    if (classroomDoorStage === 'crossed') return '문을 닫고 잠그기';
    if (classroomDoorStage === 'open') return '문을 통과하기';
    return null;
  }, [classroomDoorStage, nearest]);
  const showSoundCue = state.listening || danger > .04;
  const completeRouteLabel = completionRecord?.routeId ? LAST_BELL_ROUTE_LABELS[completionRecord.routeId] : state.routeId ? LAST_BELL_ROUTE_LABELS[state.routeId] : null;
  const completeDuration = completionRecord?.activeDurationMs ?? 0;
  const completeStyle = completionRecord?.playStyle ?? null;
  const comparisonResult = completionRecord ? comparisonResultFromLastBell(completionRecord) : null;
  const reviewObjective = objectiveForState(state);
  const sceneStyle = useMemo(() => ({ '--scene-brightness': String(brightness / 100) }) as React.CSSProperties, [brightness]);
  const comfortSettingsProps: ComfortSettingsProps = {
    brightness,
    motionPreference,
    headBobStrength,
    directionCaptions,
    onBrightnessChange: setBrightness,
    onMotionPreferenceChange: setMotionPreference,
    onHeadBobStrengthChange: setHeadBobStrength,
    onDirectionCaptionsChange: setDirectionCaptions,
  };

  return (
    <main className={styles.root} data-portrait={portrait ? 'true' : 'false'} data-reduced-motion={reduceMotion ? 'true' : 'false'}>
      <section className={styles.scene} style={sceneStyle} aria-label="효산고 Chapter 1 3D 게임">
        <LastBellRuntime
          state={state}
          moveRef={moveRef}
          lookRef={lookRef}
          runRef={runRef}
          resetNonce={retryNonce}
          checkpoint={state.checkpoint}
          active={runtimeActive}
          handoff={handoff}
          entryPhase={entryPhase}
          flashlightOn={flashlightOn}
          crouching={crouching}
          headBobStrength={reduceMotion ? 0 : headBobStrength}
          reducedMotion={reduceMotion}
          doorCommand={doorCommand}
          onSceneReady={onSceneReady}
          onDoorStateChange={onDoorStateChange}
          onPosition={onPosition}
          onDanger={onDanger}
          onActiveTime={onActiveTime}
          onSimulationStep={onSimulationStep}
          onCanvasInteract={pointerLock}
        />
        {state.phase !== 'opening' && (
          <div className={styles.hud} aria-live="polite">
            <div className={styles.topbar}>
              <div className={styles.objective}>
                <span className={styles.objectiveLabel}>현재 목표 · CHAPTER 01</span>
                <span className={styles.objectiveText}>{reviewObjective}</span>
              </div>
              {showSoundCue && (
                <div className={styles.sound}>
                  <span className={styles.soundLabel}>{state.listening ? '집중 청취' : '주변 소리'}</span>
                  <span className={`${styles.soundSignal} ${state.listening ? styles.soundSignalActive : ''}`} aria-label={`소리 강도 ${Math.round(danger * 100)}%`}>
                    <i /><i /><i /><i />
                  </span>
                  {state.listening && directionCaptions && <span className={styles.soundDirection}>{danger > .65 ? '오른쪽 뒤 · 감염자 · 강' : '왼쪽 복도 · 발소리 · 약'}</span>}
                </div>
              )}
            </div>
            <div className={styles.crosshair} aria-hidden="true" />
            <span className={`${styles.flashlightStatus} ${flashlightOn ? '' : styles.flashlightStatusOff}`} aria-label={flashlightOn ? '손전등 켜짐' : '손전등 꺼짐'}><FlashlightIcon /></span>
            {state.hiding && <div className={styles.hideVignette} aria-hidden="true" />}
            {state.hiding && <div className={styles.hideStatus}>숨는 중 · E로 나오기</div>}
            {prompt && !paused && (
              <div className={styles.prompt}>
                <span className={styles.key}>
                  <span className={styles.keyboardPrompt}>E</span>
                  <span className={styles.touchPrompt}>행동</span>
                </span>
                {prompt}
              </div>
            )}
            {pointerLockHint && <div className={styles.pointerLockHint}>시점을 켜려면 화면을 한 번 클릭하세요.</div>}
            <div className={styles.hint}><kbd>WASD</kbd> 이동 · <kbd>마우스</kbd> 시점 · <kbd>Q</kbd> 듣기 · <kbd>C</kbd> 숨기 · <kbd>F</kbd> 손전등 · <kbd>Esc</kbd> 일시정지</div>
            <div className={styles.mobileControls}>
              <div
                className={styles.stick}
                onPointerDown={(event) => { stickPointerRef.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); changeStick(event); }}
                onPointerMove={(event) => { if (stickPointerRef.current === event.pointerId) changeStick(event); }}
                onPointerUp={releaseStick}
                onPointerCancel={releaseStick}
                aria-label="이동 스틱"
              ><span className={styles.stickDot} /></div>
              <div className={styles.mobileActions}>
                <button type="button" className={`${styles.actionButton} ${state.listening ? styles.actionButtonActive : ''}`} onClick={toggleListen} aria-label="집중 청취">듣기</button>
                <button type="button" className={`${styles.actionButton} ${crouching ? styles.actionButtonActive : ''}`} onClick={toggleCrouch} aria-label="웅크리기">웅크리기</button>
                <button type="button" className={`${styles.actionButton} ${flashlightOn ? styles.actionButtonActive : ''}`} onClick={toggleFlashlight} aria-label={flashlightOn ? '손전등 끄기' : '손전등 켜기'}><FlashlightIcon /></button>
                <button type="button" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} onClick={interact} aria-label="상호작용">행동</button>
              </div>
            </div>
          </div>
        )}
      </section>

      {!portrait && state.phase === 'opening' && (
        <EntryOverlay
          phase={entryPhase}
          sceneReady={sceneReady}
          hasCheckpoint={reviewCheckpoint !== null}
          checkpointAction={reviewCheckpoint ? <button type="button" className={styles.checkpointButton} onClick={continueFromCheckpoint} disabled={!sceneReady}>체크포인트에서 계속 · {checkpointIdLabel(reviewCheckpoint.checkpointId)}</button> : null}
          settings={<ComfortSettings {...comfortSettingsProps} />}
          onStart={beginEntry}
          onSkip={skipOpening}
          onToggleSettings={() => setEntrySettingsOpen((value) => !value)}
          settingsOpen={entrySettingsOpen}
        />
      )}

      <div className={styles.rotateHint} role="status" aria-live="polite" aria-hidden={!portrait}>
        <span className={styles.rotateHintIcon} aria-hidden="true">↻</span>
        <strong>화면을 가로로 돌려주세요</strong>
        <span>가로 화면이 될 때까지 게임은 잠시 멈춰 있습니다.</span>
      </div>

      {activeModal === 'paused' && (
        <section ref={modalRef} className={styles.statusOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-modal-title" aria-describedby="last-bell-modal-description" aria-label="일시정지">
          <div className={styles.statusPanel}>
            <span className={styles.serial}>PAUSED · C-201</span>
            <h2 id="last-bell-modal-title">잠깐, 숨을 고른다.</h2>
            <p id="last-bell-modal-description">Esc를 누르거나 아래 버튼을 눌러 학교로 돌아가세요.</p>
            <details className={styles.statusSettings}>
              <summary>화면 설정</summary>
              <ComfortSettings {...comfortSettingsProps} />
            </details>
            <button ref={modalPrimaryRef} type="button" className={styles.primaryButton} onClick={modalPrimaryAction}>계속하기</button>
          </div>
        </section>
      )}

      {activeModal === 'captured' && (
        <section ref={modalRef} className={styles.statusOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-modal-title" aria-describedby="last-bell-modal-description" aria-label="붙잡힘">
          <div className={styles.statusPanel}>
            <span className={styles.serial}>ENCOUNTER RESET · SAME SEED</span>
            <h2 id="last-bell-modal-title">소리가 너무 가까웠다.</h2>
            <p id="last-bell-modal-description">마지막 안전 체크포인트에서 같은 학교, 같은 위험 배치로 다시 시작합니다. 숨을 참으며 Q를 눌러 들어보세요.</p>
            <button ref={modalPrimaryRef} type="button" className={styles.primaryButton} onClick={modalPrimaryAction}>다시 시도</button>
          </div>
        </section>
      )}

      {activeModal === 'complete' && (
        <section ref={modalRef} className={styles.statusOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-modal-title" aria-describedby="last-bell-modal-description" aria-label="Chapter 1 완료">
          <div className={styles.statusPanel}>
            <Image src={LAST_BELL_ASSETS.logo} alt="지금 우리 학교는" width={500} height={533} sizes="3.6rem" />
            <span className={styles.serial}>CHAPTER 01 COMPLETE</span>
            <h2 id="last-bell-modal-title">마지막 종이 울렸다.</h2>
            <p id="last-bell-modal-description">방화문 너머의 계단에 도착했습니다. 이 기록은 로컬 생존 기록일 뿐, 보상·순위·구매 권한을 만들지 않습니다.</p>
            <dl className={styles.completionRecord} aria-label="생존 기록 요약">
              <div><dt>경로</dt><dd>{completeRouteLabel}</dd></div>
              <div><dt>활동 시간</dt><dd>{formatActiveDuration(completeDuration)}</dd></div>
              <div><dt>생존 방식</dt><dd>{completeStyle ? PLAY_STYLE_LABEL[completeStyle] : '기록 정리 중'}</dd></div>
              <div><dt>붙잡힘</dt><dd>{completionRecord?.captureCount ?? 0}회</dd></div>
            </dl>
            {comparisonResult
              ? <ComparisonResultActions result={comparisonResult} candidateName="Last Bell" onRetry={restartFromComplete} primaryActionRef={modalPrimaryRef} />
              : <button ref={modalPrimaryRef} type="button" className={styles.primaryButton} onClick={restartFromComplete}>다시 하기</button>}
          </div>
        </section>
      )}
    </main>
  );
}
