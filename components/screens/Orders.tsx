import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { krw } from '@/lib/format';
import {
  formatOrderDate,
  orderReferenceLabel,
  orderStatusMeta,
  type OrderListItem,
} from '@/lib/orders';

/** Korpay confirm 콜백(/api/payments/goods/confirm)이 /orders?payment=…로 붙이는 결과값. */
export type OrdersPaymentResult = 'approved' | 'checking' | 'failed';

const PAYMENT_RESULT_COPY: Record<OrdersPaymentResult, { title: string; body: string }> = {
  approved: {
    title: '결제가 확인됐어요',
    body: '주문이 안전하게 접수됐습니다. 배송 진행은 아래 주문에서 이어서 확인할 수 있어요.',
  },
  checking: {
    // 미확정 attempt는 자동 상태조회 없이 수동 CS·재무 절차로만 풀린다
    // (docs/runbooks/korpay-production-rollout.md). 새로고침으로 해소된다고 약속하지 않는다.
    title: '결제를 확인하고 있어요',
    body: '결제사 승인 결과를 확인하고 있습니다. 확인이 끝나면 주문이 결제 완료로 표시돼요.',
  },
  failed: {
    // 실패한 카드 주문은 목록에 나타나지 않고 상세에도 재시도 컨트롤이 없다.
    // 갈 수 있는 길(재고 복원 후 재주문)만 안내한다.
    title: '결제가 완료되지 않았어요',
    body: '결제가 승인되지 않았습니다. 선점된 재고는 시간이 지나면 자동으로 복원되니, 굿즈샵에서 다시 담아 주문해주세요.',
  },
};

export function Orders({
  orders,
  paymentResult,
}: {
  orders: OrderListItem[];
  paymentResult?: OrdersPaymentResult;
}) {
  // ?payment=는 클라이언트가 만들 수 있는 입력이다. "결제가 확인됐어요"는 DB가 결제
  // 완료 국면 주문을 실제로 보여줄 때만 말한다 — 쿼리 단독으로는 승인 표시를 만들지 않는다.
  const hasPaidPhaseOrder = orders.some(
    (order) => order.status !== 'pending' && order.status !== 'canceled',
  );
  const banner = paymentResult === 'approved' && !hasPaidPhaseOrder ? undefined : paymentResult;

  return (
    <main className="wc-root wc-receipt orders-page">
      <header className="wc-receipt__head">
        <div className="wrap">
          <h1 className="wc-receipt__title">주문 내역</h1>
          <p className="wc-receipt__subcopy">굿즈 주문의 결제와 배송 상태를 한눈에 확인하세요.</p>
        </div>
      </header>

      <section className="orders-section" aria-labelledby="orders-list-heading">
        <div className="wrap">
          {banner && (
            <div
              className={`orders-payment-banner orders-payment-banner--${banner}`}
              role={banner === 'failed' ? 'alert' : 'status'}
            >
              <strong>{PAYMENT_RESULT_COPY[banner].title}</strong>
              <p>{PAYMENT_RESULT_COPY[banner].body}</p>
              {banner === 'checking' && (
                <p>
                  주문에 반영되지 않았거나 결제 금액이 빠져나갔다면 고객센터{' '}
                  <Link href="/my/inquiries">1:1 문의</Link>로 알려주세요. 확인 후 처리 결과를
                  안내드립니다.
                </p>
              )}
              {banner === 'failed' && (
                <p>
                  <Link href="/shop">굿즈샵 둘러보기</Link>
                </p>
              )}
            </div>
          )}
          <div className="orders-section-heading">
            <h2 id="orders-list-heading">최근 주문</h2>
            <span className="mono">{orders.length}건</span>
          </div>

          {orders.length === 0 ? (
            <div className="orders-empty card">
              <div className="orders-empty-icon" aria-hidden><Icon name="bag" size={30} /></div>
              <h2>아직 주문 내역이 없어요</h2>
              <p>굿즈샵에서 첫 굿즈를 만나보세요.</p>
              <Link className="btn btn-holo" href="/shop">굿즈샵 둘러보기</Link>
            </div>
          ) : (
            <ol className="orders-list">
              {orders.map((order) => {
                const status = orderStatusMeta(order.status);
                const date = formatOrderDate(order.createdAt);

                return (
                  <li key={order.id}>
                    <Link className="order-list-link card" href={`/orders/${order.id}`}>
                      <div className="order-list-reference">
                        <span className="mono">ORDER · {orderReferenceLabel(order.id)}</span>
                        <time dateTime={order.createdAt}>{date}</time>
                      </div>
                      <div className="order-list-item-copy">
                        <strong>{order.itemLabel}</strong>
                        {order.paymentMethod === 'bank_transfer' && order.status === 'pending' && (
                          <span className="order-list-badge">입금 대기</span>
                        )}
                        <span>{order.itemCount}개 굿즈</span>
                      </div>
                      <span className={`order-status order-status--${status.tone}`}>{status.label}</span>
                      <strong className="order-list-total mono">{krw(order.total)}</strong>
                      <span className="order-list-arrow" aria-hidden><Icon name="chevronRight" size={18} /></span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}
