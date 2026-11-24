import Link from 'next/link';
import { reviewConfirmationBlockMessage } from '@/lib/review-purchase-confirmation';
import type { OrderCancellationRequestSummary, OrderDetailStatus, OrderRefundSummary } from '@/lib/orders';
import { isOpenOrderClaimStage, orderClaimAvailability, type OrderClaimEligibility } from '@/lib/orders/claims';
import type { ShipmentRecord } from '@/lib/orders/shipments';
import { formatReviewDate, newReviewHref } from '@/lib/reviews';
import type { MyReviewTarget } from '@/lib/reviews.server';
import '@/app/styles/wc-order-detail-info.css';

/*
 * 주문 상세 `주문 정보` 카드의 처리 버튼 막대(MD-0037): [구매확정][리뷰작성][교환반품 접수][배송조회].
 *
 * 이 막대는 **기존 패널로 데려가는 진입점**이다. 확정·작성·접수 동작은 각 패널(PurchaseConfirmationPanel·리뷰 작성 화면·
 * OrderClaimRequest)의 서버 판정과 확인 절차(구매확정은 확인 체크박스)를 그대로 쓴다 — 버튼이 직접 확정하면 그 절차를 우회하게 된다.
 * 판정은 `orderActionBarModel` 순수 함수 하나이고 화면은 그 결과를 그린다.
 */

/** 막대가 데려가는 자리의 id. 주문 상세(OrderDetail)가 각 패널을 이 id로 감싼다. */
export const ORDER_PURCHASE_CONFIRMATION_ANCHOR = 'order-purchase-confirmation';
export const ORDER_REVIEW_ANCHOR = 'order-review';
export const ORDER_CLAIM_REQUEST_ANCHOR = 'order-claim-request';
export const ORDER_SHIPMENTS_ANCHOR = 'order-shipments';

export type OrderActionKey = 'confirm' | 'review' | 'claim' | 'tracking';

/** 활성 버튼이 가는 곳. null이면 비활성(안내 줄이 이유를 말한다). */
export type OrderActionTarget =
  | { kind: 'anchor'; href: string }
  | { kind: 'link'; href: string }
  | { kind: 'external'; href: string };

export interface OrderActionModel {
  key: OrderActionKey;
  label: string;
  target: OrderActionTarget | null;
  /** 비활성일 때 막대 아래 회색 안내 줄. 안내가 필요 없는 비활성(구매확정 완료)과 활성 버튼은 null이다. */
  hint: string | null;
}

export interface OrderActionBarModel {
  actions: OrderActionModel[];
}

export interface OrderActionBarInput {
  status: OrderDetailStatus;
  /** 디지털 전용 주문은 교환반품 접수·배송조회가 없다. */
  digitalOnly: boolean;
  reviewTargets: readonly MyReviewTarget[];
  claimEligibility: OrderClaimEligibility | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
  refund: OrderRefundSummary | null;
  shipments: readonly ShipmentRecord[];
  /** 리뷰 작성 시작일 비교 기준. 테스트 주입용 — 비우면 렌더 시각을 쓴다. */
  now?: Date;
}

/** 아직 못 쓰는 리뷰 대상의 사유. 주문 상세 리뷰 칸(OrderReviewEntry)과 막대 안내가 같은 말을 쓴다. */
export function reviewTargetBlockedReason(target: MyReviewTarget, now: Date): string {
  if (target.opensAt && Date.parse(target.opensAt) > now.getTime()) return `${formatReviewDate(target.opensAt)}부터 작성 가능`;
  /* 리뷰 등록 = 구매확정(ADR-0035): 구매확정할 수 없어 막힌 주문은 그 이유(보류 사유 포함)를 말한다. */
  if (target.purchaseConfirmation?.block) return reviewConfirmationBlockMessage(target.purchaseConfirmation.block, target.purchaseConfirmation.holdReason);
  return '현재 작성할 수 없습니다';
}

function confirmAction(status: OrderDetailStatus): OrderActionModel {
  if (status === 'delivered') return { key: 'confirm', label: '구매확정', target: { kind: 'anchor', href: `#${ORDER_PURCHASE_CONFIRMATION_ANCHOR}` }, hint: null };
  if (status === 'done') return { key: 'confirm', label: '구매확정 완료', target: null, hint: null };
  return { key: 'confirm', label: '구매확정', target: null, hint: '구매확정: 배송이 완료되면 할 수 있어요.' };
}

function reviewAction(status: OrderDetailStatus, targets: readonly MyReviewTarget[], now: Date): OrderActionModel {
  const writable = targets.filter((target) => target.writable && !target.review);
  if (writable.length === 1) {
    const [target] = writable;
    return { key: 'review', label: '리뷰작성', target: { kind: 'link', href: newReviewHref(target.orderId, target.goodId, target.kind) }, hint: null };
  }
  if (writable.length > 1) return { key: 'review', label: '리뷰작성', target: { kind: 'anchor', href: `#${ORDER_REVIEW_ANCHOR}` }, hint: null };
  if (targets.length === 0) {
    /* 대상 0개: 배송완료 전이면 아직 때가 아니라서, 배송완료·구매확정인데도 0개면 쓸 수 있는 굿즈가 없어서다(조회 실패일 수도 있어
       '배송이 완료되면'이라고 거짓을 말하지 않는다). */
    const delivered = status === 'delivered' || status === 'done';
    return { key: 'review', label: '리뷰작성', target: null, hint: delivered ? '리뷰작성: 지금은 리뷰를 쓸 수 있는 상품이 없어요.' : '리뷰작성: 배송이 완료되면 쓸 수 있어요.' };
  }
  /* 쓸 수 있는 대상이 없다 — 모두 작성했으면 내 리뷰로, 아니면 아직 못 쓰는 첫 대상의 사유를 말한다. */
  const blocked = targets.find((target) => !target.review);
  if (!blocked) return { key: 'review', label: '내 리뷰 보기', target: { kind: 'anchor', href: `#${ORDER_REVIEW_ANCHOR}` }, hint: null };
  return { key: 'review', label: '리뷰작성', target: null, hint: `리뷰작성: ${reviewTargetBlockedReason(blocked, now)}` };
}

