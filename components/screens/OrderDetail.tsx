import Link from 'next/link';
import { OrderCancellation } from '@/components/orders/OrderCancellation';
import { Icon } from '@/components/ui/Icon';
import {
  formatOrderDate,
  formatOrderDateTime,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  type OrderDetail as OrderDetailData,
} from '@/lib/orders';

const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`;

export function OrderDetail({ order }: { order: OrderDetailData }) {
  const status = orderStatusMeta(order.status);
  const date = formatOrderDate(order.createdAt);

  return (
    <main className="screen order-detail-page">
      <header className="order-detail-header">
        <div className="wrap">
          <Link className="order-detail-back" href="/orders">
            <Icon name="chevronLeft" size={17} /> 주문 내역
          </Link>
          <div className="order-detail-status-row">
            <span className={`order-status order-status--${status.tone}`}>{status.label}</span>
          </div>
          <h1 className="h-xl">{status.title}</h1>
          <p>{status.body}</p>
          <div className="order-detail-meta mono">
            <span>ORDER · {orderReferenceLabel(order.id)}</span>
            <span aria-hidden>·</span>
            <time dateTime={order.createdAt}>{date}</time>
          </div>
        </div>
      </header>

      <div className="wrap order-detail-layout">
        <section className="order-detail-main card" aria-labelledby="ordered-goods-heading">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">ITEMS</span>
            <h2 id="ordered-goods-heading">주문한 굿즈</h2>
          </div>

          <div className="order-detail-items">
            {order.items.map((item) => (
              <article className="order-detail-item" key={item.goodId}>
                <div className="order-detail-item-copy">
                  <span>{item.type}</span>
                  <h3>{item.name}</h3>
                </div>
                <dl className="order-detail-item-numbers">
                  <div><dt>수량</dt><dd>{item.qty}개</dd></div>
                  <div><dt>단가</dt><dd>{krw(item.unitPrice)}</dd></div>
                </dl>
                <strong className="mono">{krw(item.qty * item.unitPrice)}</strong>
              </article>
            ))}
          </div>

          <OrderCancellation orderId={order.id} status={order.status} refund={order.refund} />
        </section>

        <aside className="order-detail-receipt card" aria-label="주문 영수증">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">RECEIPT</span>
            <h2>결제 금액</h2>
          </div>
          <dl className="checkout-totals">
            <div><dt>굿즈 금액</dt><dd>{krw(order.total)}</dd></div>
            <div><dt>배송비</dt><dd>무료</dd></div>
            <div className="checkout-total"><dt>총 결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>

          <section className="order-receipt-section" aria-labelledby="shipping-address-heading">
            <h3 id="shipping-address-heading">배송지</h3>
            {order.address ? (
              <address>
                <strong>{order.address.recipientName} · {order.address.phone}</strong>
                <span>[{order.address.postalCode}] {order.address.address1} {order.address.address2}</span>
                {order.address.deliveryNote && <small>{order.address.deliveryNote}</small>}
              </address>
            ) : (
              <p>배송지 정보를 확인할 수 없습니다.</p>
            )}
          </section>

          <section className="order-receipt-section" aria-labelledby="payment-summary-heading">
            <h3 id="payment-summary-heading">결제 정보</h3>
            {order.payment ? (
              <dl className="order-payment-summary">
                <div><dt>상태</dt><dd>{paymentStatusLabel(order.payment.status)}</dd></div>
                <div><dt>금액</dt><dd className="mono">{krw(order.payment.amount)}</dd></div>
                <div><dt>확인 시각</dt><dd><time dateTime={order.payment.createdAt}>{formatOrderDateTime(order.payment.createdAt)}</time></dd></div>
              </dl>
            ) : (
              <p>결제 내역이 없습니다.</p>
            )}
          </section>

          {order.cardPacks.issuedCount > 0 && (
            <section className="order-card-pack-callout" aria-labelledby="card-pack-heading">
              <span className="order-card-pack-icon" aria-hidden><Icon name="card" size={22} /></span>
              <div>
                <h3 id="card-pack-heading">카드팩 {order.cardPacks.issuedCount}개가 발급됐어요</h3>
                <p>지금 개봉할 수 있는 카드팩은 {order.cardPacks.availableCount}개입니다.</p>
              </div>
              <Link className="btn btn-ghost" href="/packs">카드팩 확인</Link>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
