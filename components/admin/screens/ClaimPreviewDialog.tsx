'use client';

import Link, { useLinkStatus } from 'next/link';
import { useContext, type ReactNode } from 'react';
import { ClaimPreviewBusy, useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';

/*
 * 취소·반품·교환 목록 위 상세 팝업(R8)의 링크 부품. 팝업 자체는 ClaimPreviewKitDialog(kit Dialog)다.
 *
 * 서버 페이지가 `?claimId=`로 상세를 읽고(상세 라우트와 같은 로더) 팝업으로 감싼다. 처리 액션의
 * revalidatePath가 같은 목록 경로를 다시 그리므로, 팝업 안에서 처리하면 뒤의 목록도 함께 갱신된다.
 *
 * 안의 처리 패널이 서버 액션(결제사 취소·환불 완료 확정·유형 전환)을 기다리는 동안에는 팝업을 벗어나지
 * 못한다. 닫거나 이동하면 Next 액션 큐가 대기 중인 액션 상태를 버리고 패널이 사라져, 서버에서 끝난 처리의
 * 결과 문구(실패 코드·다음 할 일)를 운영자가 보지 못한다.
 */

/** 처리 패널은 중립 모듈의 훅을 직접 불러도 된다. 기존 import 경로를 위해 다시 내보낸다. */
export { useClaimPreviewBusy };

const FULL_SCREEN_CLASS = cn(buttonVariants({ size: 'sm', variant: 'outline' }));

/** 팝업의 '전체 화면으로 열기'. 처리 패널이 기다리는 동안에는 누를 수 없다(이동도 대기 중인 액션 상태를 버린다). */
export function ClaimPreviewFullScreenLink({ href }: { href: string }) {
  const busy = useContext(ClaimPreviewBusy);
  return busy
    ? <button className={FULL_SCREEN_CLASS} data-slot="button" disabled type="button">전체 화면으로 열기</button>
    : <Link className={FULL_SCREEN_CLASS} data-slot="button" href={href}>전체 화면으로 열기</Link>;
}

/** 링크를 누른 순간부터 팝업이 열릴 때까지 '여는 중'을 보인다. 자리는 늘 차지해 줄이 흔들리지 않는다. */
function ClaimPreviewPendingHint() {
  const { pending } = useLinkStatus();
  return <span
    aria-hidden="true"
    className="text-[11px] font-normal text-muted-foreground opacity-0 transition-opacity data-[pending=true]:opacity-100 motion-reduce:transition-none"
    data-pending={pending ? 'true' : undefined}
  >여는 중</span>;
}

/**
 * 요청번호 링크. 목록 스크롤을 유지하고, 행마다 상세를 미리 읽지 않는다(prefetch=false) —
 * 한 페이지 20건의 상세를 미리 불러오면 그만큼 상세 조회가 돈다.
 */
export function ClaimPreviewLink({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return <Link
    aria-label={label}
    className="inline-flex items-baseline gap-1.5 font-semibold text-foreground no-underline underline-offset-4 hover:underline"
    data-claim-preview-link=""
    href={href}
    prefetch={false}
    scroll={false}
  >
    {children}<ClaimPreviewPendingHint />
  </Link>;
}
