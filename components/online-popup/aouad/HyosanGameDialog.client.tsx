'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PresentationDialog from './source/components/aouad/PresentationDialog';
import styles from './HyosanGameDialog.module.css';

export const HYOSAN_GAME_SRC = '/ip-popups/aouad/hyosan/index.html';

const LOAD_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;
type LoadStatus = 'loading' | 'loaded' | 'failed';

function hasGameRendererMarker(frame: HTMLIFrameElement | null) {
  try {
    return Boolean(frame?.contentDocument?.querySelector('[data-hyosan-renderer="three"]'));
  } catch {
    return false;
  }
}

export function HyosanGameDialog({ onClose }: { onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const keyboardCleanupRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const clearPendingChecks = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    timeoutRef.current = null;
    pollRef.current = null;
  }, []);

  const detachKeyboardBridge = useCallback(() => {
    keyboardCleanupRef.current?.();
    keyboardCleanupRef.current = null;
  }, []);

  useEffect(() => {
    clearPendingChecks();
    timeoutRef.current = window.setTimeout(() => {
      clearPendingChecks();
      setStatus('failed');
    }, LOAD_TIMEOUT_MS);
    return () => {
      clearPendingChecks();
      detachKeyboardBridge();
    };
  }, [attempt, clearPendingChecks, detachKeyboardBridge]);

  const handleLoad = useCallback(() => {
    detachKeyboardBridge();
    let frameDocument: Document | null = null;
    try { frameDocument = frameRef.current?.contentDocument ?? null; } catch { /* Failed document load. */ }
    if (frameDocument) {
      const gameDocument = frameDocument;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || event.ctrlKey || event.metaKey) return;
        const active = gameDocument.activeElement;
        const menu = active?.closest('[role="dialog"][aria-modal="true"]');
        const returnButton = returnButtonRef.current;
        if (!menu || !returnButton) return;
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const boundary = event.shiftKey ? buttons[0] : buttons.at(-1);
        if (active !== boundary && active !== menu) return;
        // Extend the game's menu focus loop to the host dialog's return action.
        // Capture runs before the original menu's React Tab handler; Escape stays in the game.
        event.preventDefault();
        event.stopPropagation();
        returnButton.focus();
      };
      gameDocument.addEventListener('keydown', onKeyDown, true);
      keyboardCleanupRef.current = () => gameDocument.removeEventListener('keydown', onKeyDown, true);
    }

    // Document load is not enough: wait for the app root, including its recovery UI.
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    const check = () => {
      if (!hasGameRendererMarker(frameRef.current)) return false;
      clearPendingChecks();
      setStatus('loaded');
      return true;
    };
    if (!check()) pollRef.current = window.setInterval(check, READY_POLL_MS);
  }, [clearPendingChecks, detachKeyboardBridge]);

  const handleError = useCallback(() => {
    clearPendingChecks();
    setStatus('failed');
  }, [clearPendingChecks]);

  const retry = useCallback(() => {
    clearPendingChecks();
    setStatus('loading');
    setAttempt((value) => value + 1);
  }, [clearPendingChecks]);

  return (
    <PresentationDialog className={styles.dialog} label="효산의 기억 게임" onClose={onClose}>
      <div className={styles.shell} data-hyosan-game-status={status}>
        <header className={styles.topbar}>
          <div className={styles.heading}>
            <span>HYOSAN MEMORIES / 3D SURVIVAL</span>
            <h1>효산의 기억</h1>
          </div>
          <button ref={returnButtonRef} autoFocus className={styles.returnButton} onClick={onClose} type="button">
            팝업으로 돌아가기
          </button>
        </header>
        <div className={styles.viewport}>
          <iframe
            key={attempt}
            ref={frameRef}
            allow="autoplay; fullscreen"
            className={styles.frame}
            src={HYOSAN_GAME_SRC}
            title="효산의 기억"
            onError={handleError}
            onLoad={handleLoad}
          />
          {status !== 'loaded' && (
            <div className={styles.status} role={status === 'failed' ? 'alert' : 'status'} aria-live="polite">
              {status === 'loading' ? (
                <>
                  <strong>효산의 기억을 준비하고 있습니다</strong>
                  <p>게임 화면이 열리면 화면 안의 시작 버튼을 눌러주세요.</p>
                </>
              ) : (
                <>
                  <strong>게임 화면을 불러오지 못했습니다</strong>
                  <p>잠시 후 다시 시도해주세요.</p>
                  <button className={styles.retryButton} onClick={retry} type="button">다시 시도</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </PresentationDialog>
  );
}
