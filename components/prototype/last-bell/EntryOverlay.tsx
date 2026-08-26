'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import styles from './last-bell.module.css';

type EntryOverlayProps = {
  phase: EntryDirectorPhase;
  sceneReady: boolean;
  hasCheckpoint: boolean;
  checkpointAction?: ReactNode;
  settings: ReactNode;
  onStart: () => void;
  onSkip: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
};

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The entry shell deliberately exposes the actual Hyosan facade underneath.
 * It owns only safe gesture/focus handling; its entrance is not a raster card
 * and the classroom slider remains a distinct scene object.
 */
export function EntryOverlay({
  phase,
  sceneReady,
  hasCheckpoint,
  checkpointAction,
  settings,
  onStart,
  onSkip,
  onToggleSettings,
  settingsOpen,
}: EntryOverlayProps) {
  const isPreflight = phase === 'preflight';
  const isBrand = phase === 'brand';
  const isColdOpen = phase === 'cold-open';
  const isAperture = phase === 'aperture';
  const active = isPreflight || isBrand || isColdOpen || isAperture;
  const overlayRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, phase, sceneReady, settingsOpen]);

  const trapEntryTab = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = currentIndex < 0 ? 0 : event.shiftKey
      ? (currentIndex === 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };

  if (!active) return null;

  return (
    <section
      ref={overlayRef}
      className={`${styles.entryOverlay} ${styles[`entryPhase${phase.replace(/(^|-)([a-z])/g, (_, __, letter) => letter.toUpperCase())}`]}`}
      aria-label="효산고 Chapter 1 시작"
      aria-modal="true"
      data-entry-focus-trap="true"
      role="dialog"
      tabIndex={-1}
      onKeyDown={trapEntryTab}
    >
      {(isPreflight || isBrand) && <div className={styles.entryBlackout} aria-hidden="true" />}
      {(isPreflight || isBrand) && <div className={styles.entryFluorescent} aria-hidden="true" />}
      {isPreflight && (
        <div className={styles.entryPreflight}>
          <span className={styles.entrySchoolStrip}>효산고등학교</span>
          <span className={styles.entrySerial}>HYOSAN HIGH · POST-STRIKE NIGHT</span>
          <p>{sceneReady ? '깨진 유리 너머, 파괴된 효산고로 들어간다.' : '파괴된 효산고 입구를 준비하고 있다.'}</p>
          <button
            type="button"
            className={styles.entryStartButton}
            onClick={onStart}
          >
            {sceneReady ? '입장' : '입장 예약'}
          </button>
          <button
            type="button"
            className={styles.entrySettingsButton}
            onClick={onToggleSettings}
            aria-expanded={settingsOpen}
          >
            화면 설정
          </button>
          {settingsOpen && <div className={styles.entrySettings}>{settings}</div>}
          {hasCheckpoint && <div className={styles.entryCheckpoint}>{checkpointAction}</div>}
        </div>
      )}
      {isBrand && (
        <div className={styles.entryBrand}>
          <span className={styles.entrySchoolStrip}>효산고등학교</span>
          <span className={styles.entryBrandRule} aria-hidden="true" />
          <span className={styles.entrySerial}>POST-STRIKE NIGHT · LAST BELL</span>
          <button type="button" className={styles.entrySkipButton} onClick={onSkip}>건너뛰기</button>
        </div>
      )}
      {isColdOpen && (
        <div className={styles.entryColdOpen}>
          <span>폭격 후, 효산고의 밤.</span>
          <button type="button" className={styles.entrySkipButton} onClick={onSkip}>건너뛰기</button>
        </div>
      )}
      {isAperture && <div className={styles.entryAperture} aria-hidden="true" />}
    </section>
  );
}
