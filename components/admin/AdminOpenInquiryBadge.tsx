import Link from 'next/link';

/**
 * 셸 상단의 미답변 문의 배지(#253).
 *
 * 0건이면 아무것도 그리지 않는다. 상태별 카운트 칩과 달리 이 배지는 "지금 처리할
 * 일이 있다"는 신호라서, 0을 상시 노출하면 신호가 배경이 된다 — 배지는 며칠 뒤부터
 * 보이지 않게 된다.
 *
 * 집계는 layout이 넘긴다. 셸이 직접 DB를 읽으면 어드민의 모든 화면이 이 조회 하나에
 * 묶여, 문의와 무관한 화면까지 집계 실패로 함께 넘어진다.
 */
export function AdminOpenInquiryBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <div className="admin-shell-badges">
      <Link className="admin-shell-badge" href="/admin/cs/inquiries?status=open&page=1">
        <span>미답변 1:1 문의</span>
        <strong>{count.toLocaleString('ko-KR')}건</strong>
      </Link>
    </div>
  );
}
