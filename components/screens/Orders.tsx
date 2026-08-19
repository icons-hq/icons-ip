import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { krw } from '@/lib/format';
import {
  formatOrderDate,
  orderReferenceLabel,
  orderStatusMeta,
  type OrderListItem,
} from '@/lib/orders';

export function Orders({ orders }: { orders: OrderListItem[] }) {
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
