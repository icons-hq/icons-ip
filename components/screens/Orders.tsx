import Link from 'next/link';
import { ReviewEventBanner } from '@/components/reviews/ReviewEventBanner';
import { Icon } from '@/components/ui/Icon';
import { MypageShell } from '@/components/wc/MypageShell';
import {
  checkoutPaymentResultFollowsApproval,
  type CheckoutPaymentResultFocus,
} from '@/lib/checkout';
import { krw } from '@/lib/format';
import {
  formatOrderDate,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  orderReferenceLabel,
  orderStatusMeta,
  type OrderListItem,
  type VisibleOrderStatus,
} from '@/lib/orders';
import type { PublicReviewEvent } from '@/lib/review-events';

/** 결제 confirm 콜백(/api/payments/goods/confirm…)이 /orders?payment=…로 붙이는 결과값. */
export type OrdersPaymentResult = 'approved' | 'checking' | 'failed';

/** `neutral`은 강조 없는 기본 배너다 — 승인 확인도 실패도 아닌 진행 안내에 쓴다. */
type BannerTone = OrdersPaymentResult | 'neutral';

interface BannerLink {
  readonly href: string;
  readonly label: string;
}

interface BannerCopy {
  readonly tone: BannerTone;
  readonly title: string;
  readonly body: string;
  readonly link?: BannerLink;
  /** 결제가 잡혔을 수 있는 상태에서만 고객센터 안내를 붙인다. */
  readonly inquiry?: boolean;
}

/*
 * 쿼리만 있고 원장에서 대상 주문을 못 찾았을 때의 기본 안내. 콜백 리다이렉트에는 주문
 * 식별자가 없으므로 결제 대기 주문을 함께 보여 주고(page가 pending 포함으로 읽는다),
 * 자동으로 확정된다고 약속하지 않는다 — 웹훅·재정합 경로가 열려 있지 않을 수 있다.
 */
const QUERY_BANNERS: Record<OrdersPaymentResult, BannerCopy> = {
  approved: {
    tone: 'approved',
    title: '결제가 확인됐어요',
    body: '주문이 안전하게 접수됐습니다. 배송 진행은 아래 주문에서 이어서 확인할 수 있어요.',
  },
  checking: {
    tone: 'checking',
    title: '결제를 확인하고 있어요',
    body: '결제사 승인 결과를 아직 확정하지 못했어요. 결제 대기 주문이 있다면 아래 목록에서 상태를 확인할 수 있어요.',
    inquiry: true,
  },
  failed: {
    tone: 'failed',
    title: '결제가 완료되지 않았어요',
    body: '결제가 승인되지 않았습니다. 결제 대기 주문이 있다면 아래 목록에서 결제를 이어가거나 주문을 정리할 수 있어요.',
    link: { href: '/shop', label: '굿즈샵 둘러보기' },
  },
};

