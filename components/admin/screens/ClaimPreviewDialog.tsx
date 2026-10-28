'use client';

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { CustomerServiceDialog } from './CustomerServiceDialog';

/*
 * 취소·반품·교환 목록 위 상세 팝업(R8).
 *
 * 서버 페이지가 `?claimId=`로 상세를 읽고(상세 라우트와 같은 로더) 이 대화상자로 감싼다.
 * 처리 액션의 revalidatePath가 같은 목록 경로를 다시 그리므로, 팝업 안에서 처리하면 뒤의
 * 목록도 함께 갱신된다. 닫으면 같은 조건의 목록으로 돌아가고 스크롤은 그대로 둔다.
 *
 * 안의 처리 패널이 서버 액션(결제사 취소·환불 완료 확정·유형 전환)을 기다리는 동안에는 닫지
 * 못한다. 닫으면 router.replace가 Next 액션 큐의 대기 중인 액션 상태를 버리고 패널이 사라져,
 * 서버에서 끝난 처리의 결과 문구(실패 코드·다음 할 일)를 운영자가 보지 못한다.
 */
type BusyReporter = (source: string, busy: boolean) => void;
const ClaimPreviewBusyReporter = createContext<BusyReporter | null>(null);
const ClaimPreviewBusy = createContext(false);

export function ClaimPreviewDialog({ children, closeHref, title }: {
  children: ReactNode;
  closeHref: string;
  title: string;
}) {
  const router = useRouter();
  const [busySources, setBusySources] = useState<readonly string[]>([]);
  const report = useCallback<BusyReporter>((source, busy) => {
    setBusySources((current) => {
      if (current.includes(source) === busy) return current;
      return busy ? [...current, source] : current.filter((value) => value !== source);
    });
  }, []);
  const busy = busySources.length > 0;
  return <ClaimPreviewBusyReporter.Provider value={report}>
    <ClaimPreviewBusy.Provider value={busy}>
      <CustomerServiceDialog busy={busy} title={title} onClose={() => { if (!busy) router.replace(closeHref, { scroll: false }); }} wide>
        {children}
      </CustomerServiceDialog>
    </ClaimPreviewBusy.Provider>
  </ClaimPreviewBusyReporter.Provider>;
}

/**
 * 팝업 안 처리 패널이 서버 액션을 기다리는 동안(busy) 팝업을 닫지 못하게 알린다. 팝업 밖(독립
 * 상세 라우트)에서는 아무 일도 하지 않는다.
 */
export function useClaimPreviewBusy(busy: boolean) {
  const report = useContext(ClaimPreviewBusyReporter);
  const source = useId();
  useEffect(() => {
    if (!report || !busy) return;
    report(source, true);
    return () => report(source, false);
  }, [busy, report, source]);
}

/** 팝업의 '전체 화면으로 열기'. 처리 패널이 기다리는 동안에는 누를 수 없다(이동도 대기 중인 액션 상태를 버린다). */
export function ClaimPreviewFullScreenLink({ href }: { href: string }) {
  const busy = useContext(ClaimPreviewBusy);
  return busy
    ? <button className="btn btn-sm btn-ghost" disabled type="button">전체 화면으로 열기</button>
    : <Link className="btn btn-sm btn-ghost" href={href}>전체 화면으로 열기</Link>;
}

/** 링크를 누른 순간부터 팝업이 열릴 때까지 '여는 중'을 보인다. 자리는 늘 차지해 줄이 흔들리지 않는다. */
function ClaimPreviewPendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className="admin-claim-preview-hint" data-pending={pending ? 'true' : undefined}>여는 중</span>;
}

/**
 * 요청번호 링크. 목록 스크롤을 유지하고, 행마다 상세를 미리 읽지 않는다(prefetch=false) —
 * 한 페이지 20건의 상세를 미리 불러오면 그만큼 상세 조회가 돈다.
 */
export function ClaimPreviewLink({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return <Link aria-label={label} className="admin-console-grid-link admin-claim-preview-link" href={href} prefetch={false} scroll={false}>
    {children}<ClaimPreviewPendingHint />
  </Link>;
}
