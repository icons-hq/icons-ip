import { isUuid } from '@/lib/uuid';

/*
 * 상담 중 고객의 구매이력(1014-103).
 *
 * 사용자 결정(2026-11-11 "전부 다 아무나 볼 수 있게" → 2026-11-12 "이대로"): 상담 화면을 여는 모든 운영자 역할(부매니저·대행사 포함)이
 * 그 문의 고객의 전체 구매이력(금액·상태 포함)을 본다. DB `admin_inquiry_purchase_history`가 문의 응대 권한(cs.manage)과
 * '그 문의의 고객' 범위를 판정하고 열람을 감사한다. 고객 관리의 주문 이력(`admin_operator_customer_history`, 주문 조회 권한)과 다른 길이다.
 */

export const INQUIRY_PURCHASE_HISTORY_PAGE_SIZE = 20;

export interface InquiryPurchaseOrder {
  id: string;
  orderNumber: string | null;
  status: string;
  amount: number;
  createdAt: string;
  /** 대표 상품명(첫 품목). */
  title: string;
  /** 품목 줄 수. */
  itemCount: number;
}

export interface InquiryLinkedOrder {
  id: string;
  orderNumber: string | null;
  status: string;
  amount: number;
  createdAt: string;
  title: string;
  /** 연결 주문의 전체 수량(품목 수량 합). */
  quantity: number;
}

export interface InquiryPurchaseHistory {
  inquiryId: string;
  customerId: string;
  /** 문의에 연결된 그 고객의 주문 요약. 연결이 없거나 다른 고객의 주문이면 null. */
  linkedOrder: InquiryLinkedOrder | null;
  items: InquiryPurchaseOrder[];
  page: number;
  pageSize: number;
  total: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function text(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function orderNumber(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 40);
}

function parseOrder(value: unknown): InquiryPurchaseOrder | null {
  if (!record(value) || !isUuid(value.id) || !orderNumber(value.orderNumber) || !text(value.status, 40) || !count(value.amount)
    || !instant(value.createdAt) || !text(value.title) || !count(value.itemCount)) return null;
  return { id: value.id, orderNumber: value.orderNumber, status: value.status, amount: value.amount, createdAt: value.createdAt,
    title: value.title, itemCount: value.itemCount };
}

function parseLinked(value: unknown): InquiryLinkedOrder | null | undefined {
  if (value === null) return null;
  if (!record(value) || !isUuid(value.id) || !orderNumber(value.orderNumber) || !text(value.status, 40) || !count(value.amount)
    || !instant(value.createdAt) || !text(value.title) || !count(value.quantity)) return undefined;
  return { id: value.id, orderNumber: value.orderNumber, status: value.status, amount: value.amount, createdAt: value.createdAt,
    title: value.title, quantity: value.quantity };
}

/** 응답이 계약과 다르면 빈 이력이 아니라 읽기 실패다(빈 목록으로 보이면 '산 게 없다'로 읽힌다). */
export function parseInquiryPurchaseHistory(value: unknown): InquiryPurchaseHistory | null {
  if (!record(value) || !isUuid(value.inquiryId) || !isUuid(value.customerId) || !Array.isArray(value.items)
    || !count(value.page, 1) || !count(value.pageSize, 1) || !count(value.total)) return null;
  if (value.items.length > value.pageSize || value.items.length > value.total) return null;
  const linkedOrder = parseLinked(value.linkedOrder);
  if (linkedOrder === undefined) return null;
  const items: InquiryPurchaseOrder[] = [];
  for (const row of value.items) {
    const parsed = parseOrder(row);
    if (!parsed) return null;
    items.push(parsed);
  }
  if (new Set(items.map(item => item.id)).size !== items.length) return null;
  return { inquiryId: value.inquiryId, customerId: value.customerId, linkedOrder, items,
    page: value.page, pageSize: value.pageSize, total: value.total };
}
