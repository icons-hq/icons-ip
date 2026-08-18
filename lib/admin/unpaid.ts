/**
 * 미입금 확인 콘솔 (#256).
 *
 * 이 화면의 일은 "돈이 들어왔는지"를 사람이 판단하고 그 판단에 근거를 붙이는
 * 것이다. 확정 자체는 DB finalizer가 하므로 여기서는 근거를 강제하는 규칙만
 * 갖는다 — 메모 없는 확정, 사유 없는 연장·취소를 폼 단계에서 막는다.
 */

export const ADMIN_UNPAID_PAGE_SIZE = 20;

/** 근거 메모 길이. DB CHECK와 같은 값이어야 폼과 RPC가 같은 것을 거절한다. */
export const ADMIN_UNPAID_MEMO_MIN = 5;
export const ADMIN_UNPAID_MEMO_MAX = 200;

export interface AdminUnpaidFilters {
  query: string;
  page: number;
  /** 상세 액션 패널을 열 주문. 없으면 목록만 보여준다. */
  selectedOrderId: string | null;
}

export interface AdminUnpaidOrderRow {
  id: string;
  buyerName: string;
  buyerId: string;
  total: number;
  createdAt: string;
  expiresAt: string | null;
  extendedAt: string | null;
  depositCode: string;
  itemSummary: string;
  attemptState: string | null;
}

export interface AdminUnpaidConsoleData {
  filters: AdminUnpaidFilters;
  rows: AdminUnpaidOrderRow[];
  pageSize: number;
  total: number;
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function normalizeAdminUnpaidFilters(
  params: Record<string, string | string[] | undefined>,
): AdminUnpaidFilters {
  const page = Number.parseInt(readParam(params, 'page'), 10);
  const selected = readParam(params, 'order').trim();
  return {
    query: readParam(params, 'q').trim().slice(0, 100),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    selectedOrderId: selected || null,
  };
}

export function adminUnpaidHref(filters: Partial<AdminUnpaidFilters>) {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  if (filters.selectedOrderId) params.set('order', filters.selectedOrderId);
  const query = params.toString();
  return query ? `/admin/sales/unpaid?${query}` : '/admin/sales/unpaid';
}

export type AdminUnpaidFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

interface AdminUnpaidReasonForm {
  orderId: string;
  reason: string;
}

/**
 * 근거 문자열 검증. 앞뒤 공백을 다듬은 뒤 길이를 본다 — 공백만 200자를 넣어
 * "근거를 남겼다"고 기록되면 감사 로그가 거짓말을 한다.
 */
export function normalizeAdminUnpaidReasonForm(
  formData: FormData,
  field: string,
  emptyMessage: string,
): AdminUnpaidFormResult<AdminUnpaidReasonForm> {
  const orderId = String(formData.get('orderId') ?? '').trim();
  if (!orderId) return { ok: false, error: '주문을 찾을 수 없습니다.' };

  const reason = String(formData.get(field) ?? '').trim();
  if (reason.length < ADMIN_UNPAID_MEMO_MIN || reason.length > ADMIN_UNPAID_MEMO_MAX) {
    return { ok: false, error: emptyMessage };
  }
  return { ok: true, value: { orderId, reason } };
}