/** 원장에서 읽은 실제 결과별 안내. 다음 행동은 그 주문의 결제 화면이 이어받는다. */
function focusBanner(focus: CheckoutPaymentResultFocus): BannerCopy {
  const checkoutLink = (label: string): BannerLink => ({ href: `/checkout/${focus.orderId}`, label });
  switch (focus.outcome) {
    case 'approved':
      return {
        tone: 'approved',
        title: '결제가 확인됐어요',
        body: '주문이 안전하게 접수됐습니다. 배송 진행은 주문 상세에서 이어서 확인할 수 있어요.',
        link: { href: `/orders/${focus.orderId}`, label: '주문 상세 보기' },
      };
    case 'checking':
      return {
        tone: 'checking',
        title: '결제를 확인하고 있어요',
        body: '결제사 승인 결과를 아직 확정하지 못했어요. 결제 상태는 주문 결제 화면에서 다시 확인할 수 있어요.',
        link: checkoutLink('결제 상태 보기'),
        inquiry: true,
      };
    case 'not_approved':
      return {
        tone: 'failed',
        title: '결제가 승인되지 않았어요',
        body: '이 주문으로는 다시 결제할 수 없어요. 주문 결제 화면에서 이 주문을 취소하고 같은 굿즈로 다시 주문할 수 있어요.',
        link: checkoutLink('주문 정리하고 다시 주문하기'),
      };
    case 'attempt_expired':
      /* 토스는 인증 뒤 10분 안에 승인 API를 부르지 않으면 결제를 EXPIRED로 끝낸다(문서
         127). 시도 유효 시간이 지난 콜백은 claim이 거절해 승인 API를 부르지 않는다. 그
         주문은 승인 거절 주문처럼 결제 화면에서 취소하고 다시 주문한다(2026-10-12 QA-1). */
      return {
        tone: 'failed',
        title: '결제 가능 시간이 지났어요',
        body: '결제 준비 후 유효 시간이 지나 결제가 진행되지 않았어요. 청구된 금액은 없어요. 이 주문으로는 다시 결제할 수 없어요. 주문 결제 화면에서 이 주문을 취소하고 같은 굿즈로 다시 주문할 수 있어요.',
        link: checkoutLink('주문 정리하고 다시 주문하기'),
      };
    case 'retryable':
      return {
        tone: 'failed',
        title: '결제가 완료되지 않았어요',
        body: '결제가 승인되지 않았어요. 결제 가능 시간 안에는 같은 주문에서 다시 시도할 수 있어요.',
        link: checkoutLink('결제 이어가기'),
      };
    case 'cancellation_requested':
      /* 취소 요청이 처리 중인 주문은 claim이 결제를 막아 승인 API를 부르지 않는다. 결제
         화면도 같은 이유로 결제를 열지 않으므로 재시도를 약속하지 않는다. */
      return {
        tone: 'failed',
        title: '취소 요청을 처리하고 있어요',
        body: '이 주문에는 처리 중인 취소 요청이 있어 결제가 진행되지 않았어요. 청구된 금액은 없어요. 진행 상태는 주문 상세에서 확인할 수 있어요.',
        link: { href: `/orders/${focus.orderId}`, label: '주문 상세 보기' },
      };
    case 'refund_in_progress':
      /* 승인을 기다리는 사이 취소 요청이 접수됐다. finalizer가 결제 원장을 남기고 결제
         취소를 시작한다(20261013110100) — 승인은 확정됐으므로 '확인 중'이 아니다. 진행
         상태(자동 결제 취소, 실패 시 담당자 확인)는 주문 상세의 취소 패널이 보여준다. */
      return {
        tone: 'neutral',
        title: '결제 취소를 진행하고 있어요',
        body: '결제는 승인됐고, 취소 요청에 따라 결제 취소를 진행하고 있어요. 진행 상태는 주문 상세에서 확인할 수 있어요.',
        link: { href: `/orders/${focus.orderId}`, label: '주문 상세 보기' },
      };
    case 'refunded':
      return {
        tone: 'neutral',
        title: '주문과 결제가 취소됐어요',
        body: '이 주문은 취소됐고 결제도 취소됐어요. 환불 상태는 주문 상세에서 확인할 수 있어요.',
        link: { href: `/orders/${focus.orderId}`, label: '주문 상세 보기' },
      };
    case 'canceled':
      return {
        tone: 'failed',
        title: '주문이 취소됐어요',
        body: '이 주문은 취소됐어요. 같은 굿즈를 다시 담아 새로 주문할 수 있어요.',
        link: checkoutLink('같은 굿즈 다시 담기'),
      };
  }
}

/*
 * 주문 후 배송 과정 안내 (LFS 패리티 2차 L6 · MY-08 — 11 §5.3, R-05 §4.4). 레퍼런스의 4단계를 우리 주문 사다리
 * 다섯 단계(주문 상세와 같은 이름)로 옮기고, 단계마다 그때 할 수 있는 일을 한 줄로 적는다. 문구는 주문 상세의
 * 취소·반품 안내와 같은 규칙이다(직접 취소는 발주확인 전, 반품·교환은 배송 중부터, 청약철회 기한).
 */
const ORDER_FLOW_STEPS: readonly { status: VisibleOrderStatus; body: string; note: string | null }[] = [
  { status: 'paid', body: '결제가 확인되면 주문이 접수돼요.', note: '발주확인 전에는 주문 상세에서 직접 취소할 수 있어요.' },
  { status: 'confirmed', body: '판매자가 주문을 확인하고 발송을 준비해요.', note: '발주확인 뒤 취소는 이 주문의 1:1 문의로 요청해주세요.' },
  { status: 'shipping', body: '굿즈가 출고돼 배송지로 이동하고 있어요.', note: '배송 중부터 주문 전체로 반품·교환을 신청할 수 있어요.' },
  {
    status: 'delivered',
    body: '굿즈를 받았어요. 리뷰를 남길 수 있어요.',
    note: `단순 변심은 ${ORDER_WITHDRAWAL_DEADLINE_LABELS.change_of_mind}, 하자·오배송은 ${ORDER_WITHDRAWAL_DEADLINE_LABELS.defect} 안에 신청해주세요.`,
  },
  { status: 'done', body: '구매를 확정하면 거래가 마무리돼요.', note: null },
];

