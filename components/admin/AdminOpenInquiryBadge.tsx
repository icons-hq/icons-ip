import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, MessageSquareWarning } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/**
 * 고객문의 목록·상세 상단의 미답변 문의 배지(#253, 10/27 회의 D1①).
 *
 * 0건이면 아무것도 그리지 않는다. 상태별 카운트 칩과 달리 이 배지는 "지금 처리할
 * 일이 있다"는 신호라서, 0을 상시 노출하면 신호가 배경이 된다 — 배지는 며칠 뒤부터
 * 보이지 않게 된다.
 *
 * 셸 공통 영역에 두지 않는다. 상품 등록·주문 화면에서까지 보이면 업무를 가리고, 셸
 * layout은 소프트 이동 때 다시 렌더되지 않아 수가 낡는다. 집계는 고객문의 페이지가
 * 목록을 읽을 때 함께 받은 `counts.open`을 넘긴다(추가 조회 없음).
 */
export function AdminOpenInquiryBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  /* 셸 본문이 덩어리 사이 간격을 맡는다 — 여기서 여백을 더 주면 혼자 떨어져 보인다. 문의 상세는 제목을 밀어내지 않게 머리 줄 오른쪽에 넘겨 그린다. */
  return (
    <div className="flex flex-wrap gap-2" data-open-inquiry-badge="">
      <AdminPendingCountLink count={count} href="/admin/cs/inquiries?status=open&page=1"><span>미답변 1:1 문의</span></AdminPendingCountLink>
    </div>
  );
}

/** 지금 처리할 건수로 가는 링크(주의색 + 화살표로 눌러지는 것을 보인다). 건수 강조는 링크가 맡는다(span·strong은 맨 요소). */
export function AdminPendingCountLink({ count, href, children }: { count: number; href: string; children: ReactNode }) {
  return (
    <Link className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-fit border-warning-border bg-warning-soft hover:bg-warning/15 [&>strong]:font-semibold [&>strong]:text-warning [&>strong]:tabular-nums')} data-slot="button" href={href}>
      <MessageSquareWarning aria-hidden="true" className="text-warning" />
      {children}
      <strong>{count.toLocaleString('ko-KR')}건</strong>
      <ChevronRight aria-hidden="true" className="text-warning" />
    </Link>
  );
}
