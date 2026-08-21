'use client';

/* Full-bleed cinematic plates intentionally bypass next/image optimization. */
/* eslint-disable @next/next/no-img-element */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  canInteractAt,
  initialLastBellState,
  objectiveForState,
  reduceLastBellState,
  type LastBellAnchorId,
} from '@/lib/prototypes/last-bell/state';
import { LAST_BELL_ASSETS, type LastBellAudioId } from '@/lib/prototypes/last-bell/assets';
import {
  checkpointIdLabel,
  clearLastBellCheckpoint,
  loadLastBellCheckpoint,
  saveLastBellCheckpoint,
  type LastBellCheckpointPayload,
} from '@/lib/prototypes/last-bell/persistence';
import { useLastBellAudio } from './useLastBellAudio';
import styles from './last-bell.module.css';

const LastBellRuntime = dynamic(
  () => import('./LastBellRuntime').then((module) => module.LastBellRuntime),
  { ssr: false, loading: () => <div aria-label="3D 학교 공간을 불러오는 중" /> },
);

type InputVector = { x: number; y: number };

const INTERACTION_COPY: Partial<Record<LastBellAnchorId, string>> = {
  classroom_door: '문 잠그기',
  desk_hide: '책상 뒤에 숨기',
  corridor_hide_left: '사물함 틈에 숨기',
  corridor_hide_right: '복도 벽감에 숨기',
  bell_hide: '계단 옆 틈에 숨기',
  utility_panel: '비상전원 올리기',
  fire_door_lock: '화재문 잠그기',
  bell_trigger: '마지막 종 울리기',
  chapter_exit: '안전 계단으로 들어가기',
};

const ACTION_AUDIO: Partial<Record<LastBellAnchorId, LastBellAudioId>> = {
  classroom_door: 'doorPounding',
  utility_panel: 'breaker',
  bell_trigger: 'bell',
};

function getPortraitState() {
  return typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
}

