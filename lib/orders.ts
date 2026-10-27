import type { CheckoutPaymentMethod, CheckoutAddress } from './checkout';
import { commerceReferenceLabel } from './commerce-number';
import type { ShipmentRecord } from './orders/shipments';
import { isOpenOrderClaimStage, ORDER_CLAIM_TYPE_LABELS, type OrderClaimEligibility, type OrderClaimStage, type OrderClaimType } from './orders/claims';

// 주문 목록에 보이는 상태. pending은 결제가 끝나지 않은 선점이라 별도 취급한다.
// 사다리는 pending → paid → confirmed → shipping → delivered → done이고
// DB의 order_status enum과 같은 순서를 유지한다(#250).
export const VISIBLE_ORDER_STATUSES = [
  'paid',
  'confirmed',
  'shipping',
  'delivered',
  'done',
  'canceled',
] as const;
export const ORDER_DETAIL_STATUSES = ['pending', ...VISIBLE_ORDER_STATUSES] as const;

export type VisibleOrderStatus = (typeof VISIBLE_ORDER_STATUSES)[number];
export type OrderDetailStatus = (typeof ORDER_DETAIL_STATUSES)[number];

export const ORDER_CANCELLATION_REQUEST_STATUSES = [
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
] as const;
export type OrderCancellationRequestStatus = (typeof ORDER_CANCELLATION_REQUEST_STATUSES)[number];

// 청약철회 사유는 기한을 가른다(#189) — 단순 변심 7일, 하자·오배송 3개월.
// 구매자가 고르는 값이다. DB reason_type check 제약은 여기에 운영자 전액 취소('staff',
// ADR-0018)를 더한 것이다 — 전체 값은 lib/orders/claims ORDER_CLAIM_REASON_TYPES.
export const ORDER_WITHDRAWAL_REASON_TYPES = ['change_of_mind', 'defect'] as const;
export type OrderWithdrawalReasonType = (typeof ORDER_WITHDRAWAL_REASON_TYPES)[number];

export const ORDER_WITHDRAWAL_REASON_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: '단순 변심',
  defect: '굿즈 하자·오배송',
};

export const ORDER_WITHDRAWAL_DEADLINE_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: '공급받은 날부터 7일',
  defect: '공급받은 날부터 3개월',
};

export interface OrderStatusPresentation {
  label: string;
  title: string;
  body: string;
  tone: OrderDetailStatus;
}

const STATUS_PRESENTATION: Record<OrderDetailStatus, OrderStatusPresentation> = {
  pending: {
    label: '결제대기',
    title: '결제 상태를 확인하고 있어요',
    body: '결제 대기 또는 승인 확인 중인 주문입니다. 진행하지 않을 주문은 아래에서 취소할 수 있어요.',
    tone: 'pending',
  },
  paid: {
    label: '결제완료',
    title: '주문이 접수됐어요',
    body: '결제가 확인됐고 배송 준비를 시작합니다.',
    tone: 'paid',
  },
  confirmed: {
    label: '발주확인',
    title: '주문을 확인하고 준비 중이에요',
    body: '판매자가 주문을 확인했고 발송 준비를 하고 있습니다.',
    tone: 'confirmed',
  },
  shipping: {
    label: '배송중',
    title: '굿즈가 배송 중이에요',
    body: '주문한 굿즈가 배송지로 이동하고 있습니다.',
    tone: 'shipping',
  },
  delivered: {
    label: '배송완료',
    title: '굿즈가 배송 완료됐어요',
    body: '배송이 완료됐습니다. 문제가 있으면 아래에서 반품·교환을 요청할 수 있어요.',
    tone: 'delivered',
  },
  done: {
    // 구매자 직접 확정과 설정된 자동 정책이 같은 상태에 도달한다.
    // 반품·교환 신청 자격과 기한은 별도 계약이다.
    label: '거래확정',
    title: '거래가 확정됐어요',
    body: '거래가 확정된 주문입니다. 반품·교환은 배송일과 사유별 신청 기한을 별도로 확인해주세요.',
    tone: 'done',
  },
  canceled: {
    label: '취소',
    title: '취소된 주문이에요',
    body: '취소 처리된 주문입니다.',
    tone: 'canceled',
  },
};

export interface OrderListItem {
  orderNumber?: string;
  giftId?: string;
  id: string;
  status: OrderDetailStatus;
  total: number;
  createdAt: string;
  itemLabel: string;
  itemCount: number;
  /** 주문 생성 시점에 고정된 결제수단(#256). */
  paymentMethod: CheckoutPaymentMethod;
  /** 가장 최근 클레임의 유형·단계. 목록 배지가 상세 헤더와 같은 규칙으로 진행 중 클레임을 말한다. */
  claim?: Pick<OrderCancellationRequestSummary, 'claimType' | 'stage'> | null;
}

