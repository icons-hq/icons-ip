'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  canInteractAt,
  initialLastBellState,
  objectiveForState,
  reduceLastBellState,
} from '@/lib/prototypes/last-bell/state';
import { LAST_BELL_ASSETS } from '@/lib/prototypes/last-bell/assets';
import {
  INTERACTION_DESCRIPTORS,
  interactionDescriptorFor,
  type LastBellInteractionAnchor,
} from '@/lib/prototypes/last-bell/interactions';
import { lastBellDoorHandoffFor, type LastBellDoorId } from '@/lib/prototypes/last-bell/engine/movement';
import type { LastBellDoorHandoffCommand } from './LastBellRuntime';
import {
  checkpointIdLabel,
  clearLastBellCheckpoint,
  loadLastBellCheckpoint,
  saveLastBellCheckpoint,
  type LastBellCheckpointPayload,
} from '@/lib/prototypes/last-bell/persistence';
import {
  advanceLastBellRunMetrics,
  clearLastBellCompletion,
  createLastBellCompletionRecord,
  createLastBellRunMetrics,
  loadLastBellCompletion,
  recordLastBellCapture,
  recordLastBellRetry,
  saveLastBellCompletion,
  type LastBellCompletionRecord,
  type LastBellRunMetrics,
} from '@/lib/prototypes/last-bell/completion';
import { useLastBellAudio } from './useLastBellAudio';
import styles from './last-bell.module.css';

const LastBellRuntime = dynamic(
  () => import('./LastBellRuntime').then((module) => module.LastBellRuntime),
  { ssr: false, loading: () => <div aria-label="3D 학교 공간을 불러오는 중" /> },
);

type InputVector = { x: number; y: number };

const POPUP_PATH = '/games/prototype-last-bell/popup';
const POPUP_STORE_PATH = `${POPUP_PATH}/store`;

const ROUTE_LABEL = {
  central: '정면 복도',
  rear: '후문 사물함',
  systems: '설비실 안내선',
} as const;

const PLAY_STYLE_LABEL = {
  listener: '소리를 읽은 생존자',
  shadow: '그림자를 따른 생존자',
  runner: '끝까지 달린 생존자',
  resilient: '다시 일어난 생존자',
} as const;

const INTERACTIVE_ANCHORS = INTERACTION_DESCRIPTORS.map(({ anchor }) => anchor);

