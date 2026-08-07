import type { CheckoutAddress } from './checkout';

export const VISIBLE_ORDER_STATUSES = ['paid', 'shipping', 'done', 'canceled'] as const;
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
  shipping: {
    label: '배송중',
    title: '굿즈가 배송 중이에요',
    body: '주문한 굿즈가 배송지로 이동하고 있습니다.',
    tone: 'shipping',
  },
  done: {
    label: '완료',
    title: '주문이 완료됐어요',
    body: '배송이 완료된 주문입니다.',
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
  items: OrderDetailItem[];
  payment: OrderPaymentSummary | null;
  refund: OrderRefundSummary | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
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