export interface OrderDetailItem {
  productOrderNumber?: string;
  id: string;
  variantId: string;
  variantName?: string | null;
  customInputs?: import('@/lib/goods-custom-inputs').GoodsCustomInputSelection | null;
  variantCode?: string | null;
  goodId: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
  supplySource?: 'stock' | 'preorder';
  preorderExpectedShipDate?: string | null;
}

export interface OrderPaymentSummary {
  amount: number;
  status: string;
  createdAt: string;
}

export interface OrderRefundSummary {
  status: string;
  createdAt: string;
}

export interface OrderCancellationRequestSummary {
  id: string;
  status: OrderCancellationRequestStatus;
  /**
   * 클레임 유형과 절차 단계(#252).
   *
   * `status`는 레거시 투영이라 반품이 수거 중이어도 `requested`로 보인다. 구매자
   * 화면이 "요청을 접수했습니다"만 말하면 이미 반송한 사람이 아무 일도 일어나지
   * 않았다고 읽는다 — 진행 안내는 반드시 `stage`에서 나와야 한다.
   */
  claimType: OrderClaimType;
  stage: OrderClaimStage;
  reference: number;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  /** 교환 재출고 운송장. 교환이 아니면 항상 null이다. */
  reshipCarrier: string | null;
  reshipTrackingNumber: string | null;
  /** 교환품의 실제 배송완료 확인. 누락된 과거 응답도 미확인으로 취급한다. */
  reshipDeliveredAt?: string | null;
}

export interface OrderDetail {
  orderNumber?: string;
  reshipmentHistory?: import('./orders/reshipment-items').OrderReshipmentReceipt[];
  giftId?: string;
  transaction?: import('./goods-transaction').GoodsTransactionDisplay;
  id: string;
  status: OrderDetailStatus;
  total: number;
  /** 주문 시점 배송비 스냅샷. total에 이미 포함되어 있다. */
  shippingFee: number;
  /** 주문 시점 쿠폰 할인 스냅샷. total에서 이미 빠져 있다(S7). */
  discountTotal: number;
  storeCreditTotal: number;
  address: CheckoutAddress | null;
  createdAt: string;
  /**
   * 재화를 공급받은 날(#189). 청약철회 기한의 법정 기산점이라 구매자 화면이
   * 남은 기간을 계산할 유일한 근거다. shipping→delivered 전이에서 기록되고,
   * 그 전에는 null이다 — 기한이 아직 시작하지 않았다는 뜻이다.
   *
   * optional이 아니라 required다(#250). 주문 상세가 이 값으로 남은 기간을 말하는
   * 이상, 값을 빠뜨린 호출자는 "기한 없음"이 아니라 컴파일 오류를 받아야 한다 —
   * 조용히 undefined가 흘러들면 화면이 이유 없이 안내를 감춘다.
   */
  deliveredAt: string | null;
  /** 주문 생성 시점에 고정된 결제수단(#256). */
  paymentMethod: CheckoutPaymentMethod;
  /**
   * 무통장 입금 기한. `pending` 무통장 주문에만 있다 — 확정되면 서버가 비운다.
   * 값이 있으면 아직 돈이 들어오지 않았다는 뜻이므로 화면이 안내를 띄운다.
   */
  expiresAt: string | null;
  items: OrderDetailItem[];
  payment: OrderPaymentSummary | null;
  refund: OrderRefundSummary | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
  /** DB가 발주확인 이력과 실제 배송 수량으로 판정한다. 조회 불가는 null이며 접수를 열지 않는다. */
  claimEligibility: OrderClaimEligibility | null;
  shipments: ShipmentRecord[];
  cardPacks: {
    issuedCount: number;
    availableCount: number;
  };
}

