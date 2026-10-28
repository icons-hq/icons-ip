'use client';

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { CustomerServiceDialog } from './CustomerServiceDialog';

/*
 * 취소·반품·교환 목록 위 상세 팝업(R8).
 *
 * 서버 페이지가 `?claimId=`로 상세를 읽고(상세 라우트와 같은 로더) 이 대화상자로 감싼다.
 * 처리 액션의 revalidatePath가 같은 목록 경로를 다시 그리므로, 팝업 안에서 처리하면 뒤의
 * 목록도 함께 갱신된다. 닫으면 같은 조건의 목록으로 돌아가고 스크롤은 그대로 둔다.
 */
export function ClaimPreviewDialog({ children, closeHref, title }: {
  children: ReactNode;
  closeHref: string;
  title: string;
}) {
  const router = useRouter();
  return <CustomerServiceDialog title={title} onClose={() => router.replace(closeHref, { scroll: false })} wide>
    {children}
  </CustomerServiceDialog>;
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