function OrderFlowGuide() {
  return (
    <section aria-labelledby="orders-flow-heading" className="orders-flow">
      <h2 id="orders-flow-heading">주문 후 배송 과정</h2>
      <ol className="orders-flow-steps">
        {ORDER_FLOW_STEPS.map((step, index) => (
          <li key={step.status}>
            <span className="orders-flow-index" aria-hidden>{index + 1}</span>
            <strong>{orderStatusMeta(step.status).label}</strong>
            <p>{step.body}</p>
            {step.note ? <p className="orders-flow-note">{step.note}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Orders({
  orders,
  paymentResult,
  paymentFocus = null,
  reviewEvents = [],
}: {
  orders: OrderListItem[];
  paymentResult?: OrdersPaymentResult;
  /** 최근 결제 시도의 실제 결과. page가 원장에서 읽어 넘긴다. */
  paymentFocus?: CheckoutPaymentResultFocus | null;
  /** 내 주문에 든 굿즈의 진행 중 리뷰 이벤트(MY-08). 없으면 배너를 그리지 않는다. */
  reviewEvents?: PublicReviewEvent[];
}) {
  // ?payment=는 클라이언트가 만들 수 있는 입력이다. 원장에서 읽은 결과가 있으면 그것으로
  // 안내하고, 없을 때만 쿼리 기본 안내를 쓴다. "결제가 확인됐어요"는 DB가 결제 완료 국면
  // 주문을 실제로 보여줄 때만 말한다 — 쿼리 단독으로는 승인 표시를 만들지 않는다.
  const hasPaidPhaseOrder = orders.some(
    (order) => order.status !== 'pending' && order.status !== 'canceled',
  );
  /* 콜백 리다이렉트에는 주문 식별자가 없어 원장 결과가 다른 주문(나중에 준비만 해 둔
     시도)을 짚을 수 있다. 승인 콜백으로 돌아왔고 DB에 결제 완료 국면 주문이 있으면, 그
     다른 주문의 미결 상태로 방금 승인된 결제를 실패처럼 덮지 않는다. 승인된 결제를 취소
     중이거나 취소한 결과는 방금 승인된 그 결제의 사실이라 덮지 않는다. */
  const focusContradictsApproval = paymentResult === 'approved'
    && paymentFocus !== null
    && !checkoutPaymentResultFollowsApproval(paymentFocus.outcome)
    && hasPaidPhaseOrder;
  const banner: BannerCopy | undefined = !paymentResult
    ? undefined
    : paymentFocus && !focusContradictsApproval
      ? focusBanner(paymentFocus)
      : paymentResult === 'approved' && !hasPaidPhaseOrder
        ? undefined
        : QUERY_BANNERS[paymentResult];

  /* 마이페이지 셸 안의 영수증 지면(MY-01) — 데스크톱은 좌 메뉴로 다른 계정 화면을 오가고, 목록·결제 안내는
     영수증 어휘(.wc-receipt) 그대로다. 머리는 셸 하위 화면과 같은 17/700 + 2px 선. */
  return (
    <MypageShell active="/orders"><div className="wc-receipt orders-page">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">주문 내역</h1>
      </div>

      <section className="orders-section" aria-labelledby="orders-list-heading">
        <div className="wrap">
          {banner && (
            <div
              className={`orders-payment-banner orders-payment-banner--${banner.tone}`}
              role={banner.tone === 'failed' ? 'alert' : 'status'}
            >
              <strong>{banner.title}</strong>
              <p>{banner.body}</p>
              {banner.link && (
                <p>
                  <Link href={banner.link.href}>{banner.link.label}</Link>
                </p>
              )}
              {banner.inquiry && (
                <p>
                  확인이 늦어지거나 결제 금액이 빠져나갔다면 고객센터{' '}
                  <Link href="/my/inquiries">1:1 문의</Link>로 알려주세요. 확인 후 처리 결과를
                  안내드립니다.
                </p>
              )}
            </div>
          )}
          {reviewEvents.length ? (
            <div className="orders-review-events">
              {reviewEvents.map((event) => <ReviewEventBanner event={event} key={event.id} />)}
            </div>
          ) : null}
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
                        <span className="mono">ORDER · {orderReferenceLabel(order.id, order.orderNumber)}</span>
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
          <OrderFlowGuide />
        </div>
      </section>
    </div></MypageShell>
  );
}
