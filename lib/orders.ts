import type { CheckoutAddress } from './checkout';
import type { OrderShipment } from './orders/shipment';

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
// DB의 order_cancellation_requests.reason_type check 제약과 같은 값이어야 한다.
export const ORDER_WITHDRAWAL_REASON_TYPES = ['change_of_mind', 'defect'] as const;
export type OrderWithdrawalReasonType = (typeof ORDER_WITHDRAWAL_REASON_TYPES)[number];

export const ORDER_WITHDRAWAL_REASON_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: '단순 변심',
  defect: '상품 하자·오배송',
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
    body: '배송이 완료됐습니다. 문제가 있으면 아래에서 청약철회를 요청할 수 있어요.',
    tone: 'delivered',
  },
  done: {
    // "완료"가 아니라 "거래확정"이다(CONTEXT.md). 변심 청약철회 창이 닫혔다는
    // 뜻이고, 하자·오배송 클레임은 공급받은 날부터 3개월까지 남아 있다.
    label: '거래확정',
    title: '거래가 확정됐어요',
    body: '배송완료 후 청약철회 기간이 지나 거래가 확정된 주문입니다.',
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
  id: string;
  status: OrderDetailStatus;
  total: number;
  createdAt: string;
  itemLabel: string;
  itemCount: number;
}

export interface OrderDetailItem {
  goodId: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
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
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface OrderDetail {
  id: string;
  status: OrderDetailStatus;
  total: number;
  /** 주문 시점 배송비 스냅샷. total에 이미 포함되어 있다. */
  shippingFee: number;
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
  items: OrderDetailItem[];
  payment: OrderPaymentSummary | null;
  refund: OrderRefundSummary | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
  shipment: OrderShipment | null;
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

export function refundStatusLabel(status: string): string {
  switch (status) {
    case 'requested':
      return '환불 요청 접수';
    case 'done':
      return '환불 완료';
    case 'failed':
      return '환불 확인 필요';
    default:
      return '환불 처리 확인 필요';
  }
}

export function orderReferenceLabel(orderId: string): string {
  return orderId.replaceAll('-', '').slice(-8).toUpperCase();
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
export const LEGAL_WITHDRAWAL_NOTICE = '굿즈를 공급받은 날부터 7일 이내에 단순 변심 청약철회를 요청할 수 있습니다. 상품 하자나 오배송은 공급받은 날부터 3개월 이내에 요청할 수 있습니다. 상품 훼손·사용 등 법정 제한 사유가 있으면 제한될 수 있습니다.';
