/**
 * 미입금 확인 콘솔 (#256).
 *
 * 이 화면의 일은 "돈이 들어왔는지"를 사람이 판단하고 그 판단에 근거를 붙이는
 * 것이다. 확정 자체는 DB finalizer가 하므로 여기서는 근거를 강제하는 규칙만
 * 갖는다 — 메모 없는 확정, 사유 없는 연장·취소를 폼 단계에서 막는다.
 */

import type { BankDepositConfidence } from '@/lib/payments/bank-deposit-feed';
import { appendSalesListOptions, normalizeSalesListOptions, salesPage, salesParam, type SalesListOptions } from './sales-list';

export const ADMIN_UNPAID_PAGE_SIZE = 20;

/** 근거 메모 길이. DB CHECK와 같은 값이어야 폼과 RPC가 같은 것을 거절한다. */
export const ADMIN_UNPAID_MEMO_MIN = 5;
export const ADMIN_UNPAID_MEMO_MAX = 200;

export interface AdminUnpaidFilters extends SalesListOptions {
  query: string;
  page: number;
  /** 상세 액션 패널을 열 주문. 없으면 목록만 보여준다. */
  selectedOrderId: string | null;
  state?: 'prepared' | 'confirming' | 'needs_review' | 'unknown' | 'missing';
}

export interface AdminUnpaidOrderRow {
  orderNumber?: string;
  id: string;
  buyerName: string;
  buyerId: string;
  /** 배송지 수령인. 안내한 입금자명을 콘솔에서 다시 만들기 위한 값이다. */
  recipientName: string;
  total: number;
  createdAt: string;
  expiresAt: string | null;
  extendedAt: string | null;
  depositCode: string;
  itemSummary: string;
  attemptState: string | null;
}

/**
 * 계좌수집 입금 내역 한 건 (#257). 확정은 여전히 사람이 누른다 — `suggested*`는
 * 제안일 뿐이고, 콘솔은 확신도를 그대로 보여 준다.
 */
export interface AdminBankDepositRow {
  id: string;
  source: string;
  externalId: string;
  depositedAt: string;
  depositorName: string;
  amount: number;
  rawReference: string | null;
  suggestedOrderId: string | null;
  suggestedOrderCode: string | null;
  suggestedConfidence: BankDepositConfidence | null;
}

export interface AdminUnpaidConsoleData {
  filters: AdminUnpaidFilters;
  rows: AdminUnpaidOrderRow[];
  pageSize: number;
  total: number;
  /** 미매칭 입금 큐. 어댑터가 없으면 항상 비어 있다(#255). */
  deposits: AdminBankDepositRow[];
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
  const listOptions = normalizeSalesListOptions(params, ADMIN_UNPAID_PAGE_SIZE, 'oldest');
  const selected = readParam(params, 'order').trim();
  return {
    ...listOptions,
    ...(['prepared', 'confirming', 'needs_review', 'unknown', 'missing'].includes(salesParam(params, 'state'))
      ? { state: salesParam(params, 'state') as AdminUnpaidFilters['state'] } : {}),
    query: readParam(params, 'q').trim().slice(0, 100),
    page: salesPage(params.page, listOptions.pageSize ?? ADMIN_UNPAID_PAGE_SIZE),
    selectedOrderId: selected || null,
  };
}

export function adminUnpaidHref(filters: Partial<AdminUnpaidFilters>) {
  const params = new URLSearchParams();
  appendSalesListOptions(params, filters);
  if (filters.state) params.set('state', filters.state);
  if (filters.query) params.set('q', filters.query);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  if (filters.selectedOrderId) params.set('order', filters.selectedOrderId);
  const query = params.toString();
  return query ? `/admin/sales/unpaid?${query}` : '/admin/sales/unpaid';
}

/**
 * attempt 상태를 운영자 문구로. `prepared`가 정상적인 입금 대기이고, 그 밖의
 * 값은 확정이 중간에 멈춘 것이라 눈에 띄어야 한다. 화면(표·결제상태 조건)과 목록 엑셀이 같은 말을 쓴다.
 * 표의 상태와 조건의 선택지는 이 표 하나에서 이름을 가져온다 — 같은 상태를 두 이름으로 부르지 않는다.
 */
const ATTEMPT_STATE_LABELS: Record<string, string> = {
  prepared: '입금 대기',
  confirming: '입금 확인 처리 중',
  needs_review: '결제 확인 필요',
  unknown: '결과 미확인',
  /* 토스 가상계좌 입금 대기(ADR-0049). 이 목록은 자체 계좌 무통장 주문만 싣지만, 시도 상태를 모르는 값으로 보이지 않게 이름을 둔다. */
  awaiting_deposit: '입금 대기(가상계좌)',
};

export function adminUnpaidAttemptStateLabel(state: string | null) {
  if (!state) return '결제 기록 없음';
  /* 모르는 값은 영문 상태값을 그대로 내보이지 않는다. 이름이 있는 값만 골라 읽는다(Object.prototype 이름이 상태로 읽히지 않게). */
  return Object.hasOwn(ATTEMPT_STATE_LABELS, state) ? ATTEMPT_STATE_LABELS[state]! : '확인 필요';
}

/**
 * 결제상태 조건의 선택지. 값은 목록 조회가 받는 상태와 같고(`normalizeAdminUnpaidFilters`), 이름은 표의 상태 이름과 같은 표에서 가져온다.
 * 결제 기록이 없는 주문(`missing`)은 시도 상태가 비어 있는 줄이다.
 */
const STATE_FILTER_VALUES = ['prepared', 'confirming', 'needs_review', 'unknown', 'missing'] as const;

export function adminUnpaidStateFilterOptions(): readonly { value: string; label: string }[] {
  return [
    { value: '', label: '전체' },
    ...STATE_FILTER_VALUES.map((value) => ({ value, label: adminUnpaidAttemptStateLabel(value === 'missing' ? null : value) })),
  ];
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
 * "근거를 남겼다"고 기록되면 감사 로그가 거짓말을 한다. 경계값은 DB CHECK와
 * 같은 값이어야 폼과 RPC가 같은 것을 거절한다.
 */
export function normalizeAdminUnpaidReason(
  value: FormDataEntryValue | null,
  invalidMessage: string,
): AdminUnpaidFormResult<string> {
  const reason = String(value ?? '').trim();
  if (reason.length < ADMIN_UNPAID_MEMO_MIN || reason.length > ADMIN_UNPAID_MEMO_MAX) {
    return { ok: false, error: invalidMessage };
  }
  return { ok: true, value: reason };
}

export function normalizeAdminUnpaidReasonForm(
  formData: FormData,
  field: string,
  emptyMessage: string,
): AdminUnpaidFormResult<AdminUnpaidReasonForm> {
  const orderId = String(formData.get('orderId') ?? '').trim();
  if (!orderId) return { ok: false, error: '주문을 찾을 수 없습니다.' };

  const reason = normalizeAdminUnpaidReason(formData.get(field), emptyMessage);
  if (!reason.ok) return reason;
  return { ok: true, value: { orderId, reason: reason.value } };
}
