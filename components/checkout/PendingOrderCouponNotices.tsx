import Link from 'next/link';
import { couponHeldByReplaceableOrder, type UserCouponSummary } from '@/lib/coupons';

/*
 * 진행 중인(결제 대기) 주문이 잡은 쿠폰 안내(ADR-0030 '새 주문은 출처 무관 이전 미결제 점유 닫기', QA1 S-D2-08).
 *
 * 그 쿠폰은 고를 수 있다 — 견적은 그 주문이 닫힌 것으로 계산하고, 주문을 접수하는 순간 DB가 그 주문을 결제 없이 닫고 쿠폰을
 * 새 주문에 쓴다(한 트랜잭션). 쿠폰을 고르거나 장바구니를 열기만 해서는 그 주문을 닫지 않는다. 그래서 고객이 무엇이 닫히는지
 * 알고 고르도록 쿠폰마다 사실과 그 주문으로 가는 길을 보인다.
 */
export function PendingOrderCouponNotices({ coupons, surface }: { coupons: readonly UserCouponSummary[]; surface: 'cart' | 'checkout' }) {
  const held = coupons.filter(couponHeldByReplaceableOrder);
  if (!held.length) return null;
  return (
    <>
      {held.map((coupon) => (
        <p className="wc-cart__coupon-pending" key={coupon.id}>
          ‘{coupon.coupon.name}’ 쿠폰은 진행 중인 주문에서 사용 중이에요.{' '}
          {surface === 'cart'
            ? '이 쿠폰으로 주문하면 그 주문은 결제 없이 닫히고 쿠폰을 새 주문에 써요.'
            : '이 주문을 접수하면 그 주문은 결제 없이 닫히고 쿠폰을 여기에 써요.'}{' '}
          <Link href={`/orders/${encodeURIComponent(coupon.pendingOrder?.orderId ?? '')}`}>진행 중인 주문 확인</Link>
        </p>
      ))}
    </>
  );
}

/** select 항목 꼬리표 — 진행 중인 주문이 잡은 쿠폰임을 목록에서 바로 알린다. */
export function pendingOrderCouponOptionSuffix(coupon: UserCouponSummary): string {
  return couponHeldByReplaceableOrder(coupon) ? ' · 진행 중인 주문에서 사용 중' : '';
}
