'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { ClaimPreviewBusy, ClaimPreviewBusyReporter, type ClaimPreviewBusyReport } from '@/components/orders/claim-preview-busy';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/admin/kit/ui/dialog';

/*
 * 목록 위 상세 팝업의 admin kit 판(R8 · PoC). ClaimPreviewDialog와 같은 계약을 Base UI Dialog로 지킨다:
 * 처리 패널이 서버 액션을 기다리는 동안에는 닫히지 않고(닫으면 결과 문구가 사라진다), 닫으면 같은
 * 조건의 목록으로 스크롤을 유지한 채 돌아간다.
 */
export function ClaimPreviewKitDialog({ children, closeHref, title }: {
  children: ReactNode;
  closeHref: string;
  title: string;
}) {
  const router = useRouter();
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
