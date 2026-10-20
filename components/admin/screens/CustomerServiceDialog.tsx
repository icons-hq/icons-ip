'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Native dialog keeps focus and Escape inside the selected record, even from a grid cell. */
export function CustomerServiceDialog({ title, children, onClose, busy = false, wide = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <dialog
    aria-labelledby={titleId}
    className={`admin-cs-dialog${wide ? ' admin-cs-dialog--wide' : ''}`}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    ref={ref}
  >
    <header className="admin-cs-dialog__header">
      <h2 id={titleId}>{title}</h2>
      <button aria-label="닫기" disabled={busy} onClick={onClose} type="button">×</button>
    </header>
    <div className="admin-cs-dialog__body">{children}</div>
  </dialog>;
}

export function InquiryPreviewDialog({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const router = useRouter();
  return <CustomerServiceDialog title="고객문의 상세 · 답변" onClose={() => router.replace(closeHref, { scroll: false })} wide>
    {children}
  </CustomerServiceDialog>;
}

/** 목록 안에서 답변을 펼칠 때는 배경을 잠그거나 모달 포커스 트랩을 만들지 않는다. */
export function CustomerServiceInlinePanel({ title, children, onClose, busy = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  return <section aria-labelledby={titleId} className="admin-cs-inline" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="admin-cs-inline__header"><h3 id={titleId} ref={heading} tabIndex={-1}>{title}</h3><button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={onClose}>답변 접기</button></header>
    <div className="admin-cs-inline__body">{children}</div>
  </section>;
}

export function InquiryPreviewWorkspace({ children, closeHref, selected = false }: { children?: ReactNode; closeHref: string; selected?: boolean }) {
  const router = useRouter();
  return <section className="admin-inquiry-preview" aria-label="고객문의 내용 · 판매자 답변">
    <header className="admin-inquiry-preview__header"><h2>고객문의 내용 · 판매자 답변</h2>{selected ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => router.replace(closeHref, { scroll: false })}>선택 닫기</button> : null}</header>
    {selected ? children : <p className="admin-inquiry-preview__empty">목록에서 문의 제목 또는 답변처리를 선택하면 문의 내용과 답변 영역을 함께 볼 수 있습니다.</p>}
  </section>;
}
