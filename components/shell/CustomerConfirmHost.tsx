'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { setCustomerConfirmHandler, type CustomerConfirmRequest } from '@/lib/customer-confirm';
import { OverlayPortal } from './OverlayPortal';
import { useOverlayA11y } from './useOverlayA11y';

interface PendingConfirm {
  request: CustomerConfirmRequest;
  resolve: (confirmed: boolean) => void;
  settled: boolean;
}

/*
 * 고객 화면 확인창 호스트(lib/customer-confirm.ts). 루트 레이아웃에 한 번만 둔다.
 * 확인 버튼은 약속을 한 번만 풀고(이중 탭·Enter 연타가 실행을 두 번 만들지 않는다), 취소·Esc·바깥 누르기는 모두 취소다.
 * 요청이 겹치면 순서대로 하나씩 보여 준다. 대화상자는 #root 밖 body 직계로 그린다(OverlayPortal — #root inert·z-index 캡핑).
 */
export function CustomerConfirmHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);
  const queue = useRef<PendingConfirm[]>([]);
  const active = useRef<PendingConfirm | null>(null);

  useEffect(() => {
    const unregister = setCustomerConfirmHandler((request) => new Promise<boolean>((resolve) => {
      const pending: PendingConfirm = { request, resolve, settled: false };
      if (active.current) queue.current.push(pending);
      else { active.current = pending; setCurrent(pending); }
    }));
    return () => {
      unregister();
      for (const pending of [active.current, ...queue.current]) {
        if (pending && !pending.settled) { pending.settled = true; pending.resolve(false); }
      }
      queue.current = [];
      active.current = null;
    };
  }, []);

  function settle(pending: PendingConfirm, result: boolean) {
    if (pending.settled) return;
    pending.settled = true;
    pending.resolve(result);
    if (active.current !== pending) return;
    const next = queue.current.shift() ?? null;
    active.current = next;
    setCurrent(next);
  }

  if (!current) return null;
  return (
    <OverlayPortal>
      <CustomerConfirmDialog
        key={`${current.request.title}\u0000${current.request.confirmLabel}`}
        request={current.request}
        onCancel={() => settle(current, false)}
        onConfirm={() => settle(current, true)}
      />
    </OverlayPortal>
  );
}

/**
 * 가운데 작은 확인 모달(담기 결과 모달과 같은 문법). 첫 포커스는 [돌아가기]다 — 실수로 Enter를 눌러도 아무 일도 일어나지 않는다.
 * 호출부(호스트)가 포털을 둔다 — renderToStaticMarkup 시험이 이 부품을 직접 그릴 수 있게.
 */
export function CustomerConfirmDialog({ request, onCancel, onConfirm }: {
  request: CustomerConfirmRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(), messageId = useId();
  const [done, setDone] = useState(false);
  useOverlayA11y({ open: true, onClose: onCancel, panelRef, initialFocusRef: cancelRef });
  return (
    <div className="wc-confirm" data-customer-confirm="" onClick={onCancel}>
      <div
        ref={panelRef}
        aria-describedby={request.message ? messageId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="wc-confirm__panel"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <h2 className="wc-confirm__title" id={titleId}>{request.title}</h2>
        {request.message ? <p className="wc-confirm__message" id={messageId}>{request.message}</p> : null}
        <div className="wc-btn-group wc-confirm__actions">
          <button ref={cancelRef} className="wc-btn" disabled={done} onClick={onCancel} type="button">{request.cancelLabel ?? '돌아가기'}</button>
          <button className="wc-btn primary" disabled={done} onClick={() => { setDone(true); onConfirm(); }} type="button">{request.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
