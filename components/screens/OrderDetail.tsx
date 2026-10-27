import { OrderDownloads } from '@/components/orders/OrderDownloads';
import type { OrderDownloads as OrderDownloadsDocument } from '@/lib/order-downloads';
import { OrderProductionStatus } from '@/components/orders/OrderProductionStatus';
import type { OrderProduction } from '@/lib/order-production';
import { REVIEW_KIND_LABELS, targetReviewDaysRemaining } from '@/lib/review-types';

import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import Link from 'next/link';
import { ClaimWithdrawal } from '@/components/orders/ClaimWithdrawal';
import { ClaimRefundAccount } from '@/components/orders/ClaimRefundAccount';
import { ClaimContactHistory } from '@/components/claim-contact/ClaimContactHistory';
import { ClaimCollectionPlan } from '@/components/orders/ClaimCollectionPlan';
import { OrderClaimFees } from '@/components/orders/ClaimFeePanel';
import { OrderCancellation } from '@/components/orders/OrderCancellation';
import { OrderReshipmentHistory } from '@/components/orders/OrderReshipmentHistory';
import { OrderClaimRequest } from '@/components/orders/OrderClaimRequest';
import { PurchaseConfirmationPanel } from '@/components/orders/PurchaseConfirmationPanel';
import { newInquiryHref } from '@/lib/inquiries';
import type { MyReviewTarget } from '@/lib/reviews.server';
import {
  formatReviewDate,
  editReviewHref,
  newReviewHref,
} from '@/lib/reviews';
import { Icon } from '@/components/ui/Icon';
import { MypageShell } from '@/components/wc/MypageShell';
import type { CheckoutPaymentReading } from '@/lib/checkout';
import { orderDetailCardPaymentNotice } from '@/lib/checkout-status-copy';
import { krw } from '@/lib/format';
import { shippingFeeLabel } from '@/lib/shipping';
import { GoodsTransactionSummary } from '@/components/checkout/GoodsTransactionSummary';
import { transactionReceiptNames } from '@/lib/checkout-transaction';
import {
  formatOrderDate,
  formatOrderDateTime,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  ORDER_WITHDRAWAL_REASON_LABELS,
  orderClaimProgressLabel,
  orderDetailHeaderPresentation,
  orderReferenceLabel,
  orderStatusMeta,
  paymentStatusLabel,
  type OrderDetail as OrderDetailData,
  type OrderDetailStatus,
} from '@/lib/orders';
import { isOpenOrderClaimStage } from '@/lib/orders/claims';
import { ORDER_CLAIM_TYPE_LABELS } from '@/lib/orders/claims';
import type { ClaimTypeHistory } from '@/lib/orders/claim-type-conversion';
import type { ClaimReasonHistory } from '@/lib/orders/claim-reason-change';
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

