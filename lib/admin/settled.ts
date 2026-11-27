import {
  orderWithdrawalDaysRemaining,
  orderWithdrawalDeadline,
} from '@/lib/orders/withdrawal';
import { appendSalesListOptions, normalizeSalesListOptions, salesDateField, salesPage, salesParam, SALES_ORDER_SEARCH_FIELDS, type SalesDateField, type SalesListOptions, type SalesOrderSearchField } from './sales-list';

/** 거래확정 내역과, 배송완료일 기준으로 따로 남는 하자 반품·교환 기한을 조회한다. */

export interface AdminSettledFilters extends SalesListOptions {
  from: string | null;
  to: string | null;
  query: string;
  page: number;
  dateField?: SalesDateField;
  field?: Exclude<SalesOrderSearchField, 'all'>;
}

export interface AdminSettledOrderRow {
  orderNumber?: string;
  id: string;
  buyerName: string;
  createdAt: string;
  deliveredAt: string | null;
  doneAt: string | null;
  total: number;
}

export interface AdminSettledConsoleData {
  filters: AdminSettledFilters;
  rows: AdminSettledOrderRow[];
  pageSize: number;
  total: number;
}

export const ADMIN_SETTLED_PAGE_SIZE = 50;

export interface AdminDefectClaimWindow {
  /** 하자 클레임 마감 시각. 공급 기록이 없으면 `null`. */
  deadline: Date | null;
  /** 남은 일수. 이미 지났으면 0, 공급 기록이 없으면 `null`. */
  daysRemaining: number | null;
  /** 지금 하자 클레임을 받을 수 있는지. */
  open: boolean;
}

/**
 * 하자 클레임(공급받은 날부터 3개월) 잔여 기한.
 *
 * 규칙 자체는 `lib/orders/withdrawal`이 갖는다 — DB의
 * `order_withdrawal_deadline_passed`와 한 벌이어야 하는 계산을 어드민 쪽에 복제하면
 * 화면과 서버가 서로 다른 날짜를 말하게 된다. 여기서는 화면이 쓰기 좋은 모양으로만
 * 다시 싼다.
 *
 * `delivered_at`이 비어 있는 주문은 사다리 도입 전에 만들어졌거나 백필되지 않은
 * 행이다. 그때는 기한을 지어내지 않고 `null`로 남겨 운영자가 원장을 직접 보게 한다 —
 * 추측한 기산점으로 "기한 지남"을 띄우면 정당한 클레임을 거절하는 근거가 된다.
 */
export function adminDefectClaimWindow(
  deliveredAt: string | null,
  now: Date,
): AdminDefectClaimWindow {
  const deadline = orderWithdrawalDeadline(deliveredAt, 'defect');
  const daysRemaining = orderWithdrawalDaysRemaining(deliveredAt, 'defect', now);

  return {
    deadline,
    daysRemaining,
    open: daysRemaining !== null && daysRemaining > 0,
  };
}

/** '하자 반품·교환 기한' 칸 문구. 배송완료일이 없으면 남은 기간을 지어내지 않는다. */
export function adminDefectClaimLabel(window: AdminDefectClaimWindow) {
  if (window.daysRemaining === null) return '배송완료일 없음';
  return window.open ? `${window.daysRemaining}일 남음` : '끝남';
}

/**
 * 거래확정 내역 머리에 보이는 자동 거래확정 상태. 정책 화면(`/admin/sales/settled/policy`)으로 가는 버튼이 함께 쓴다.
 * `null`은 정책을 읽지 못한 경우다.
 */
export type AdminSettledAutoConfirmation = { enabled: boolean; afterDays: number | null } | null;

type SearchParamValue = string | string[] | undefined;
type AdminSettledSearchParams = Record<string, SearchParamValue>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export function normalizeAdminSettledFilters(
  searchParams: AdminSettledSearchParams,
): AdminSettledFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const listOptions = normalizeSalesListOptions(searchParams);
  const rawQuery = singleParam(searchParams.query).trim();
  const field = salesParam(searchParams, 'field');

  return {
    ...listOptions,
    ...(salesDateField(searchParams) ? { dateField: salesDateField(searchParams) } : {}),
    ...(field !== 'all' && SALES_ORDER_SEARCH_FIELDS.some(option => option.value === field)
      ? { field: field as AdminSettledFilters['field'] } : {}),
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    page: salesPage(searchParams.page, listOptions.pageSize ?? ADMIN_SETTLED_PAGE_SIZE),
  };
}

export function adminSettledHref(
  filters: AdminSettledFilters,
  overrides: Partial<AdminSettledFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  appendSalesListOptions(params, next);
  if (next.dateField) params.set('dateField', next.dateField);
  if (next.field) params.set('field', next.field);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  return `/admin/sales/settled?${params.toString()}`;
}
