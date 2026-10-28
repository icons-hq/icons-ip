'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/* 상세 팝업은 서버가 `?inquiryId=`로 문의·연결 주문을 읽은 뒤에 열린다. 그 사이 클릭이 먹혔는지
   알 수 없으면 '무반응'으로 보인다(R4) — 누른 직후부터 이동이 끝날 때까지 '여는 중'을 알린다.
   알림 자리는 항상 그려 두고 내용만 바꾼다(레이아웃 흔들림 방지, Next 16 useLinkStatus 권고). */
function OpeningHint() {
  const { pending } = useLinkStatus();
  return <span className="admin-cs-open__pending" aria-live="polite" data-pending={pending ? 'true' : undefined}>{pending ? '여는 중' : ''}</span>;
}

export function InquiryPreviewLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <Link className={className} href={href} scroll={false}>{children}<OpeningHint /></Link>;
}