function claimAction(input: OrderActionBarInput): OrderActionModel {
  const { cancellationRequest, refund } = input;
  /* 반품·교환 패널(OrderClaimRequest)이 보는 클레임과 같은 식이다 — 취소 클레임은 그 패널의 `claim`이 아니다. */
  const claim = cancellationRequest && cancellationRequest.claimType !== 'cancel' ? cancellationRequest : null;
  const activeClaim = claim && isOpenOrderClaimStage(claim.stage) ? claim : null;
  const awaitingTransfer = claim?.claimType !== 'exchange' && refund?.status === 'awaiting_transfer';
  /* 진행 중인 취소 클레임이 있으면 주문 상세는 반품·교환 패널을 그리지 않는다 — 이동할 자리가 없으니 접수 불가로 말한다. */
  const activeCancel = cancellationRequest?.claimType === 'cancel' && isOpenOrderClaimStage(cancellationRequest.stage);
  const availability = orderClaimAvailability({
    orderStatus: input.status,
    hasActiveClaim: Boolean(activeClaim) || awaitingTransfer || activeCancel,
    eligibility: input.claimEligibility,
  });
  const anchor: OrderActionTarget = { kind: 'anchor', href: `#${ORDER_CLAIM_REQUEST_ANCHOR}` };
  if (availability.some((entry) => entry.claimType !== 'cancel' && entry.available)) {
    return { key: 'claim', label: '교환반품 접수', target: anchor, hint: null };
  }
  if (activeClaim || (claim && awaitingTransfer)) return { key: 'claim', label: '교환반품 진행 보기', target: anchor, hint: null };
  const reason = availability.find((entry) => entry.claimType === 'return')?.blockedReason ?? '지금은 접수할 수 없습니다.';
  return { key: 'claim', label: '교환반품 접수', target: null, hint: `교환반품 접수: ${reason}` };
}

function trackingAction(shipments: readonly ShipmentRecord[]): OrderActionModel {
  /* ShipmentDetails가 조회 링크를 그리는 조건과 같다 — 택배(또는 배송 방식 정보가 없는 옛 배송 건)이고 조회 주소가 있는 건. */
  const urls = shipments.flatMap((shipment) => (
    shipment.trackingUrl && (shipment.delivery === undefined || shipment.delivery?.method === 'parcel') ? [shipment.trackingUrl] : []
  ));
  if (urls.length === 1) return { key: 'tracking', label: '배송조회', target: { kind: 'external', href: urls[0] }, hint: null };
  if (urls.length > 1) return { key: 'tracking', label: '배송조회', target: { kind: 'anchor', href: `#${ORDER_SHIPMENTS_ANCHOR}` }, hint: null };
  return { key: 'tracking', label: '배송조회', target: null, hint: '배송조회: 운송장이 등록되면 볼 수 있어요.' };
}

/**
 * 막대의 버튼 모델. 결제가 끝나지 않았거나(pending) 취소된(canceled) 주문은 처리할 일이 없어 null(막대 없음)이다.
 */
export function orderActionBarModel(input: OrderActionBarInput): OrderActionBarModel | null {
  if (input.status === 'pending' || input.status === 'canceled') return null;
  const now = input.now ?? new Date();
  const actions = [confirmAction(input.status), reviewAction(input.status, input.reviewTargets, now)];
  if (!input.digitalOnly) actions.push(claimAction(input), trackingAction(input.shipments));
  return { actions };
}

function hintId(key: OrderActionKey): string {
  return `order-action-hint-${key}`;
}

function ActionControl({ action }: { action: OrderActionModel }) {
  const className = 'btn btn-ghost btn-sm';
  const { target } = action;
  if (!target) {
    return (
      <button aria-describedby={action.hint ? hintId(action.key) : undefined} className={className} data-order-action={action.key} disabled type="button">
        {action.label}
      </button>
    );
  }
  if (target.kind === 'link') {
    return <Link className={className} data-order-action={action.key} href={target.href}>{action.label}</Link>;
  }
  if (target.kind === 'external') {
    return <a className={className} data-order-action={action.key} href={target.href} rel="noreferrer" target="_blank">{action.label}</a>;
  }
  return <a className={className} data-order-action={action.key} href={target.href}>{action.label}</a>;
}

export function OrderActionBar(props: OrderActionBarInput) {
  const model = orderActionBarModel(props);
  if (!model) return null;
  const hints = model.actions.filter((action) => action.hint);

  return (
    <div className="order-action-bar-wrap">
      <div aria-label="주문 처리" className="order-action-bar" data-count={model.actions.length} role="group">
        {model.actions.map((action) => <ActionControl action={action} key={action.key} />)}
      </div>
      {hints.length > 0 ? (
        <ul className="order-action-hints">
          {hints.map((action) => <li id={hintId(action.key)} key={action.key}>{action.hint}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
