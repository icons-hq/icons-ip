import type { CheckoutAddress } from './checkout';

export const VISIBLE_ORDER_STATUSES = ['paid', 'shipping', 'done', 'canceled'] as const;

export type VisibleOrderStatus = (typeof VISIBLE_ORDER_STATUSES)[number];

export interface OrderStatusPresentation {
  label: string;
  title: string;
  body: string;
  tone: VisibleOrderStatus;
}

const STATUS_PRESENTATION: Record<VisibleOrderStatus, OrderStatusPresentation> = {
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
  status: VisibleOrderStatus;
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

export interface OrderDetail {
  id: string;
  status: VisibleOrderStatus;
  total: number;
  address: CheckoutAddress | null;
  createdAt: string;
  items: OrderDetailItem[];
  payment: OrderPaymentSummary | null;
  cardPacks: {
    issuedCount: number;
    availableCount: number;
  };
}

export function isVisibleOrderStatus(value: string): value is VisibleOrderStatus {
  return (VISIBLE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function orderStatusMeta(status: VisibleOrderStatus): OrderStatusPresentation {
  return STATUS_PRESENTATION[status];
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
