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
    title: '결제를 확인하고 있어요',
    body: '결제사 확인 결과와 서버 원장을 대조하고 있습니다. 잠시 후 이 페이지를 새로고침하면 최신 상태가 반영돼요.',
  },
  failed: {
    title: '결제가 완료되지 않았어요',
    body: '결제가 승인되지 않아 주문은 결제 전 상태로 남아 있습니다. 주문 상세에서 결제를 다시 시도할 수 있어요.',
  },
};

export function Orders({
  orders,
  paymentResult,
}: {
  orders: OrderListItem[];
  paymentResult?: OrdersPaymentResult;
}) {
  return (
    <main className="screen orders-page">
      <header className="orders-header">
        <div className="wrap">
          <div className="eyebrow rise" style={{ color: 'var(--amber)' }}>MY ORDERS</div>
          <h1 className="h-xl rise">주문 내역</h1>
          <p>굿즈 주문의 결제와 배송 상태를 한눈에 확인하세요.</p>
        </div>
      </header>

      <section className="orders-section" aria-labelledby="orders-list-heading">
        <div className="wrap">
          {paymentResult && (
            <div
              className={`orders-payment-banner orders-payment-banner--${paymentResult}`}
              role={paymentResult === 'failed' ? 'alert' : 'status'}
            >
              <strong>{PAYMENT_RESULT_COPY[paymentResult].title}</strong>
              <p>{PAYMENT_RESULT_COPY[paymentResult].body}</p>
              {paymentResult === 'checking' && (
                <p>
                  시간이 지나도 주문에 반영되지 않으면 고객센터{' '}
                  <Link href="/my/inquiries">1:1 문의</Link>로 알려주세요.
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
