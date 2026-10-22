'use client';

import { useId, useRef, useState } from 'react';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';

/*
 * 굿즈 공유 (PD-07 · 11 §6 B12 · ADR-0011 T-A).
 *
 * 위시 하트 옆 36×36 원형 버튼 → 공유 다이얼로그. 링크 복사(클립보드)가 기본이고, 기기가
 * 지원하면 기기 공유 시트(navigator.share)를 함께 둔다. SNS SDK(카카오 등)는 들이지 않는다(11 §9).
 * 복사 결과는 보이는 문구이자 live region 이다 — 성공·실패 모두 보조기기에 알린다.
 */

/** 공유할 굿즈 주소. 리뷰·Q&A 페이지 같은 화면 상태는 떼고, 고른 옵션(?variant=)만 남긴다. */
export function pdpShareUrl(href: string): string {
  const url = new URL(href);
  const variant = url.searchParams.get('variant');
  url.search = variant ? `?${new URLSearchParams({ variant }).toString()}` : '';
  url.hash = '';
  return url.toString();
}

const SHARE_COPIED = '링크를 복사했어요.';
const SHARE_COPY_FAILED = '자동으로 복사하지 못했어요. 선택된 주소를 직접 복사해주세요.';
const SHARE_FAILED = '공유 창을 열지 못했어요. 링크 복사를 이용해주세요.';

function ShareGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <circle cx="17.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6.5" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m8.7 10.7 6.6-3.9M8.7 13.3l6.6 3.9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function GoodShareDialog({
  canNativeShare,
  goodName,
  onClose,
  url,
}: {
  canNativeShare: boolean;
  goodName: string;
  onClose: () => void;
  url: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const [status, setStatus] = useState('');
  useOverlayA11y({ open: true, onClose, panelRef, initialFocusRef: copyRef });

  const copy = async () => {
    setStatus('');
    try {
      await navigator.clipboard.writeText(url);
      setStatus(SHARE_COPIED);
    } catch {
      /* 클립보드 권한이 없거나 보안 컨텍스트가 아니면 주소를 선택해 두고 직접 복사하게 한다. */
      fieldRef.current?.select();
      setStatus(SHARE_COPY_FAILED);
    }
  };

  const share = async () => {
    setStatus('');
    try {
      await navigator.share({ title: goodName, url });
    } catch (error) {
      /* 사용자가 공유 시트를 닫은 것은 실패가 아니다. */
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(SHARE_FAILED);
    }
  };

  return (
    <div className="wc-share-dialog" onClick={onClose}>
      <div
        ref={panelRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="wc-share-dialog__panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="wc-share-dialog__title" id={titleId}>공유하기</h2>
        <label className="wc-share-dialog__field" htmlFor={fieldId}>
          <span className="wc-sr-only">{goodName} 링크</span>
          <input ref={fieldRef} id={fieldId} onFocus={(event) => event.currentTarget.select()} readOnly type="url" value={url} />
        </label>
        <div className="wc-btn-group wc-share-dialog__actions">
          <button ref={copyRef} className="wc-btn primary" onClick={() => void copy()} type="button">링크 복사</button>
          {canNativeShare ? <button className="wc-btn" onClick={() => void share()} type="button">다른 앱으로 공유</button> : null}
        </div>
        <p aria-atomic="true" aria-live="polite" className="wc-share-dialog__status" role="status">{status}</p>
        <button className="wc-share-dialog__close" onClick={onClose} type="button">닫기</button>
      </div>
    </div>
  );
}

export function GoodShareButton({ disabled, goodName }: { disabled?: boolean; goodName: string }) {
  const [dialog, setDialog] = useState<{ url: string; canNativeShare: boolean } | null>(null);

  return (
    <>
      <button
        aria-expanded={dialog !== null}
        aria-haspopup="dialog"
        aria-label="공유하기"
        className="wc-pdp-share"
        disabled={disabled}
        onClick={() => setDialog({
          /* 주소·기기 능력은 누른 시점에 읽는다 — 옵션을 바꾼 뒤 공유하면 그 옵션 주소가 간다. */
          url: pdpShareUrl(window.location.href),
          canNativeShare: typeof navigator.share === 'function',
        })}
        type="button"
      >
        <ShareGlyph />
      </button>
      {dialog ? (
        <OverlayPortal>
          <GoodShareDialog canNativeShare={dialog.canNativeShare} goodName={goodName} onClose={() => setDialog(null)} url={dialog.url} />
        </OverlayPortal>
      ) : null}
    </>
  );
}
