'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import {
  LAST_BELL_POPUP_PATH,
  LAST_BELL_VERIFIED_STORE_PATH,
} from '@/lib/campaigns/aouad/game-entry';
import { LAST_BELL_ROOFTOP_ENDING_KO, rooftopEndingState } from '@/lib/prototypes/last-bell/narrative';
import type { LastBellRooftopPhase } from '@/lib/prototypes/last-bell/runtime/types';
import styles from './last-bell.module.css';

type RooftopEndingOverlayProps = {
  phase: LastBellRooftopPhase;
  /** Fixed-step phase clock supplied by the simulation, never wall-clock UI time. */
  phaseElapsedSeconds: number;
  /** Inventory, pause, and WebGL loss suspend both the simulation and ending audio. */
  suspended: boolean;
  gameComplete: boolean;
  authority: 'local-qa' | 'verified-candidate';
  isAuthenticated: boolean;
  runReady: boolean;
  syncFailed: boolean;
  claimHref?: string;
  onOpenInventory: () => void;
  onReplayChapter: (chapterId: 'chapter-01' | 'chapter-02') => void;
  onRetrySync: () => void;
};

export function RooftopEndingOverlay({
  phase,
  phaseElapsedSeconds,
  suspended,
  gameComplete,
  authority,
  isAuthenticated,
  runReady,
  syncFailed,
  claimHref,
  onOpenInventory,
  onReplayChapter,
  onRetrySync,
}: RooftopEndingOverlayProps) {
  const ending = rooftopEndingState(phase, phaseElapsedSeconds, suspended);
  const resultReady = phase === 'black' && gameComplete;
  const storeHref = authority === 'verified-candidate'
    ? LAST_BELL_VERIFIED_STORE_PATH
    : `${LAST_BELL_POPUP_PATH}/store`;

  useEffect(() => {
    if (!ending.playHeartbeat) return undefined;
    const heartbeat = new Audio(LAST_BELL_ROOFTOP_ENDING_KO.audio.heartbeat);
    heartbeat.loop = true;
    heartbeat.volume = phase === 'recognition' ? .2 : .32;
    heartbeat.playbackRate = phase === 'recognition' ? .78 : .92;
    void heartbeat.play().catch(() => undefined);
    return () => {
      heartbeat.pause();
      heartbeat.currentTime = 0;
    };
  }, [ending.playHeartbeat, phase]);

  useEffect(() => {
    if (!ending.playBlackFootsteps) return undefined;
    const footsteps = new Audio(LAST_BELL_ROOFTOP_ENDING_KO.audio.groupFootsteps);
    footsteps.volume = .34;
    void footsteps.play().catch(() => undefined);
    return () => {
      footsteps.pause();
      footsteps.currentTime = 0;
    };
  }, [ending.playBlackFootsteps]);

  if (phase === 'sealed' || phase === 'approach') return null;

  if (phase === 'black') {
    return (
      <section className={styles.endingBlack} aria-live="polite">
        {ending.phaseElapsedMs >= LAST_BELL_ROOFTOP_ENDING_KO.timingMs.blackDoorPresence && !resultReady ? <p>옥상 문 너머 · 여러 사람의 발소리</p> : null}
        {resultReady ? (
          <div className={styles.endingResult}>
            <span>ALL OF US ARE DEAD: LAST BELL</span>
            <h2>기록되지 않은 생존자의 마지막 밤</h2>
            <p>몇 초 뒤, 원작 시즌 1의 마지막 재회 장면이 시작됩니다.</p>
            {runReady ? (
              <div className={styles.endingActions}>
                <button type="button" onClick={onOpenInventory}>수집 인벤토리 확인</button>
                {authority === 'verified-candidate' && !isAuthenticated
                  ? <Link href={claimHref ?? `/login?next=${encodeURIComponent(storeHref)}`}>로그인하고 구매권 저장</Link>
                  : <Link href={storeHref}>보급소로 돌아가기</Link>}
                <button type="button" onClick={() => onReplayChapter('chapter-01')}>Chapter 1 다시 수색</button>
                <button type="button" onClick={() => onReplayChapter('chapter-02')}>Chapter 2 다시 수색</button>
              </div>
            ) : syncFailed ? (
              <div className={styles.endingActions}>
                <p role="alert">완주 기록을 서버에 저장하지 못했습니다. 동일한 이벤트 식별자로 안전하게 다시 시도합니다.</p>
                <button type="button" onClick={onRetrySync}>검증 다시 시도</button>
              </div>
            ) : <p role="status">완주 기록과 수집품을 서버에서 검증하고 있습니다…</p>}
            {runReady && authority === 'verified-candidate' && !isAuthenticated ? <small>게스트 쿠키가 사라지면 수집 기록을 복구할 수 없습니다.</small> : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`${styles.endingCinematic} ${phase === 'subdue' ? styles.endingImpact : ''} ${ending.involuntaryStepVisible ? styles.endingInvoluntaryStep : ''}`} aria-live="polite">
      {ending.pulseVisible ? <div className={styles.endingPulse} aria-hidden="true" /> : null}
      <div className={styles.endingDialogue}>
        {ending.line01Visible ? <p><span>남라</span>{LAST_BELL_ROOFTOP_ENDING_KO.lines.namraLine01}</p> : null}
        {ending.line02Visible ? <p><span>남라</span>{LAST_BELL_ROOFTOP_ENDING_KO.lines.namraLine02}</p> : null}
      </div>
      {phase === 'subdue' ? <div className={styles.endingShock} aria-hidden="true" /> : null}
    </section>
  );
}
