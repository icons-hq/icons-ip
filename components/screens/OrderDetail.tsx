import Link from 'next/link';
import { OrderCancellation } from '@/components/orders/OrderCancellation';
import { OrderClaimRequest } from '@/components/orders/OrderClaimRequest';
import { newInquiryHref } from '@/lib/inquiries';
import { Icon } from '@/components/ui/Icon';
import { krw } from '@/lib/format';
import { shippingFeeLabel } from '@/lib/shipping';
import {
  formatOrderDate,
  formatOrderDateTime,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  type OrderDetail as OrderDetailData,
  type OrderDetailStatus,
} from '@/lib/orders';
import { isOpenOrderClaimStage } from '@/lib/orders/claims';
import {
  orderWithdrawalDaysRemaining,
  orderWithdrawalDeadline,
} from '@/lib/orders/withdrawal';

/*
 * 구매자가 보는 사다리(#250). pending은 결제가 끝나지 않은 선점이고 canceled는
 * 사다리를 벗어난 종결이라 두 상태에서는 진행 표시를 그리지 않는다 — 지나갈 일이
 * 없는 단계를 "남은 단계"로 보여주면 기다리면 도착한다는 잘못된 약속이 된다.
 */
const ORDER_LADDER_STEPS = ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const;

function OrderLadder({ status }: { status: OrderDetailStatus }) {
  const currentIndex = (ORDER_LADDER_STEPS as readonly string[]).indexOf(status);
  if (currentIndex < 0) return null;

  return (
    <ol aria-label="주문 진행 단계" className="order-detail-ladder">
      {ORDER_LADDER_STEPS.map((step, index) => (
        <li
          aria-current={index === currentIndex ? 'step' : undefined}
          className="order-detail-ladder-step"
          data-state={index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'}
          key={step}
        >
          {orderStatusMeta(step).label}
        </li>
      ))}
    </ol>
  );
}

/*
 * 청약철회 기한 안내.
 *
 * 기산점은 delivered_at(재화를 공급받은 날)이다 — 주문일도, 발송일도 아니다(#189).
 * 판정의 진실원은 DB의 order_withdrawal_deadline_passed이고 이 블록은 같은 규칙의
 * 고지다. 공급 전에는 남은 일수를 지어내지 않고 "아직 시작하지 않았다"만 말한다.
 */
function WithdrawalDeadlineNotice({
  deliveredAt,
  now,
  status,
}: {
  deliveredAt: string | null;
  now: Date;
  status: OrderDetailStatus;
}) {
  if (status === 'canceled') return null;

  if (!deliveredAt) {
    return (
      <p className="order-detail-withdrawal faint">
        단순 변심 청약철회 기한({ORDER_WITHDRAWAL_DEADLINE_LABELS.change_of_mind})은
        {' '}배송이 완료된 날부터 시작됩니다.
      </p>
    );
  }

  const deadline = orderWithdrawalDeadline(deliveredAt, 'change_of_mind');
  const daysLeft = orderWithdrawalDaysRemaining(deliveredAt, 'change_of_mind', now);
  if (!deadline || daysLeft === null) return null;

  return (
    <p className="order-detail-withdrawal faint">
      <span>배송완료 </span>
      <time dateTime={deliveredAt}>{formatOrderDate(deliveredAt)}</time>
      <span> · </span>
      {daysLeft > 0 ? (
        <>
          <span>단순 변심 청약철회 </span>
          <time dateTime={deadline.toISOString()}>{formatOrderDate(deadline.toISOString())}</time>
          <span>까지 (약 {daysLeft}일 남음)</span>
        </>
      ) : (
        <span>
          단순 변심 청약철회 기한이 지났습니다. 상품 하자·오배송은
          {' '}{ORDER_WITHDRAWAL_DEADLINE_LABELS.defect} 이내에 요청할 수 있습니다.
        </span>
      )}
    </p>
  );
}

export function OrderDetail({
  cardRewardsEnabled = false,
  now,
  order,
}: {
  cardRewardsEnabled?: boolean;
  /** 기한 계산 기준 시각. 테스트 주입용 — 비우면 렌더 시각을 쓴다. */
  now?: Date;
  order: OrderDetailData;
}) {
  const status = orderStatusMeta(order.status);
  const date = formatOrderDate(order.createdAt);
  const at = now ?? new Date();
  const claimRequest = order.cancellationRequest;
  const isCancelClaim = claimRequest?.claimType === 'cancel';
  const activeCancelClaim = Boolean(
    claimRequest && isCancelClaim && isOpenOrderClaimStage(claimRequest.stage),
  );

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
          <OrderLadder status={order.status} />
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

          <WithdrawalDeadlineNotice
            deliveredAt={order.deliveredAt}
            now={at}
            status={order.status}
          />

          {/* 취소(청약철회)와 반품·교환은 다른 절차이고 패널도 둘이다. 한 클레임을
              두 패널이 동시에 그리면 같은 건의 진행 상태가 두 번, 서로 다른 말로
              나온다 — 취소 클레임은 위 패널이, 반품·교환은 아래 패널이 소유한다.
              레거시 status 투영에서는 수거 중인 반품도 '요청 접수'로 보이므로
              판정은 claimType과 stage로 한다(#252). */}
          {!claimRequest || isCancelClaim ? (
            <OrderCancellation
              cancellationRequest={claimRequest}
              deliveredAt={order.deliveredAt}
              orderId={order.id}
              refund={order.refund}
              status={order.status}
            />
          ) : null}

          {/* 진행 중인 취소가 있으면 반품·교환 패널을 그리지 않는다. 어차피 접수할
              수 없고(주문당 활성 클레임 1건), 그리면 취소 클레임의 상태를 다시
              말하게 된다. 취소가 끝나거나 거절된 뒤에는 다시 연다. */}
          {!activeCancelClaim ? (
            <OrderClaimRequest
              claim={isCancelClaim ? null : claimRequest}
              orderId={order.id}
              status={order.status}
            />
          ) : null}

          {/* 청약철회(클레임 접수) 바로 아래에 둔다. 둘은 다른 일이다 — 철회는 절차이고
              문의는 질문이다. 붙여 두면 "무엇을 눌러야 하는지" 헷갈리는 대신 두 경로가
              모두 있다는 사실이 한눈에 보인다. */}
          <div className="order-detail-inquiry">
            <Link
              className="btn btn-ghost"
              href={newInquiryHref({ category: 'order', orderId: order.id })}
            >
              이 주문 문의하기
            </Link>
            <span className="faint" style={{ fontSize: 12.5 }}>
              주문번호와 배송 정보가 함께 전달되어 운영자가 바로 확인할 수 있습니다.
            </span>
          </div>
        </section>

        <aside className="order-detail-receipt card" aria-label="주문 영수증">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">RECEIPT</span>
            <h2>결제 금액</h2>
          </div>
          <dl className="checkout-totals">
            <div><dt>굿즈 금액</dt><dd>{krw(order.total - order.shippingFee)}</dd></div>
            <div><dt>배송비</dt><dd>{shippingFeeLabel(order.shippingFee)}</dd></div>
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

          {order.shipment && (
            <section className="order-receipt-section" aria-labelledby="shipment-heading">
              <h3 id="shipment-heading">배송 정보</h3>
              <dl className="order-payment-summary">
                <div><dt>택배사</dt><dd>{order.shipment.carrierLabel}</dd></div>
                <div><dt>운송장번호</dt><dd className="mono">{order.shipment.trackingNumber}</dd></div>
              </dl>
              <a
                className="btn btn-ghost order-tracking-link"
                href={order.shipment.trackingUrl}
                rel="noreferrer"
                target="_blank"
              >
                배송조회
              </a>
            </section>
          )}

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

          {cardRewardsEnabled && order.cardPacks.issuedCount > 0 && (
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