export function isVisibleOrderStatus(value: string): value is VisibleOrderStatus {
  return (VISIBLE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isOrderDetailStatus(value: string): value is OrderDetailStatus {
  return (ORDER_DETAIL_STATUSES as readonly string[]).includes(value);
}

export function isOrderWithdrawalReasonType(value: string): value is OrderWithdrawalReasonType {
  return (ORDER_WITHDRAWAL_REASON_TYPES as readonly string[]).includes(value);
}

export function isOrderCancellationRequestStatus(value: string): value is OrderCancellationRequestStatus {
  return (ORDER_CANCELLATION_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function orderStatusMeta(status: OrderDetailStatus): OrderStatusPresentation {
  return STATUS_PRESENTATION[status];
}

/**
 * 주문 상세 상단 상태 카드(2026-10-12 브라우저 QA QA-8).
 *
 * 주문 상태는 취소가 끝날 때까지 결제완료·발주확인으로 남는다. 그 값만 보면 결제 취소가
 * 도는 동안에도 "결제가 확인됐고 배송 준비를 시작합니다"라고 말해, 같은 화면의 취소 섹션
 * ("결제 취소 확인 중")과 구매자 알림("주문 취소를 진행해요")과 어긋난다. 진행 중인 취소
 * 클레임이 있으면 그 단계로 말한다. 상태 배지는 실제 주문 상태 그대로 둔다.
 */
export function orderDetailHeaderPresentation(
  status: OrderDetailStatus,
  cancellationRequest: Pick<OrderCancellationRequestSummary, 'claimType' | 'stage'> | null,
): OrderStatusPresentation {
  const base = STATUS_PRESENTATION[status];
  if (status === 'canceled' || cancellationRequest?.claimType !== 'cancel') return base;
  switch (cancellationRequest.stage) {
    case 'processing':
      return {
        ...base,
        title: '주문 취소를 진행하고 있어요',
        body: '결제 취소를 처리하고 있습니다. 끝나면 알림을 보내드려요.',
      };
    case 'needs_review':
      return {
        ...base,
        title: '주문 취소를 확인하고 있어요',
        body: '결제 취소 결과를 확인하고 있습니다. 확인되면 알림을 보내드려요.',
      };
    case 'requested':
    case 'in_review':
    case 'collecting':
    case 'collected':
    case 'on_hold':
      return {
        ...base,
        title: '주문 취소 요청을 접수했어요',
        body: status === 'pending'
          ? '결제 결과를 확인한 뒤 주문 취소를 마무리하고 알림을 보내드려요.'
          : '요청을 확인하고 있습니다. 진행 상황은 알림으로 보내드려요.',
      };
    case 'completed':
    case 'rejected':
    case 'withdrawn':
      return base;
  }
}

/**
 * 진행 중인 클레임 배지(10/14 회의 S20).
 *
 * 주문 상태 배지는 실제 주문 상태 그대로 둔다(결제완료·발주확인은 취소가 끝날 때까지 남는다).
 * 그 옆에 진행 중인 취소·반품·교환의 단계를 덧붙여, 취소를 요청한 구매자가 목록에서도
 * 상태를 본다. 주문 목록과 주문 상세 헤더가 이 함수 하나를 쓴다 — 한쪽만 바꾸면 같은 주문을
 * 두 화면이 다르게 말한다. 끝난 클레임(완료·거절·철회)은 배지를 달지 않는다.
 */
export function orderClaimProgressLabel(
  status: OrderDetailStatus,
  claim: Pick<OrderCancellationRequestSummary, 'claimType' | 'stage'> | null | undefined,
): string | null {
  if (!claim || status === 'canceled' || !isOpenOrderClaimStage(claim.stage)) return null;
  const type = ORDER_CLAIM_TYPE_LABELS[claim.claimType];
  switch (claim.stage) {
    case 'collecting':
      return `${type} 회수 중`;
    case 'collected':
      return `${type} 입고 완료`;
    case 'on_hold':
      return `${type} 보류`;
    case 'processing':
      return `${type} 처리 중`;
    case 'needs_review':
      return `${type} 확인 중`;
    default:
      return `${type} 요청`;
  }
}

export function refundStatusLabel(status: string): string {
  switch (status) {
    case 'requested':
      return '환불 요청 접수';
    case 'awaiting_transfer':
      return '환불 송금 대기';
    case 'done':
      return '환불 완료';
    case 'failed':
      return '환불 확인 필요';
    default:
      return '환불 처리 확인 필요';
  }
}

export function orderReferenceLabel(orderId: string, orderNumber?: string | null): string {
  return commerceReferenceLabel(orderId, orderNumber);
}

export function formatOrderDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function formatOrderDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function summarizeOrderItems(items: ReadonlyArray<{ name: string; qty: number }>) {
  const first = items[0];
  const itemCount = items.reduce((total, item) => total + item.qty, 0);
  if (!first) return { label: '주문한 굿즈', itemCount };

  return {
    label: items.length > 1 ? `${first.name} 외 ${items.length - 1}건` : first.name,
    itemCount,
  };
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'paid':
      return '결제완료';
    case 'canceled':
      return '결제취소';
    case 'failed':
      return '결제실패';
    case 'refunded':
      return '환불완료';
    case 'pending':
      return '확인중';
    default:
      return '처리됨';
  }
}

/* 전자상거래법 청약철회 고지. 인앱 주문 상세와 주문 확인 메일이 같은 문구를 써야
   "계약내용에 관한 서면"의 내용이 채널마다 갈리지 않는다(#180 · L4). */
// 문구는 실제로 강제되는 기한과 일치해야 한다(#189). 사유별 기한은
// order_withdrawal_deadline_passed가 진실원이고, 이 문구는 그 규칙의 고지다.
export const LEGAL_WITHDRAWAL_NOTICE = '굿즈를 공급받은 날부터 7일 이내에 단순 변심 청약철회를 요청할 수 있습니다. 굿즈 하자나 오배송은 공급받은 날부터 3개월 이내에 요청할 수 있습니다. 굿즈 훼손·사용 등 법정 제한 사유가 있으면 제한될 수 있습니다.';
