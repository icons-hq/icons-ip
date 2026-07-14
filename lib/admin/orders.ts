export const ADMIN_ORDER_STATUSES = ['pending', 'paid', 'shipping', 'done', 'canceled'] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];
export type AdminOrderStatusFilter = AdminOrderStatus | 'all';

export const ORDER_CANCELLATION_REQUEST_STATUSES = [
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
] as const;
export type OrderCancellationRequestStatus = (typeof ORDER_CANCELLATION_REQUEST_STATUSES)[number];

export interface AdminOrderFilters {
  from: string | null;
  orderId: string | null;
  page: number;
  query: string;
  status: AdminOrderStatusFilter;
  to: string | null;
}

export interface AdminOrderAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  deliveryNote?: string;
}

export interface AdminOrderItemRecord {
  id: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
}

export interface AdminOrderPaymentRecord {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminOrderRefundRecord {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminOrderCancellationRequestRecord {
  id: string;
  status: OrderCancellationRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface AdminOrderRecord {
  id: string;
  userId: string;
  buyerName: string;
  buyerEmail: string | null;
  status: AdminOrderStatus;
  total: number;
  address: AdminOrderAddress | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemRecord[];
  payments: AdminOrderPaymentRecord[];
  refunds: AdminOrderRefundRecord[];
  cancellationRequest: AdminOrderCancellationRequestRecord | null;
}

export interface AdminOrderConsoleData {
  items: AdminOrderRecord[];
  filters: AdminOrderFilters;
  pageSize: number;
  total: number;
}

export type AdminOrderFieldErrors = Record<string, string>;
export type AdminOrderFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: AdminOrderFieldErrors };

type SearchParamValue = string | string[] | undefined;
type AdminOrderSearchParams = Record<string, SearchParamValue>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDER_STATUS_SET = new Set<string>(ADMIN_ORDER_STATUSES);
const SHIPPING_STATUS_SET = new Set<string>(['shipping', 'done']);

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizedDate(value: SearchParamValue) {
  const candidate = singleParam(value);
  return validCalendarDate(candidate) ? candidate : null;
}

function normalizedUuid(value: SearchParamValue) {
  const candidate = singleParam(value).trim();
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminOrderFilters(searchParams: AdminOrderSearchParams): AdminOrderFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawPage = Number(singleParam(searchParams.page));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawQuery = singleParam(searchParams.query).trim();
  const query = rawQuery.length <= 100 ? rawQuery : '';
  const rawStatus = singleParam(searchParams.status);
  const status = ORDER_STATUS_SET.has(rawStatus) ? rawStatus as AdminOrderStatus : 'all';

  return {
    from,
    orderId: normalizedUuid(searchParams.order),
    page,
    query,
    status,
    to,
  };
}

export function normalizeAdminOrderStatusForm(
  formData: FormData,
): AdminOrderFormResult<{ orderId: string; status: 'shipping' | 'done' }> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const status = readFormString(formData, 'status');
  const errors: AdminOrderFieldErrors = {};

  if (!UUID_PATTERN.test(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (!SHIPPING_STATUS_SET.has(status)) errors.status = '허용된 배송 상태를 선택해주세요.';
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: { orderId, status: status as 'shipping' | 'done' },
  };
}

export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve',
): AdminOrderFormResult<{ requestId: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'reject',
): AdminOrderFormResult<{ requestId: string; reason: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve' | 'reject',
): AdminOrderFormResult<{ requestId: string; reason?: string }> {
  const requestId = readFormString(formData, 'requestId').toLowerCase();
  const errors: AdminOrderFieldErrors = {};
  if (!UUID_PATTERN.test(requestId)) errors.requestId = '청약철회 요청을 찾을 수 없습니다.';

  if (decision === 'reject') {
    const reason = readFormString(formData, 'reason');
    if (reason.length < 10 || reason.length > 200) {
      errors.reason = '거절 사유를 10자 이상 200자 이하로 입력해주세요.';
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { requestId, reason } };
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { requestId } };
}

export function adminOrdersHref(
  filters: AdminOrderFilters,
  overrides: Partial<Pick<AdminOrderFilters, 'orderId' | 'page'>> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams({ section: 'orders' });
  if (next.status !== 'all') params.set('status', next.status);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  if (next.orderId) params.set('order', next.orderId);
  return `/admin?${params.toString()}`;
}
