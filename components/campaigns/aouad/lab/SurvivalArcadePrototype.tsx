'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AOUAD_IMAGES, AOUAD_POPUP_PATH } from '@/lib/campaigns/aouad/content';
import {
  createAouadComparisonResult,
  saveAouadComparisonResult,
  type AouadComparisonResult,
} from '@/lib/campaigns/aouad/lab/comparison';
import {
  initialSurvivalArcadeState,
  stepSurvivalArcade,
  SURVIVAL_ARCADE_DURATION_MS,
  SURVIVAL_ARCADE_FIXED_STEP_MS,
  type SurvivalArcadeInput,
  type SurvivalArcadeState,
} from '@/lib/campaigns/aouad/lab/survival-arcade';
import { ComparisonResultActions } from './ComparisonResultActions';
import styles from './aouad-lab.module.css';

type ArcadePhase = 'intro' | 'running' | 'paused' | 'result';
type ArcadeRun = { runId: string; startedAt: string; retryCount: number };

function arcadeRunId(now: number): string {
  return `arcade-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function inputFromKeys(keys: ReadonlySet<string>): SurvivalArcadeInput {
  return {
    x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')),
    y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')),
  };
}

function countdownLabel(elapsedMs: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((SURVIVAL_ARCADE_DURATION_MS - elapsedMs) / 1000));
  return `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
}