export function LastBellClient() {
  const [state, dispatch] = useReducer(reduceLastBellState, initialLastBellState);
  const [openingElapsed, setOpeningElapsed] = useState(0);
  const [openingArmed, setOpeningArmed] = useState(false);
  const [nearest, setNearest] = useState<LastBellAnchorId | null>(null);
  const [danger, setDanger] = useState(0);
  const [paused, setPaused] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [savedCheckpoint, setSavedCheckpoint] = useState<LastBellCheckpointPayload | null>(null);
  const moveRef = useRef<InputVector>({ x: 0, y: 0 });
  const lookRef = useRef<InputVector>({ x: 0, y: 0 });
  const runRef = useRef(false);
  const positionRef = useRef({ x: 0, z: 9 });
  const stickPointerRef = useRef<number | null>(null);
  const touchLookRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastDangerReportRef = useRef(0);
  const pressedKeysRef = useRef(new Set<string>());
  const hadPointerLockRef = useRef(false);
  const audio = useLastBellAudio();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setSavedCheckpoint(loadLastBellCheckpoint(window.localStorage)); } catch { setSavedCheckpoint(null); }
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
        const payload = saveLastBellCheckpoint(window.localStorage, 'ch1_handoff', state);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'power' && state.powerRestored && !state.captured) {
        const payload = saveLastBellCheckpoint(window.localStorage, 'ch1_power_restored', state);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'bell' && state.bellTriggered && !state.captured) {
        const payload = saveLastBellCheckpoint(window.localStorage, 'ch1_post_bell_safe', state);
        window.setTimeout(() => setSavedCheckpoint(payload), 0);
      } else if (state.phase === 'complete') {
        clearLastBellCheckpoint(window.localStorage);
        window.setTimeout(() => setSavedCheckpoint(null), 0);
      }
    } catch {
      // local progress is optional; a storage-blocked browser still plays.
    }
  }, [state]);

  useEffect(() => {
    audio.syncPhase(state.phase, state.listening, state.hiding);
  }, [audio, state.hiding, state.listening, state.phase]);

  const availableAnchors = useMemo<LastBellAnchorId[]>(() => [
    'classroom_door', 'desk_hide', 'corridor_hide_left', 'corridor_hide_right', 'bell_hide', 'utility_panel', 'fire_door_lock', 'bell_trigger', 'chapter_exit',
  ], []);

  const onPosition = useCallback((position: { x: number; z: number }) => {
    positionRef.current = position;
    const next = availableAnchors.find((anchor) => canInteractAt(state, anchor, position)) ?? null;
    setNearest((current) => current === next ? current : next);
  }, [availableAnchors, state]);

  const onDanger = useCallback((distance: number) => {
    const value = state.bellTriggered ? Math.max(0, Math.min(1, 1 - (distance - 1.5) / 25)) : Math.min(.28, Math.max(0, 1 - distance / 25));
    const now = performance.now();
    if (now - lastDangerReportRef.current < 120) return;
    lastDangerReportRef.current = now;
    setDanger(value);
    if (state.bellTriggered && distance < 1.5 && !state.hiding && !state.captured) dispatch({ type: 'CAPTURED' });
  }, [state.bellTriggered, state.captured, state.hiding]);

  const interact = useCallback(() => {
    audio.unlock();
    if (!nearest) return;
    if (nearest === 'classroom_door') dispatch({ type: 'LOCK_CLASSROOM_DOOR' });
    if (nearest?.includes('hide')) dispatch({ type: 'TOGGLE_HIDE' });
    if (nearest === 'utility_panel') dispatch({ type: 'RESTORE_POWER' });
    if (nearest === 'fire_door_lock') dispatch({ type: 'LOCK_FIRE_DOOR' });
    if (nearest === 'bell_trigger') dispatch({ type: 'TRIGGER_BELL' });
    if (nearest === 'chapter_exit') dispatch({ type: 'REACH_CHAPTER_EXIT' });
    const sound = ACTION_AUDIO[nearest];
    if (sound) audio.play(sound, { volume: sound === 'doorPounding' ? .42 : .68 });
  }, [audio, nearest]);

  const toggleListen = useCallback(() => {
    audio.unlock();
    dispatch({ type: 'TOGGLE_LISTEN' });
  }, [audio]);

  const toggleHide = useCallback(() => {
    audio.unlock();
    if (nearest?.includes('hide')) dispatch({ type: 'TOGGLE_HIDE' });
  }, [audio, nearest]);

  const retryFromCheckpoint = useCallback(() => {
    moveRef.current = { x: 0, y: 0 };
    lookRef.current = { x: 0, y: 0 };
    runRef.current = false;
    setNearest(null);
    setDanger(0);
    setPaused(false);
    setRetryNonce((value) => value + 1);
    dispatch({ type: 'RETRY' });
  }, []);

  const continueFromCheckpoint = useCallback(() => {
    if (!savedCheckpoint) return;
    audio.unlock();
    setOpeningElapsed(30);
    setOpeningArmed(true);
    setNearest(null);
    setDanger(0);
    setRetryNonce((value) => value + 1);
    dispatch({ type: 'RESTORE_CHECKPOINT', checkpointId: savedCheckpoint.checkpointId });
  }, [audio, savedCheckpoint]);

  useEffect(() => {
    const refreshMovement = () => {
      const keys = pressedKeysRef.current;
      moveRef.current = {
        x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')),
        y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')),
      };
    };
    const onKeyDown = (event: KeyboardEvent) => {
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
      else if (hadPointerLockRef.current && state.phase !== 'opening') setPaused(true);
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
  }, [interact, state.phase, toggleHide, toggleListen]);

  const setOpeningStart = useCallback(() => {
    audio.unlock();
    if (!openingArmed) {
      setOpeningArmed(true);
      audio.play('classroomAmbience', { volume: .26, loop: true });
      return;
    }
    dispatch({ type: 'START_PLAY' });
  }, [audio, openingArmed]);

  const skipOpening = useCallback(() => {
    audio.unlock();
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
  const prompt = nearest ? INTERACTION_COPY[nearest] : null;
  const runtimeActive = !paused && !portrait && !showOpening && !state.captured && state.phase !== 'complete';

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
          onPosition={onPosition}
          onDanger={onDanger}
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
          <img className={styles.cinematicImage} src={LAST_BELL_ASSETS.openingPlate} alt="늦은 오후, 아직 평온한 한국 고등학교 교실" />
          {openingElapsed > 21 && <img className={`${styles.cinematicImage} ${styles.cinematicImageOutbreak}`} src={LAST_BELL_ASSETS.outbreakPlate} alt="교실 문 너머로 번지는 이상 징후" />}
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

      {paused && !showOpening && (
        <section className={styles.statusOverlay} aria-label="일시정지">
          <div className={styles.statusPanel}>
            <span className={styles.serial}>PAUSED · C-201</span>
            <h2>잠깐, 숨을 고른다.</h2>
            <p>Esc를 누르거나 아래 버튼을 눌러 학교로 돌아가세요.</p>
            <button type="button" className={styles.primaryButton} onClick={() => setPaused(false)}>계속하기</button>
          </div>
        </section>
      )}

      {state.captured && (
        <section className={styles.statusOverlay} aria-label="붙잡힘">
          <div className={styles.statusPanel}>
            <span className={styles.serial}>ENCOUNTER RESET · SAME SEED</span>
            <h2>소리가 너무 가까웠다.</h2>
            <p>마지막 안전 체크포인트에서 같은 학교, 같은 위험 배치로 다시 시작합니다. 숨을 참으며 Q를 눌러 들어보세요.</p>
            <button type="button" className={styles.primaryButton} onClick={retryFromCheckpoint}>다시 시도</button>
          </div>
        </section>
      )}

      {state.phase === 'complete' && (
        <section className={styles.statusOverlay} aria-label="Chapter 1 완료">
          <div className={styles.statusPanel}>
            <img src={LAST_BELL_ASSETS.logo} alt="지금 우리 학교는" />
            <span className={styles.serial}>CHAPTER 01 COMPLETE</span>
            <h2>마지막 종이 울렸다.</h2>
            <p>방화문 너머의 계단에 도착했습니다. Chapter 1 체크포인트는 완료와 함께 정리됩니다.</p>
            <button type="button" className={styles.primaryButton} onClick={() => window.location.reload()}>처음부터 보기</button>
          </div>
        </section>
      )}
    </main>
  );
}