function OrderLadder({ status, digitalOnly = false }: { status: OrderDetailStatus; digitalOnly?: boolean }) {
  const steps = digitalOnly ? ['paid', 'delivered', 'done'] as const : ORDER_LADDER_STEPS;
  const currentStatus = digitalOnly && (status === 'confirmed' || status === 'shipping') ? 'paid' : status;
  const currentIndex = (steps as readonly string[]).indexOf(currentStatus);
  if (currentIndex < 0) return null;

  return (
    <ol aria-label="주문 진행 단계" className="order-detail-ladder">
      {steps.map((step, index) => (
        <li
          aria-current={index === currentIndex ? 'step' : undefined}
          className="order-detail-ladder-step"
          data-state={index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'}
          key={step}
        >
          {digitalOnly && step === 'delivered' ? '파일 제공 시작' : digitalOnly && step === 'done' ? '구매확정' : orderStatusMeta(step).label}
        </li>
      ))}
    </ol>
  );
}

/*
 * 리뷰 진입점(#254).
 *
 * 배송완료 이상 주문에서만 나타난다 — 자격을 서버가 판정하고 화면은 그 결과를
 * 보여줄 뿐이라, 목록이 비면 블록 자체가 없다. 아직 못 쓰는 상태에서 버튼만 띄우면
 * 눌렀을 때 거절당하는 경로가 생긴다.
 *
 * 작성 기한을 함께 말한다. 배송완료 후 90일은 길어 보이지만, 리뷰를 쓰려고 마음먹은
 * 시점이 지나면 대개 다시 오지 않는다.
 */
function OrderReviewEntry({
  now,
  targets,
}: {
  now: Date;
  targets: MyReviewTarget[];
}) {
  if (!targets.length) return null;

  return (
    <section aria-labelledby="order-review-heading" className="order-detail-inquiry">
      {/* WC 이행 표면은 HM/editorial 토큰(--dim 등)을 참조하지 않는다 — 그 토큰은
          이제 어드민 잔존 파일 소유라, 어드민 정리 때 이 글자색이 조용히 사라진다. */}
      <h3 className="mono" id="order-review-heading" style={{ color: 'var(--wc-ink-tertiary)', fontSize: 11, letterSpacing: '.14em', margin: 0 }}>
        리뷰
      </h3>
      <ul className="col" style={{ gap: 8, listStyle: 'none', margin: 0, padding: 0, width: '100%' }}>
        {targets.map((target) => {
          const daysLeft = targetReviewDaysRemaining(target, now);

          return (
            <li className="between" key={`${target.orderId}:${target.goodId}:${target.kind ?? 'ordinary'}`} style={{ alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13.5, minWidth: 0 }}>{target.goodName} · {REVIEW_KIND_LABELS[target.kind ?? 'ordinary']}</span>
              {target.review ? (
                <Link className="btn btn-sm btn-ghost" href={editReviewHref(target.review.id)}>
                  내 리뷰 보기
                </Link>
              ) : target.writable ? (
                <Link className="btn btn-sm" href={newReviewHref(target.orderId, target.goodId, target.kind)}>
                  리뷰 쓰기{daysLeft ? ` (${daysLeft}일 남음)` : ''}
                </Link>
              ) : (
                <span className="faint" style={{ fontSize: 12.5 }}>
                  {target.opensAt && Date.parse(target.opensAt) > now.getTime() ? `${formatReviewDate(target.opensAt)}부터 작성 가능` : '현재 작성할 수 없습니다'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/*
 * 단순 변심 반품·교환 기한 안내(법정 청약철회 기한).
 *
 * 화면 문구는 고객이 실제로 누르는 절차 이름으로 말한다(10/14 회의 S19) — 실물은 반품·교환,
 * 디지털 전용 주문은 교환을 받지 않으므로 취소·환불 검토 요청이다. 법정 용어와 전체 고지는
 * 취소 패널의 접힌 법정 안내(LEGAL_WITHDRAWAL_NOTICE)에 그대로 있다.
 *
 * 기산점은 delivered_at(재화를 공급받은 날)이다 — 주문일도, 발송일도 아니다(#189).
 * 판정의 진실원은 DB의 order_withdrawal_deadline_passed이고 이 블록은 같은 규칙의
 * 고지다. 공급 전에는 남은 일수를 지어내지 않고 "아직 시작하지 않았다"만 말한다.
 */
function WithdrawalDeadlineNotice({
  deliveredAt,
  now,
  status,
  digitalOnly = false,
}: {
  deliveredAt: string | null;
  now: Date;
  status: OrderDetailStatus;
  digitalOnly?: boolean;
}) {
  if (status === 'canceled') return null;
  const procedure = digitalOnly ? '취소·환불 검토 요청' : '반품·교환';

  if (!deliveredAt) {
    return (
      <p className="order-detail-withdrawal faint">
        단순 변심 {procedure} 기한({ORDER_WITHDRAWAL_DEADLINE_LABELS.change_of_mind})은
        {' '}{digitalOnly ? '파일 제공이 시작된 날부터 확인합니다.' : '배송이 완료된 날부터 시작됩니다.'}
      </p>
    );
  }

  const deadline = orderWithdrawalDeadline(deliveredAt, 'change_of_mind');
  const daysLeft = orderWithdrawalDaysRemaining(deliveredAt, 'change_of_mind', now);
  if (!deadline || daysLeft === null) return null;

  return (
    <p className="order-detail-withdrawal faint">
      <span>{digitalOnly ? '파일 제공 시작 ' : '배송완료 '}</span>
      <time dateTime={deliveredAt}>{formatOrderDate(deliveredAt)}</time>
      <span> · </span>
      {daysLeft > 0 ? (
        <>
          <span>단순 변심 {procedure} </span>
          <time dateTime={deadline.toISOString()}>{formatOrderDate(deadline.toISOString())}</time>
          <span>까지 (약 {daysLeft}일 남음)</span>
        </>
      ) : (
        <span>
          단순 변심 {procedure} 기한이 지났습니다. {digitalOnly ? '파일 하자·오제공은' : '굿즈 하자·오배송은'}
          {' '}{ORDER_WITHDRAWAL_DEADLINE_LABELS.defect} 이내에 요청할 수 있습니다.
        </span>
      )}
    </p>
  );
}

export function OrderDetail({
  viewerId,
  cardPayment = null,
  cardRewardsEnabled = false,
  now,
  order,
  reviewTargets = [],
  production,
  downloads,
  claimTypeHistory = [],
  claimReasonHistory = [],
}: {
  viewerId?: string;
  /**
   * 결제 대기 카드 주문의 결제 국면. 결제 화면과 같은 규칙으로 page가 원장에서 읽어 넘긴다.
   * 없으면(읽지 못함) 결제 상태를 단정하지 않는다.
   */
  cardPayment?: CheckoutPaymentReading | null;
  cardRewardsEnabled?: boolean;
  /** 기한 계산 기준 시각. 테스트 주입용 — 비우면 렌더 시각을 쓴다. */
  now?: Date;
  order: OrderDetailData;
  /** 배송완료 이상 주문의 굿즈별 리뷰 상태(#254). 그 전에는 빈 배열이다. */
  reviewTargets?: MyReviewTarget[];
  production?: OrderProduction | null;
  downloads?: OrderDownloadsDocument | null;
  claimTypeHistory?: ClaimTypeHistory[] | null;
  claimReasonHistory?: ClaimReasonHistory[] | null;
}) {
  const date = formatOrderDate(order.createdAt);
  const at = now ?? new Date();
  const hasPhysicalItems = order.items.some(item => order.transaction?.lines.find(line => line.lineId === item.id)?.fulfillment?.mode !== 'digital' && !downloads?.items.some(file => file.itemId === item.id));
  const digitalOnly = order.items.length > 0 && !hasPhysicalItems;
  const status = { ...orderDetailHeaderPresentation(order.status, order.cancellationRequest) };
  if (digitalOnly && !(order.cancellationRequest?.claimType === 'cancel' && isOpenOrderClaimStage(order.cancellationRequest.stage)) && ['paid', 'confirmed', 'shipping', 'delivered', 'done'].includes(order.status)) {
    status.label = order.status === 'delivered' ? '파일 제공 시작' : order.status === 'done' ? '구매확정' : '결제완료';
    status.title = order.status === 'done' ? '구매확정된 디지털 주문이에요' : downloads?.items.some(item => item.available) ? '구매한 파일을 받을 수 있어요' : '파일 제공 상태를 확인해주세요';
    status.body = '구매한 파일과 현재 제공 상태를 아래에서 확인할 수 있습니다. 파일에 문제가 있으면 이 주문의 문의 또는 취소 검토 요청을 이용해주세요.';
  }
  const claimRequest = order.cancellationRequest;
  const claimLabel = orderClaimProgressLabel(order.status, claimRequest);
  const isCancelClaim = claimRequest?.claimType === 'cancel';
  const activeCancelClaim = Boolean(
    claimRequest && isCancelClaim && isOpenOrderClaimStage(claimRequest.stage),
  );
  /* 결제 대기 카드 주문은 결제 화면과 같은 사실을 말한다. 승인 거절·시도 만료처럼 닫힌
     결제를 '확인 중'으로 말하거나 이어갈 수 없는 결제를 '이어가기'로 안내하지 않는다. */
  const cardNotice = order.paymentMethod === 'card' && order.status === 'pending'
    ? orderDetailCardPaymentNotice(cardPayment, { orderId: order.id, orderExpiresAt: order.expiresAt })
    : null;
  const headerCopy = cardNotice?.header ?? status;

  /* 마이페이지 셸 안의 영수증 지면(MY-01) — 주문 상세도 데스크톱 좌 메뉴를 함께 둔다. 영수증·클레임 패널은 그대로다. */
  return (
    <MypageShell active="/orders"><div className="wc-receipt order-detail-page">
      <header className="wc-receipt__head order-detail-header">
        <div className="wrap">
          <Link className="order-detail-back" href="/orders">
            <Icon name="chevronLeft" size={17} /> 주문 내역
          </Link>
          <div className="order-detail-status-row">
            <span className={`order-status order-status--${status.tone}`}>{status.label}</span>
            {/* 주문 목록 배지와 같은 함수다 — 진행 중인 클레임이 두 화면에서 같은 말로 보인다. */}
            {claimLabel && <span className="order-list-badge order-claim-badge">{claimLabel}</span>}
          </div>
          <h1 className="wc-receipt__title">{headerCopy.title}</h1>
          <p className="wc-receipt__subcopy">{headerCopy.body}</p>
          <OrderLadder status={order.status} digitalOnly={digitalOnly} />
          <div className="order-detail-meta mono">
            <span>ORDER · {orderReferenceLabel(order.id, order.orderNumber)}</span>
            <span aria-hidden>·</span>
            <time dateTime={order.createdAt}>{date}</time>
          </div>
        </div>
      </header>

      {/*
        무통장 주문의 입금 안내는 지금까지 알림 링크와 결제 화면에만 있었다.
        구매자가 나중에 "얼마를 어디로 보내야 하지"를 다시 찾는 자리는 주문
        내역이므로, 아직 돈이 들어오지 않은 동안 여기서도 길을 열어 준다.
        계좌 값 자체는 싣지 않는다 — 서버 설정에서만 읽는 값이고(#255),
        결제 화면이 그 한 곳이다.
      */}
      {order.paymentMethod === 'bank_transfer' && order.status === 'pending' && (
        <div className="wrap">
          <div className="order-detail-deposit card" role="status">
            <div>
              <strong>입금을 기다리고 있어요</strong>
              <p>
                안내된 계좌로 {krw(order.total)}을 기한 안에 입금하면 확인 후 주문이 확정됩니다.
                기한이 지나면 자동으로 취소되고 재고는 복원돼요.
              </p>
            </div>
            <Link className="btn btn-holo" href={`/checkout/${order.id}`}>입금 안내 보기</Link>
          </div>
        </div>
      )}

      {/* 다음 행동이 결제 화면에 있을 때만 그곳으로 보낸다. 처리 중인 취소가 있으면 DB가
          결제를 막고, 승인과 겹친 취소는 승인된 결제를 취소하는 중이라 진행 상태는 아래 취소
          패널에 맡긴다. */}
      {cardNotice?.banner && !activeCancelClaim && (
        <div className="wrap"><div className="order-detail-deposit card">
          <div><strong>{cardNotice.banner.title}</strong><p>{cardNotice.banner.body}</p></div>
          <Link className="btn btn-holo" href={cardNotice.banner.link.href}>{cardNotice.banner.link.label}</Link>
        </div></div>
      )}

      <div className="wrap order-detail-layout">
        <section className="order-detail-main card" aria-labelledby="ordered-goods-heading">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">ITEMS</span>
            <h2 id="ordered-goods-heading">주문한 굿즈</h2>
          </div>

          <div className="order-detail-items">
            {order.items.map((item) => (
              <article className="order-detail-item" key={item.id}>
                <div className="order-detail-item-copy">
                  <span>{item.type}</span>
                  <h3>{item.name}</h3>
                  {item.variantName ? <p>{item.variantName}</p> : null}<GoodsCustomInputsSummary selection={item.customInputs} />
                </div>
                <dl className="order-detail-item-numbers">
                  <div><dt>수량</dt><dd>{item.qty}개</dd></div>
                  <div><dt>단가</dt><dd>{krw(item.unitPrice)}</dd></div>
                </dl>
                {/* 수량이 1이면 줄 합계가 단가와 같은 금액이라 두 번 말하지 않는다(10/14 회의 S21). */}
                {item.qty > 1 ? <strong className="mono">{krw(item.qty * item.unitPrice)}</strong> : null}
              </article>
            ))}
          </div>

          <OrderReshipmentHistory receipts={order.reshipmentHistory ?? []} />

          {production !== undefined ? <OrderProductionStatus document={production} /> : null}
          {downloads !== undefined ? <OrderDownloads document={downloads} /> : null}
          <OrderReviewEntry now={at} targets={reviewTargets} />

          <WithdrawalDeadlineNotice
            deliveredAt={order.deliveredAt}
            now={at}
            status={order.status}
            digitalOnly={digitalOnly}
          />

          {/* 취소(청약철회)와 반품·교환은 다른 절차이고 패널도 둘이다. 한 클레임을
              두 패널이 동시에 그리면 같은 건의 진행 상태가 두 번, 서로 다른 말로
              나온다 — 취소 클레임은 위 패널이, 반품·교환은 아래 패널이 소유한다.
              레거시 status 투영에서는 수거 중인 반품도 '요청 접수'로 보이므로
              판정은 claimType과 stage로 한다(#252). */}
          {!claimRequest || isCancelClaim ? (
            <OrderCancellation
              cancellationRequest={claimRequest}
              eligibility={order.claimEligibility}
              deliveredAt={order.deliveredAt}
              orderId={order.id}
              refund={order.refund}
              status={order.status}
            />
          ) : null}

          {/* 진행 중인 취소가 있으면 반품·교환 패널을 그리지 않는다. 어차피 접수할
              수 없고(주문당 활성 클레임 1건), 그리면 취소 클레임의 상태를 다시
              말하게 된다. 취소가 끝나거나 거절된 뒤에는 다시 연다. */}
          {viewerId && ['delivered', 'done'].includes(order.status) ? <PurchaseConfirmationPanel key={order.id} orderId={order.id} actorId={viewerId} /> : null}
          {!activeCancelClaim ? (
            <OrderClaimRequest
              claim={isCancelClaim ? null : claimRequest}
              refund={order.refund}
              eligibility={order.claimEligibility}
              orderId={order.id}
              status={order.status}
            />
          ) : null}

          {claimRequest ? order.giftId ? <a href={`/gifts/${order.giftId}`}>선물 요청 관리</a> : <ClaimWithdrawal key={claimRequest.id} claimId={claimRequest.id} stage={claimRequest.stage} /> : null}
          {viewerId && claimRequest && !order.giftId && order.paymentMethod === 'bank_transfer' && claimRequest.claimType !== 'exchange'
            && isOpenOrderClaimStage(claimRequest.stage) ? <ClaimRefundAccount actorId={viewerId} orderId={order.id} claimId={claimRequest.id} /> : null}
          {viewerId && hasPhysicalItems && claimRequest && (claimRequest.claimType === 'return' || claimRequest.claimType === 'exchange')
            ? <><ClaimCollectionPlan actorId={viewerId} claimId={claimRequest.id} /><ClaimContactHistory key={`contact:${claimRequest.id}`} actorId={viewerId} orderId={order.id} claimId={claimRequest.id} /></> : null}
          {viewerId ? <OrderClaimFees actorId={viewerId} orderId={order.id} /> : null}
          {claimTypeHistory === null ? <p role="status">반품·교환 유형 변경 이력을 읽지 못했습니다. 잠시 후 새로고침해주세요.</p> : claimTypeHistory.length ? <section className="order-claim-type-history" aria-label="반품·교환 유형 변경 이력">
            <h3>요청 유형 변경 이력</h3><ol>{claimTypeHistory.map(row => <li key={row.id}><time dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {ORDER_CLAIM_TYPE_LABELS[row.fromType]} → {ORDER_CLAIM_TYPE_LABELS[row.toType]} · 고객 합의 확인</li>)}</ol>
          </section> : null}

          {claimReasonHistory === null ? <p role="status">교환 사유 정정 이력을 읽지 못했습니다. 잠시 후 새로고침해주세요.</p> : claimReasonHistory.length ? <section className="order-claim-type-history" aria-label="교환 사유 정정 이력">
            <h3>교환 사유 정정 이력</h3><p>최초 요청 내용과 정정된 내용을 함께 보관합니다. 원래 접수일은 유지됩니다.</p>
            <ol>{claimReasonHistory.map(row => <li key={row.id}><time dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time>
              <p>최초 접수: {formatOrderDateTime(row.requestedAt)}</p>
              <p>정정 전: {ORDER_WITHDRAWAL_REASON_LABELS[row.fromReasonType]} · {row.fromReason}</p><p>정정 후: {ORDER_WITHDRAWAL_REASON_LABELS[row.toReasonType]} · {row.toReason}</p>
            </li>)}</ol>
          </section> : null}

          {/* 직접 신청 조건 밖의 의사표시도 주문 맥락과 최초 문의 시각을 남긴다. */}
          <div className="order-detail-inquiry">
            <Link
              className="btn btn-ghost"
              href={newInquiryHref({ category: 'order', orderId: order.id })}
            >
              이 주문 문의하기
            </Link>
            <span className="faint" style={{ fontSize: 12.5 }}>
              {downloads?.items.length ? '디지털 파일 제공 후에도 취소·환불 검토를 요청할 수 있습니다.' : production?.jobs.length ? '주문제작은 발송 전 취소 검토를 요청할 수 있고, 반품·교환은 배송 중부터 주문 전체로 신청할 수 있습니다.' : '직접 취소는 발주확인 전, 반품·교환은 배송 중부터 주문 전체로 신청할 수 있습니다.'}
              그 밖의 취소·반품 요청은 이 주문의 1:1 문의 또는 고객센터로 알려주세요.
              주문 정보와 접수 시각이 함께 보존됩니다. 문의 접수만으로 환불이 승인되거나 출고가 중단되지는 않습니다.
            </span>
          </div>
        </section>

        <aside className="order-detail-receipt card" aria-label="주문 영수증">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">RECEIPT</span>
            <h2>결제 금액</h2>
          </div>
          {order.transaction ? <GoodsTransactionSummary display={order.transaction} names={transactionReceiptNames(order.transaction, order.items)} /> : <dl className="checkout-totals">
            {/* total 은 할인·배송비가 이미 반영된 청구액이다 — 굿즈 금액은 둘을 되돌려 복원한다. */}
            <div><dt>굿즈 금액</dt><dd>{krw(order.total - order.shippingFee + order.discountTotal + order.storeCreditTotal)}</dd></div>
            {order.discountTotal > 0 && (
              <div><dt>쿠폰 할인</dt><dd>−{krw(order.discountTotal)}</dd></div>
            )}
            {order.storeCreditTotal > 0 && <div><dt>적립금 사용</dt><dd>−{krw(order.storeCreditTotal)}</dd></div>}
            <div><dt>배송비</dt><dd>{shippingFeeLabel(order.shippingFee)}</dd></div>
            <div className="checkout-total"><dt>총 결제 금액</dt><dd>{krw(order.total)}</dd></div>
          </dl>}

          <section className="order-receipt-section" aria-labelledby="shipping-address-heading">
            <h3 id="shipping-address-heading">배송지</h3>
            {order.address ? (
              <address>
                <strong>{order.address.recipientName} · {order.address.phone}</strong>
                <span>[{order.address.postalCode}] {order.address.address1} {order.address.address2}</span>
                {order.address.deliveryNote && <small>{order.address.deliveryNote}</small>}
              </address>
            ) : (
              <p>{order.giftId ? '선물 받는 분이 입력한 주소로 배송됩니다. 주소와 연락처는 받는 분만 확인할 수 있어요.' : order.shipments.length > 0 && order.shipments.every(shipment => shipment.delivery && ['pickup', 'none', 'digital'].includes(shipment.delivery.method)) ? '배송 주소가 필요하지 않은 수령 방식입니다.' : '배송지 정보를 확인할 수 없습니다.'}</p>
            )}
          </section>

          <ShipmentDetails shipments={order.shipments} items={order.items} transactionShipping={order.transaction?.shipping} />

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
    </div></MypageShell>
  );
}
