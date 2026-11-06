import Link from 'next/link';
import { MessageSquareWarning } from 'lucide-react';
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

  /* 화면 본문(.rise) 바로 위에 선다 — 아래 화면과 간격을 스스로 둔다. 건수 강조는 링크가 맡는다(span·strong은 맨 요소). */
  return (
    <div className="mb-4 flex flex-wrap gap-2" data-open-inquiry-badge="">
      <Link className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'border-[color-mix(in_oklab,var(--wc-warning)_45%,transparent)] [&>strong]:font-semibold [&>strong]:text-[var(--wc-warning)] [&>strong]:tabular-nums')} data-slot="button" href="/admin/cs/inquiries?status=open&page=1">
        <MessageSquareWarning aria-hidden="true" className="text-[var(--wc-warning)]" />
        <span>미답변 1:1 문의</span>
        <strong>{count.toLocaleString('ko-KR')}건</strong>
      </Link>
    </div>
  );
}
