'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import {
  LAST_BELL_PRODUCT_CATALOG,
  type LastBellCollectibleKey,
} from '@/lib/campaigns/aouad/last-bell-products';
import styles from './last-bell.module.css';

type LastBellInventoryPanelProps = {
  open: boolean;
  authority: 'local-qa' | 'verified-candidate';
  isAuthenticated: boolean;
  collected: readonly LastBellCollectibleKey[];
  pending: readonly LastBellCollectibleKey[];
  committed: readonly LastBellCollectibleKey[];
  unavailable: readonly LastBellCollectibleKey[];
  onClose: () => void;
};

export function LastBellInventoryPanel({
  open,
  authority,
  isAuthenticated,
  collected,
  pending,
  committed,
  unavailable,
  onClose,
}: LastBellInventoryPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  const collectedKeys = new Set(collected);
  const pendingKeys = new Set(pending);
  const committedKeys = new Set(committed);
  const unavailableKeys = new Set(unavailable);

  return (
    <section className={styles.inventoryOverlay} role="dialog" aria-modal="true" aria-labelledby="last-bell-inventory-title">
      <div className={styles.inventoryPanel}>
        <header className={styles.inventoryHeader}>
          <div><span>LAST BELL</span><h2 id="last-bell-inventory-title">수집 인벤토리</h2></div>
          <button ref={closeRef} type="button" onClick={onClose}>닫기 <kbd>Esc</kbd></button>
        </header>
        <p className={styles.inventoryNotice}>
          {authority === 'verified-candidate'
            ? '새 상품은 엔딩 또는 재플레이 챕터 출구에 도달한 뒤 계정 구매권으로 검증됩니다.'
            : '로컬 QA 인벤토리입니다. 이 기록은 구매권·재고·계정 기록을 만들지 않습니다.'}
        </p>
        <div className={styles.inventoryGrid}>
          {LAST_BELL_PRODUCT_CATALOG.map((item) => {
            const isCommitted = committedKeys.has(item.key);
            const isPending = pendingKeys.has(item.key);
            const isCollected = collectedKeys.has(item.key) || isPending || isCommitted;
            const status = isCommitted
              ? authority === 'verified-candidate'
                ? isAuthenticated
                  ? unavailableKeys.has(item.key) ? '판매 기간 종료' : '구매권 검증 완료'
                  : '게스트 기록 완료 · 로그인 저장 필요'
                : '로컬 수집 완료'
              : isPending ? '출구 도달 시 저장'
                : isCollected ? '이번 플레이에서 발견'
                  : '미발견';
            return (
              <article key={item.key} className={isCollected ? styles.inventoryItemFound : styles.inventoryItemHidden}>
                <div className={styles.inventoryItemImage}>
                  {isCollected ? <Image src={item.thumbnailPath} alt="" fill sizes="128px" /> : <span aria-hidden="true">?</span>}
                </div>
                <div><span>{item.chapterId === 'chapter-01' ? 'CH.1' : 'CH.2'} · {item.category}</span><b>{isCollected ? item.name : '발견하지 못한 상품'}</b><small>{status}</small></div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
