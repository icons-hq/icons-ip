'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ClaimPreviewBusy, ClaimPreviewBusyReporter, type ClaimPreviewBusyReport } from '@/components/orders/claim-preview-busy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';

/*
 * 목록 위 상세 팝업의 admin kit 판(R8 · ADR-0028). ClaimPreviewDialog와 같은 계약을 Base UI Dialog로 지킨다:
 * 처리 패널이 서버 액션을 기다리는 동안에는 닫히지 않고(닫으면 결과 문구가 사라진다), 닫으면 같은
 * 조건의 목록으로 스크롤을 유지한 채 돌아간다. 닫힌 뒤에는 팝업을 연 요청번호 링크로 포커스를 돌려준다.
 */
export function ClaimPreviewKitDialog({ children, closeHref, title }: {
  children: ReactNode;
  closeHref: string;
  title: string;
}) {
  const router = useRouter();
  /* 팝업은 트리거 없이 URL(`?claimId=`)로 열려, Base UI는 닫힌 뒤 포커스를 body에 둔다. 그래서 처음 그릴 때
     포커스가 있던 요소(누른 요청번호 링크)를 기억했다가, 팝업이 사라진 뒤에도 포커스가 갈 곳이 없으면 그리로
     돌려준다 — 기존 팝업(CustomerServiceDialog)과 같은 계약이다. 주소로 바로 열었다면 돌려줄 곳이 없다. */
  const [opener] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!opener) return;
      /* Base UI가 같은 커밋에서 포커스를 정리한 뒤에 본다. rAF는 백그라운드 탭에서 멈추므로 타이머를 쓴다. */
      window.setTimeout(() => {
        if (mounted.current) return; /* 개발 모드 StrictMode의 재마운트 — 팝업은 아직 열려 있다. */
        const active = document.activeElement;
        if (opener.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, [opener]);
  const [busySources, setBusySources] = useState<readonly string[]>([]);
  const report = useCallback<ClaimPreviewBusyReport>((source, busy) => {
    setBusySources((current) => {
      if (current.includes(source) === busy) return current;
      return busy ? [...current, source] : current.filter((value) => value !== source);
    });
  }, []);
  const busy = busySources.length > 0;

  return <ClaimPreviewBusyReporter.Provider value={report}>
    <ClaimPreviewBusy.Provider value={busy}>
      <Dialog
        disablePointerDismissal={busy}
        onOpenChange={(open) => { if (!open && !busy) router.replace(closeHref, { scroll: false }); }}
        open
      >
        <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-5xl" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </ClaimPreviewBusy.Provider>
  </ClaimPreviewBusyReporter.Provider>;
}