export function SurvivalArcadePrototype() {
  const [phase, setPhase] = useState<ArcadePhase>('intro');
  const [arcade, setArcade] = useState<SurvivalArcadeState>(initialSurvivalArcadeState);
  const [result, setResult] = useState<AouadComparisonResult | null>(null);
  const phaseRef = useRef<ArcadePhase>('intro');
  const arcadeRef = useRef<SurvivalArcadeState>(initialSurvivalArcadeState);
  const runRef = useRef<ArcadeRun | null>(null);
  const inputRef = useRef<SurvivalArcadeInput>({ x: 0, y: 0 });
  const pressedKeysRef = useRef(new Set<string>());
  const touchPointerRef = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (result) saveAouadComparisonResult(window.localStorage, result);
  }, [result]);

  const start = useCallback((retryCount = 0) => {
    const now = Date.now();
    const initial = structuredClone(initialSurvivalArcadeState);
    arcadeRef.current = initial;
    inputRef.current = { x: 0, y: 0 };
    pressedKeysRef.current.clear();
    runRef.current = { runId: arcadeRunId(now), startedAt: new Date(now).toISOString(), retryCount };
    setArcade(initial);
    setResult(null);
    phaseRef.current = 'running';
    setPhase('running');
  }, []);

  const retry = useCallback(() => {
    start((runRef.current?.retryCount ?? result?.retryCount ?? 0) + 1);
  }, [result?.retryCount, start]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') {
        if (phaseRef.current === 'running') {
          phaseRef.current = 'paused';
          setPhase('paused');
        } else if (phaseRef.current === 'paused') {
          phaseRef.current = 'running';
          setPhase('running');
        }
        return;
      }
      if (phaseRef.current !== 'running' || !['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      pressedKeysRef.current.add(key);
      inputRef.current = inputFromKeys(pressedKeysRef.current);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
      pressedKeysRef.current.delete(key);
      inputRef.current = inputFromKeys(pressedKeysRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let lastFrame = performance.now();
    let accumulator = 0;
    const frame = (now: number) => {
      const delta = Math.min(100, now - lastFrame);
      lastFrame = now;
      if (phaseRef.current === 'running') {
        accumulator += delta;
        let next = arcadeRef.current;
        while (accumulator >= SURVIVAL_ARCADE_FIXED_STEP_MS && next.resultType === null) {
          next = stepSurvivalArcade(next, inputRef.current, SURVIVAL_ARCADE_FIXED_STEP_MS);
          accumulator -= SURVIVAL_ARCADE_FIXED_STEP_MS;
        }
        if (next !== arcadeRef.current) {
          arcadeRef.current = next;
          setArcade(next);
        }
        if (next.resultType && runRef.current) {
          const run = runRef.current;
          setResult(createAouadComparisonResult({
            candidateId: 'survival-arcade',
            runId: run.runId,
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            activeDurationMs: next.elapsedMs,
            retryCount: run.retryCount,
            resultType: next.resultType,
          }));
          phaseRef.current = 'result';
          setPhase('result');
          inputRef.current = { x: 0, y: 0 };
          pressedKeysRef.current.clear();
        }
      }
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const togglePause = useCallback(() => {
    if (phaseRef.current === 'running') {
      phaseRef.current = 'paused';
      setPhase('paused');
    } else if (phaseRef.current === 'paused') {
      phaseRef.current = 'running';
      setPhase('running');
    }
  }, []);

  const pointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'running') return;
    touchPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const pointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const previous = touchPointerRef.current;
    if (!previous || previous.id !== event.pointerId || phaseRef.current !== 'running') return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    const magnitude = Math.hypot(dx, dy);
    inputRef.current = magnitude < 2 ? { x: 0, y: 0 } : { x: dx / Math.max(24, magnitude), y: dy / Math.max(24, magnitude) };
    touchPointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, []);

  const pointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (touchPointerRef.current?.id === event.pointerId) {
      touchPointerRef.current = null;
      inputRef.current = inputFromKeys(pressedKeysRef.current);
    }
  }, []);

  if (phase === 'intro') {
    return (
      <main className={styles.page}>
        <div className={styles.prototype}>
          <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>03 · SURVIVAL ARCADE</span></header>
          <section className={styles.storyPanel}>
            <div className={styles.storyImage}><Image src={AOUAD_IMAGES.cafeteria} alt="위험을 피해 움직여야 하는 효산고 급식실" fill preload sizes="(max-width: 680px) calc(100vw - 1.25rem), 42rem" /><div className={styles.storyShade} /></div>
            <div className={styles.storyContent}>
              <p className={styles.eyebrow}>180 SECOND SURVIVAL</p>
              <h1>180초 동안<br />위험 신호를 피해라.</h1>
              <p>WASD 또는 방향키로 이동합니다. 모바일에서는 화면을 누른 채 원하는 방향으로 드래그하세요. 닿으면 실패, 3분을 버티면 성공입니다.</p>
              <button type="button" className={styles.primaryButton} onClick={() => start()}>3분 생존 시작</button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (phase === 'result' && result) {
    const success = result.resultType === 'survived';
    return (
      <main className={styles.page}>
        <div className={styles.prototype}>
          <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>03 · RESULT</span></header>
          <section className={styles.resultPanel} data-result={result.resultType}>
            <p className={styles.eyebrow}>{success ? 'SURVIVED · LOCAL RECORD' : 'CAUGHT · LOCAL RECORD'}</p>
            <h1>{success ? '180초를 버텼다.' : '위험 신호가 너무 가까웠다.'}</h1>
            <p>{success ? '효산고의 소음을 끝까지 피했습니다.' : '시작 지점에서 즉시 다시 시도할 수 있습니다.'} 결과는 내부 비교를 위한 로컬 기록입니다.</p>
            <dl className={styles.resultMeta}>
              <div><dt>버틴 시간</dt><dd>{Math.floor(result.activeDurationMs / 1000)}초</dd></div>
              <div><dt>재도전</dt><dd>{result.retryCount}회</dd></div>
            </dl>
            <ComparisonResultActions result={result} candidateName="3분 생존" onRetry={retry} />
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.prototype}>
        <header className={styles.prototypeHeader}><Link href={`${AOUAD_POPUP_PATH}/lab`}>← 비교 허브</Link><span>03 · {phase === 'paused' ? 'PAUSED' : 'SURVIVE'}</span></header>
        <section className={styles.arcadePanel} aria-label="3분 생존 아케이드">
          <div className={styles.arcadeTopline}><span>생존까지 {countdownLabel(arcade.elapsedMs)}</span><span>목표 03:00</span></div>
          <div
            className={styles.arcadeArena}
            tabIndex={0}
            role="application"
            aria-label="위험 회피 구역. 방향키 또는 드래그로 이동"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerEnd}
            onPointerCancel={pointerEnd}
          >
            {arcade.hazards.map((hazard) => <span key={hazard.id} className={styles.arcadeHazard} aria-hidden="true" style={{ left: `${hazard.x}%`, top: `${hazard.y}%` }} />)}
            <span className={styles.arcadePlayer} aria-hidden="true" style={{ left: `${arcade.player.x}%`, top: `${arcade.player.y}%` }} />
          </div>
          <p className={styles.arcadeHint}>키보드: WASD / 방향키 · 터치: 구역을 누른 채 드래그 · Esc 또는 버튼: 일시정지</p>
          <div className={styles.arcadeControls}>
            <button type="button" className={styles.secondaryButton} onClick={togglePause}>{phase === 'paused' ? '계속하기' : '일시정지'}</button>
            <button type="button" className={styles.primaryButton} onClick={retry}>다시 시작</button>
          </div>
        </section>
      </div>
    </main>
  );
}
