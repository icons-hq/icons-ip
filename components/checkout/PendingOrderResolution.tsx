import Link from 'next/link';

export function PendingOrderResolution() {
  return <span> <Link href="/orders?pending=1">진행 중인 주문 확인</Link>에서 결제를 이어가거나 해당 주문을 취소해주세요.</span>;
}
