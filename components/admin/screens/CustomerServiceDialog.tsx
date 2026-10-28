'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  /** 정리 단계에서 우리가 직접 닫는 중. 그 close 이벤트는 브라우저가 닫은 것이 아니라 맞출 상태가 없다. */
  const closingRef = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    closingRef.current = false;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      closingRef.current = true;
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <dialog
    aria-labelledby={titleId}
    className={`admin-cs-dialog${wide ? ' admin-cs-dialog--wide' : ''}`}
    onCancel={(event) => {
      /* React는 버블링하지 않는 native cancel도 컴포넌트 트리로 전달한다. 안쪽 dialog(답변 템플릿 등)의
         Esc가 바깥 팝업까지 닫지 않게 자기 dialog의 cancel만 처리한다. */
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      /* Chrome close watcher는 사용자 활성화 없이 다시 누른 Esc의 cancel을 취소할 수 없게 보낸다. 그때는
         dialog가 그대로 닫히므로 뒤따르는 close에서 상태를 맞춘다(여기서도 닫으면 onClose가 두 번 불린다). */
      if (event.cancelable === false) return;
      if (!busy) onClose();
    }}
    onClose={(event) => {
      /* 브라우저가 dialog를 직접 닫은 경우(close watcher·Android 뒤로 가기 등). 열림 상태가 React에만 남으면
         화면에서는 사라졌는데 같은 버튼으로 다시 열 수 없다. 안쪽 dialog의 close, 다시 열린 dialog
         (StrictMode 재마운트), 언마운트 정리로 닫힌 dialog는 맞출 상태가 없다. */
      if (event.target !== event.currentTarget || closingRef.current) return;
      const dialog = event.currentTarget;
      if (dialog.open || !dialog.isConnected) return;
      if (busy) {
        /* 처리 중에는 닫지 않는다. 다시 열어 서버 처리 결과(실패 사유·다음 할 일)를 볼 수 있게 한다. */
        try { dialog.showModal(); } catch { /* 문서에서 빠지는 중이면 언마운트 정리가 상태를 맞춘다. */ }
        return;
      }
      onClose();
    }}
    ref={ref}
  >
    <header className="admin-cs-dialog__header">
      <h2 id={titleId}>{title}</h2>
      <button aria-label="닫기" disabled={busy} onClick={onClose} type="button">×</button>
    </header>
    <div className="admin-cs-dialog__body">{children}</div>
  </dialog>;
}

/*
 * 고객문의 목록 위 팝업(R4)의 대기(busy) 신호. 팝업 안 패널(답변 발송·종결·담당자 변경·내부 메모 저장)이 서버 액션을
 * 기다리는 동안 팝업을 닫지 못하게 알린다. 닫으면 router.replace가 Next 액션 큐의 대기 중인 액션 상태를 버리고 패널이
 * 사라져, 서버에서 끝난 처리의 결과(다른 운영자 답변 충돌 등 실패 사유)를 보지 못하고 성공해도 보낸 답변이 복구 초안으로
 * 남는다. 클레임 팝업(claim-preview-busy)과 같은 방식이고, 쓰는 패널이 모두 어드민 화면이라 이 어드민 모듈에 둔다.
 */
type InquiryPreviewBusyReport = (source: string, busy: boolean) => void;
const InquiryPreviewBusyReporter = createContext<InquiryPreviewBusyReport | null>(null);
const InquiryPreviewBusy = createContext(false);

/** 팝업 안 패널이 서버 액션을 기다리는 동안(busy) 팝업을 닫지 못하게 알린다. 팝업 밖(독립 상세 라우트)에서는 아무 일도 하지 않는다. */
export function useInquiryPreviewBusy(busy: boolean) {
  const report = useContext(InquiryPreviewBusyReporter);
  const source = useId();
  useEffect(() => {
    if (!report || !busy) return;
    report(source, true);
    return () => report(source, false);
  }, [busy, report, source]);
}

export function InquiryPreviewDialog({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const router = useRouter();
  const [busySources, setBusySources] = useState<readonly string[]>([]);
  const report = useCallback<InquiryPreviewBusyReport>((source, busy) => {
    setBusySources((current) => {
      if (current.includes(source) === busy) return current;
      return busy ? [...current, source] : current.filter((value) => value !== source);
    });
  }, []);
  const busy = busySources.length > 0;
  return <InquiryPreviewBusyReporter.Provider value={report}>
    <InquiryPreviewBusy.Provider value={busy}>
      <CustomerServiceDialog busy={busy} title="고객문의 상세 · 답변" onClose={() => { if (!busy) router.replace(closeHref, { scroll: false }); }} wide>
        {children}
      </CustomerServiceDialog>
    </InquiryPreviewBusy.Provider>
  </InquiryPreviewBusyReporter.Provider>;
}

/**
 * 팝업 안 '← 문의 목록'. ×·Esc처럼 목록 스크롤을 두고 기록을 바꿔 쓰며 닫는다. 패널이 기다리는 동안에는 누를 수 없다
 * (이동도 대기 중인 액션 상태를 버린다).
 */
export function InquiryPreviewBackLink({ href }: { href: string }) {
  const busy = useContext(InquiryPreviewBusy);
  return busy
    ? <span aria-disabled="true" className="mono muted" style={{ fontSize: 12 }}>← 문의 목록</span>
    : <Link className="mono" href={href} replace scroll={false} style={{ fontSize: 12 }}>← 문의 목록</Link>;
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
