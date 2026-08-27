'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  createHyosanMobileInputBridge,
  type HyosanAction,
  type HyosanMobileInputBridge,
} from './input-bridge';
import type { HyosanHudState, HyosanRuntimeAction } from './phaser-runtime';
import styles from './HyosanMemories.module.css';

const INITIAL_HUD: HyosanHudState = {
  health: 5,
  remaining: 24,
  total: 24,
  roomLocked: true,
  roomCleared: false,
  roomStarted: false,
  roomExited: false,
  defeated: false,
  fps: 0,
  step: 0,
  playerX: 640,
  playerY: 580,
};

const INITIAL_ACTION_COUNTS = { attack: 0, skill: 0, dash: 0 };

function VirtualJoystick({ input }: { input: HyosanMobileInputBridge }) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);

  const update = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad || pointerRef.current !== event.pointerId) return;
    const bounds = pad.getBoundingClientRect();
    const radius = bounds.width * 0.34;
    const rawX = event.clientX - (bounds.left + bounds.width / 2);
    const rawY = event.clientY - (bounds.top + bounds.height / 2);
    const length = Math.hypot(rawX, rawY);
    const scale = length > radius ? radius / length : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    input.setMovement(x / radius, y / radius);
    if (knobRef.current) knobRef.current.style.transform = `translate(${x}px, ${y}px)`;
  }, [input]);

  const reset = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    input.setMovement(0, 0);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  }, [input]);

  return (
    <div
      ref={padRef}
      className={styles.joystick}
      aria-label="이동 조이스틱"
      data-control="joystick"
      onPointerDown={(event) => {
        if (pointerRef.current !== null) return;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={update}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div ref={knobRef} className={styles.joystickKnob} />
    </div>
  );
}

function ActionButton({
  action,
  label,
  keyLabel,
  input,
}: {
  action: HyosanAction;
  label: string;
  keyLabel: string;
  input: HyosanMobileInputBridge;
}) {
  return (
    <button
      type="button"
      className={`${styles.actionButton} ${styles[`action_${action}`]}`}
      aria-label={`${label} (${keyLabel})`}
      data-action={action}
      onPointerDown={(event) => {
        event.preventDefault();
        input.press(action);
      }}
      onClick={(event) => {
        if (event.detail === 0) input.press(action);
      }}
    >
      <span>{label}</span>
      <small>{keyLabel}</small>
    </button>
  );
}

export default function HyosanMemoriesGame() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [mobileInput] = useState(createHyosanMobileInputBridge);
  const [hud, setHud] = useState(INITIAL_HUD);
  const [ready, setReady] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  const [action, setAction] = useState('기억 에코 진입');
  const [actionCounts, setActionCounts] = useState(INITIAL_ACTION_COUNTS);
  const [run, setRun] = useState(0);

  const handleAction = useCallback((nextAction: HyosanRuntimeAction) => {
    setAction(nextAction.label);
    if (nextAction.code === 'attack' || nextAction.code === 'skill' || nextAction.code === 'dash') {
      setActionCounts((counts) => ({
        ...counts,
        [nextAction.code]: counts[nextAction.code] + 1,
      }));
    }
  }, []);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    let disposed = false;
    let game: {
      destroy(removeCanvas: boolean, noReturn?: boolean): void;
      loop: { wake(): void };
    } | null = null;
    setReady(false);
    setBootFailed(false);
    setHud(INITIAL_HUD);
    setActionCounts(INITIAL_ACTION_COUNTS);
    mobileInput.reset();

    void import('./phaser-runtime').then(({ mountHyosanPhaserGame }) => {
      if (disposed) return;
      game = mountHyosanPhaserGame({
        parent,
        mobileInput,
        seed: `hyosan-g1-cafeteria-${run}`,
        reducedMotion: typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        onReady: () => setReady(true),
        onHud: setHud,
        onAction: handleAction,
      });
    }).catch((error: unknown) => {
      if (disposed) return;
      console.error('[hyosan-memories] Phaser boot failed', error);
      mobileInput.reset();
      parent.replaceChildren();
      setReady(false);
      setBootFailed(true);
      setAction('게임 부트 실패');
    });

    return () => {
      disposed = true;
      mobileInput.reset();
      if (game) {
        game.destroy(true);
        game.loop.wake();
      }
    };
  }, [handleAction, mobileInput, run]);

  const restart = useCallback(() => setRun((current) => current + 1), []);

  return (
    <main
      className={styles.game}
      aria-label="효산의 기억 — 급식실 그레이박스"
      data-hyosan-ready={ready ? 'true' : 'false'}
      data-hyosan-boot-error={bootFailed ? 'true' : 'false'}
      data-active-zombies={hud.remaining}
      data-total-zombies={hud.total}
      data-fps={hud.fps}
      data-room-locked={hud.roomLocked ? 'true' : 'false'}
      data-room-started={hud.roomStarted ? 'true' : 'false'}
      data-room-exited={hud.roomExited ? 'true' : 'false'}
      data-player-x={hud.playerX}
      data-player-y={hud.playerY}
      data-last-action={action}
      data-attack-count={actionCounts.attack}
      data-skill-count={actionCounts.skill}
      data-dash-count={actionCounts.dash}
      data-player-health={hud.health}
      data-simulation-step={hud.step}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={parentRef} className={styles.canvasHost} />

      <div className={styles.hud}>
        <section className={styles.statusCluster} aria-label="전투 상태">
          <span className={styles.eyebrow}>MEMORY ECHO 01 / CAFETERIA</span>
          <div className={styles.healthRow}>
            <span>절비 생존</span>
            <div className={styles.healthPips} aria-label={`체력 ${hud.health} / 5`}>
              {Array.from({ length: 5 }, (_, index) => (
                <i key={index} data-active={index < hud.health ? 'true' : 'false'} aria-hidden="true" />
              ))}
            </div>
          </div>
          <strong className={styles.waveCount}>잔존 {hud.remaining.toString().padStart(2, '0')} / {hud.total}</strong>
        </section>

        <section
          className={styles.roomState}
          data-open={hud.roomCleared ? 'true' : 'false'}
          aria-live="polite"
        >
          <span>{!hud.roomStarted ? '입력 대기' : hud.roomLocked ? '출입문 봉쇄' : hud.roomExited ? '기억 안정화' : '출입문 개방'}</span>
          <small>{hud.roomStarted ? action : '이동하거나 J / K / L을 눌러 시작'}</small>
        </section>

        <section className={styles.perf} aria-label="실행 상태">
          <span>{bootFailed ? 'SIM OFFLINE' : ready ? 'SIM ONLINE' : 'BOOTING'}</span>
          <small>{bootFailed ? '재시도 가능' : hud.fps > 0 ? `${hud.fps} FPS` : 'FPS --'}</small>
        </section>
      </div>

      {!bootFailed ? (
        <>
          <aside className={styles.desktopHelp} aria-label="키보드 조작법">
            <span>이동</span><kbd>WASD / ↑↓←→</kbd>
            <span>공격</span><kbd>J</kbd>
            <span>감각</span><kbd>K</kbd>
            <span>대시</span><kbd>L</kbd>
          </aside>

          <div className={styles.mobileControls} aria-label="모바일 게임 조작">
            <VirtualJoystick input={mobileInput} />
            <div className={styles.actionCluster}>
              <ActionButton action="skill" label="감각" keyLabel="K" input={mobileInput} />
              <ActionButton action="dash" label="대시" keyLabel="L" input={mobileInput} />
              <ActionButton action="attack" label="공격" keyLabel="J" input={mobileInput} />
            </div>
          </div>
        </>
      ) : null}

      {bootFailed ? (
        <section className={styles.result} role="alert">
          <span>ECHO LOAD FAILED</span>
          <strong>게임을 시작하지 못했습니다</strong>
          <p>다시 시도하거나 안전하게 나갈 수 있습니다.</p>
          <div className={styles.resultActions}>
            <button type="button" onClick={restart}>다시 시도</button>
            <Link href="/">나가기</Link>
          </div>
        </section>
      ) : null}

      {(hud.defeated || hud.roomExited) ? (
        <section className={styles.result} role="status">
          <span>{hud.roomExited ? 'MEMORY STABILIZED' : 'ECHO LOST'}</span>
          <strong>{hud.roomExited ? '급식실 기억을 빠져나왔다' : '기억이 끊어졌다'}</strong>
          <button type="button" onClick={restart}>다시 진입</button>
        </section>
      ) : null}
    </main>
  );
}