function getPortraitState() {
  return typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
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

export function LastBellClient() {
  const [state, dispatch] = useReducer(reduceLastBellState, initialLastBellState);
  const [openingElapsed, setOpeningElapsed] = useState(0);
  const [openingArmed, setOpeningArmed] = useState(false);
  const [nearest, setNearest] = useState<LastBellInteractionAnchor | null>(null);
  const [danger, setDanger] = useState(0);
  const [paused, setPaused] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [handoff, setHandoff] = useState<LastBellDoorHandoffCommand | null>(null);
  const [savedCheckpoint, setSavedCheckpoint] = useState<LastBellCheckpointPayload | null>(null);
  const [completionRecord, setCompletionRecord] = useState<LastBellCompletionRecord | null>(null);
  const nearestRef = useRef<LastBellInteractionAnchor | null>(null);
  const phaseRef = useRef(state.phase);
  const moveRef = useRef<InputVector>({ x: 0, y: 0 });
  const lookRef = useRef<InputVector>({ x: 0, y: 0 });
  const runRef = useRef(false);
  const positionRef = useRef({ x: 0, z: 9 });
  const stickPointerRef = useRef<number | null>(null);
  const touchLookRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastDangerReportRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const hadPointerLockRef = useRef(false);
  const runMetricsRef = useRef<LastBellRunMetrics>(createLocalRunMetrics());
  const completionSavedRef = useRef(false);
  const audio = useLastBellAudio();
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
  const completePrimaryRef = useRef<HTMLAnchorElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSavedCheckpoint(loadLastBellCheckpoint(window.localStorage));
        setCompletionRecord(loadLastBellCompletion(window.localStorage));
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
    if (state.phase !== 'opening' || !openingArmed) return;
    const timer = window.setInterval(() => setOpeningElapsed((value) => Math.min(value + .1, 30)), 100);
    return () => window.clearInterval(timer);
  }, [openingArmed, state.phase]);

  useEffect(() => {
    try {
      if (state.phase === 'corridor' && state.checkpoint === 'corridor' && state.doorLocked && !state.captured) {
        const payload = saveLastBellCheckpoint(window.localStorage, 'ch1_handoff', state, runMetricsRef.current, state.routeId, state.routeObjective);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'power' && state.powerRestored && !state.captured) {
        const payload = saveLastBellCheckpoint(window.localStorage, 'ch1_power_restored', state, runMetricsRef.current, state.routeId, state.routeObjective);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'complete') {
        clearLastBellCheckpoint(window.localStorage);
        window.setTimeout(() => setSavedCheckpoint(null), 0);
        if (!completionSavedRef.current && state.routeId) {
          completionSavedRef.current = true;
          const record = createLastBellCompletionRecord(runMetricsRef.current, state.routeId, new Date().toISOString());
          const saved = saveLastBellCompletion(window.localStorage, record);
          window.setTimeout(() => setCompletionRecord(saved ?? record), 0);
        }
      }
    } catch {
      // local progress is optional; a storage-blocked browser still plays.
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
    const next = INTERACTIVE_ANCHORS.find((anchor) => canInteractAt(state, anchor, position)) ?? null;
    setNearestValue(next);
  }, [setNearestValue, state]);

  const onDanger = useCallback((distance: number) => {
    const value = state.bellTriggered ? Math.max(0, Math.min(1, 1 - (distance - 1.5) / 25)) : Math.min(.28, Math.max(0, 1 - distance / 25));
    const now = performance.now();
    if (now - lastDangerReportRef.current < 120) return;
    lastDangerReportRef.current = now;
    setDanger(value);
  }, [state.bellTriggered]);

  const onCapture = useCallback(() => {
    if (state.bellTriggered && !state.hiding && !state.captured) {
      runMetricsRef.current = recordLastBellCapture(runMetricsRef.current);
      dispatch({ type: 'CAPTURED' });
    }
  }, [state.bellTriggered, state.captured, state.hiding]);

  const onSimulationStep = useCallback((durationMs: number, flags: { listening: boolean; hiding: boolean; running: boolean }) => {
    runMetricsRef.current = advanceLastBellRunMetrics(runMetricsRef.current, durationMs, flags);
  }, []);

  const requestDoorHandoff = useCallback((door: LastBellDoorId) => {
    const nextHandoff = lastBellDoorHandoffFor(door);
    setHandoff((current) => ({ ...nextHandoff, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const interact = useCallback(() => {
    audio.unlock();
    const descriptor = interactionDescriptorFor(nearestRef.current);
    if (!descriptor) return;
    switch (descriptor.action) {
      case 'lockClassroomDoor':
        dispatch({ type: 'LOCK_CLASSROOM_DOOR' });
        requestDoorHandoff('classroom');
        break;
      case 'selectRoute':
        if (descriptor.routeId) dispatch({ type: 'SELECT_ROUTE', routeId: descriptor.routeId });
        break;
      case 'completeRouteObjective':
        if (descriptor.routeId) dispatch({ type: 'COMPLETE_ROUTE_OBJECTIVE', routeId: descriptor.routeId });
        break;
      case 'toggleHide':
        dispatch({ type: 'TOGGLE_HIDE' });
        break;
      case 'restorePower':
        dispatch({ type: 'RESTORE_POWER' });
        break;
      case 'lockFireDoor':
        dispatch({ type: 'LOCK_FIRE_DOOR' });
        requestDoorHandoff('fire');
        break;
      case 'triggerBell':
        dispatch({ type: 'TRIGGER_BELL' });
        break;
      case 'reachChapterExit':
        dispatch({ type: 'REACH_CHAPTER_EXIT' });
        break;
    }
    if (descriptor.audio) audio.play(descriptor.audio.id, { volume: descriptor.audio.volume });
  }, [audio, requestDoorHandoff]);

  const toggleListen = useCallback(() => {
    audio.unlock();
    dispatch({ type: 'TOGGLE_LISTEN' });
  }, [audio]);

  const toggleHide = useCallback(() => {
    audio.unlock();
    if (interactionDescriptorFor(nearestRef.current)?.action === 'toggleHide') dispatch({ type: 'TOGGLE_HIDE' });
  }, [audio]);

  const retryFromCheckpoint = useCallback(() => {
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    setNearestValue(null);
    setDanger(0);
    setPaused(false);
    runMetricsRef.current = recordLastBellRetry(runMetricsRef.current);
    setRetryNonce((value) => value + 1);
    dispatch({ type: 'RETRY' });
  }, [setNearestValue]);

  const restartFromComplete = useCallback(() => {
    try { clearLastBellCompletion(window.localStorage); } catch { /* local presentation is optional */ }
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
    const focusFrame = window.requestAnimationFrame(() => {
      if (activeModal === 'complete') completePrimaryRef.current?.focus();
      else modalPrimaryRef.current?.focus();
    });
    const onModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        modalPrimaryAction();
      } else if (event.key === 'Tab') {
        const container = modalRef.current;
        const focusable = container
          ? Array.from(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
          : [];
        if (focusable.length === 0) {
          event.preventDefault();
        } else {
          const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
          const nextIndex = currentIndex < 0
            ? 0
            : event.shiftKey
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
  }, [activeModal, modalOpen, modalPrimaryAction, moveRef, runRef]);

  const continueFromCheckpoint = useCallback(() => {
    if (!savedCheckpoint) return;
    audio.unlock();
    setOpeningElapsed(30);
    setOpeningArmed(true);
    setNearestValue(null);
    setDanger(0);
    setRetryNonce((value) => value + 1);
    runMetricsRef.current = savedCheckpoint.runMetrics;
    completionSavedRef.current = false;
    dispatch({
      type: 'RESTORE_CHECKPOINT',
      checkpointId: savedCheckpoint.checkpointId,
      routeId: savedCheckpoint.routeId ?? undefined,
      routeObjective: savedCheckpoint.routeObjective,
    });
  }, [audio, savedCheckpoint, setNearestValue]);

  useEffect(() => {
    const refreshMovement = () => {
      const keys = pressedKeysRef.current;
      moveRef.current = {
        x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')),
        y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')),
      };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        pressedKeysRef.current.add(key);
        refreshMovement();
      }
      if (event.repeat) return;
      if (event.key === 'Shift') runRef.current = true;
      if (event.key.toLowerCase() === 'e') interact();
      if (event.key.toLowerCase() === 'q') toggleListen();
      if (event.key.toLowerCase() === 'c') toggleHide();
      if (event.key === 'Escape') setPaused((value) => !value);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      const key = event.key.toLowerCase();
      pressedKeysRef.current.delete(key);
      refreshMovement();
      if (event.key === 'Shift') runRef.current = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement) {
        lookRef.current.x += event.movementX;
        lookRef.current.y += event.movementY;
      }
    };
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && event.clientX > window.innerWidth * .48 && event.clientY < window.innerHeight * .8) {
        touchLookRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const onTouchLook = (event: PointerEvent) => {
      const previous = touchLookRef.current;
      if (event.pointerType !== 'touch' || !previous || previous.id !== event.pointerId) return;
      lookRef.current.x += event.clientX - previous.x;
      lookRef.current.y += event.clientY - previous.y;
      touchLookRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (touchLookRef.current?.id === event.pointerId) touchLookRef.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onTouchStart);
    window.addEventListener('pointermove', onTouchLook);
    window.addEventListener('pointerup', onTouchEnd);
    window.addEventListener('pointercancel', onTouchEnd);
    const onPointerLock = () => {
      if (document.pointerLockElement) hadPointerLockRef.current = true;
      else if (hadPointerLockRef.current && phaseRef.current !== 'opening') setPaused(true);
    };
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
  }, [interact, toggleHide, toggleListen]);

  const setOpeningStart = useCallback(() => {
    audio.unlock();
    if (!openingArmed) {
      completionSavedRef.current = false;
      setCompletionRecord(null);
      setOpeningArmed(true);
      audio.play('classroomAmbience', { volume: .26, loop: true });
      return;
    }
    dispatch({ type: 'START_PLAY' });
  }, [audio, openingArmed]);

  const skipOpening = useCallback(() => {
    audio.unlock();
    completionSavedRef.current = false;
    setCompletionRecord(null);
    setOpeningElapsed(30);
    setOpeningArmed(true);
    dispatch({ type: 'SKIP_OPENING' });
  }, [audio]);

  const pointerLock = useCallback(() => {
    audio.unlock();
    const canvas = document.querySelector('canvas');
    if (canvas && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
  }, [audio]);

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

  const showOpening = state.phase === 'opening';
  const progress = `${Math.round((openingElapsed / 30) * 100)}%`;
  const prompt = interactionDescriptorFor(nearest)?.copy ?? null;
  const runtimeActive = !paused && !portrait && !showOpening && !state.captured && state.phase !== 'complete';
  const completeRouteLabel = completionRecord?.routeId ? ROUTE_LABEL[completionRecord.routeId] : state.routeId ? ROUTE_LABEL[state.routeId] : null;
  const completeDuration = completionRecord?.activeDurationMs ?? 0;
  const completeStyle = completionRecord?.playStyle ?? null;

  return (
    <main className={styles.root} data-portrait={portrait ? 'true' : 'false'}>
      <section className={styles.scene} aria-label="효산고 Chapter 1 3D 게임">
        <LastBellRuntime
          state={state}
          moveRef={moveRef}
          lookRef={lookRef}
          runRef={runRef}
          resetNonce={retryNonce}
          checkpoint={state.checkpoint}
          active={runtimeActive}
          handoff={handoff}
          onPosition={onPosition}
          onDanger={onDanger}
          onCapture={onCapture}
          onSimulationStep={onSimulationStep}
          onCanvasInteract={pointerLock}
        />
        <div className={styles.hud} aria-live="polite">
          <div className={styles.topbar}>
            <div className={styles.objective}>
              <span className={styles.objectiveLabel}>현재 목표 · CHAPTER 01</span>
              <span className={styles.objectiveText}>{objectiveForState(state)}</span>
            </div>
            <div className={styles.sound}>
              <span className={styles.soundLabel}>{state.listening ? '집중 청취' : '주변 소리'}</span>
              <span className={`${styles.soundSignal} ${state.listening ? styles.soundSignalActive : ''}`} aria-label={`위험도 ${Math.round(danger * 100)}%`}>
                <i /><i /><i /><i />
              </span>
              {state.listening && <span className={styles.soundDirection}>{danger > .65 ? '오른쪽 뒤 · 감염자 · 강' : '왼쪽 복도 · 발소리 · 약'}</span>}
            </div>
          </div>
          <div className={styles.crosshair} aria-hidden="true" />
          {state.hiding && <div className={styles.hideVignette} aria-hidden="true" />}
          {state.hiding && <div className={styles.hideStatus}>숨는 중 · C로 나오기</div>}
          {prompt && !paused && <div className={styles.prompt}><span className={styles.key}>E</span>{prompt}</div>}
          <div className={styles.hint}><kbd>WASD</kbd> 이동 · <kbd>마우스</kbd> 시점 · <kbd>Q</kbd> 듣기 · <kbd>C</kbd> 숨기 · <kbd>Shift</kbd> 달리기 · <kbd>Esc</kbd> 일시정지</div>
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
              <button type="button" className={`${styles.actionButton} ${state.listening ? styles.actionButtonActive : ''}`} onClick={toggleListen}>듣기</button>
              <button type="button" className={`${styles.actionButton} ${state.hiding ? styles.actionButtonActive : ''}`} onClick={toggleHide}>숨기</button>
              <button type="button" className={styles.actionButton} onPointerDown={() => { runRef.current = true; }} onPointerUp={() => { runRef.current = false; }} onPointerCancel={() => { runRef.current = false; }}>달리기</button>
              <button type="button" className={styles.actionButton} onClick={interact}>행동</button>
            </div>
          </div>
        </div>
      </section>

      <div
        className={styles.rotateHint}
        role="status"
        aria-live="polite"
        aria-hidden={!portrait}
      >
        <span className={styles.rotateHintIcon} aria-hidden="true">↻</span>
        <strong>화면을 가로로 돌려주세요</strong>
        <span>가로 화면이 될 때까지 게임은 잠시 멈춰 있습니다.</span>
      </div>

      {showOpening && (
        <section className={styles.cinematic} aria-label="30초 오프닝">
          <Image className={styles.cinematicImage} src={LAST_BELL_ASSETS.openingPlate} alt="늦은 오후, 아직 평온한 한국 고등학교 교실" fill preload sizes="100vw" />
          {openingElapsed > 21 && <Image className={`${styles.cinematicImage} ${styles.cinematicImageOutbreak}`} src={LAST_BELL_ASSETS.outbreakPlate} alt="교실 문 너머로 번지는 이상 징후" fill sizes="100vw" />}
          <div className={styles.cinematicShade} />
          <div className={styles.cinematicCopy}>
            <span className={styles.serial}>HYOSAN HIGH · C-201 · 2025.03.18</span>
            <h1 className={styles.cinematicTitle}>마지막 수업이<br />끝나기 전까지.</h1>
            <p className={styles.cinematicSub}>{openingElapsed > 21 ? '문을 잠가. 지금 당장.' : '평범한 하루는 아주 작은 소리로 끝난다.'}</p>
          </div>
          <div className={styles.cinematicControls}>
            <div className={styles.progress} style={{ '--progress': progress } as React.CSSProperties}><span /></div>
            <button type="button" className={styles.ghostButton} onClick={skipOpening}>오프닝 건너뛰기</button>
            {!openingArmed && <button type="button" className={styles.primaryButton} onClick={setOpeningStart}>소리와 함께 시작</button>}
            {openingArmed && openingElapsed > 26 && <button type="button" className={styles.primaryButton} onClick={setOpeningStart}>게임 시작</button>}
            {savedCheckpoint && <button type="button" className={styles.checkpointButton} onClick={continueFromCheckpoint}>체크포인트에서 계속 · {checkpointIdLabel(savedCheckpoint.checkpointId)}</button>}
          </div>
        </section>
      )}

      {activeModal === 'paused' && (
        <section ref={modalRef} className={styles.statusOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-modal-title" aria-describedby="last-bell-modal-description" aria-label="일시정지">
          <div className={styles.statusPanel}>
            <span className={styles.serial}>PAUSED · C-201</span>
            <h2 id="last-bell-modal-title">잠깐, 숨을 고른다.</h2>
            <p id="last-bell-modal-description">Esc를 누르거나 아래 버튼을 눌러 학교로 돌아가세요.</p>
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
            <div className={styles.completionActions}>
              <a ref={completePrimaryRef} className={styles.primaryButton} href={POPUP_PATH}>생존 기록이 있는 팝업으로</a>
              <a className={styles.ghostButton} href={POPUP_STORE_PATH}>매점 미리보기</a>
              <button type="button" className={styles.ghostButton} onClick={modalPrimaryAction}>다시 플레이</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
