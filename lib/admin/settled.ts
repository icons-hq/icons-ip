import {
  orderWithdrawalDaysRemaining,
  orderWithdrawalDeadline,
} from '@/lib/orders/withdrawal';

/**
 * 거래확정 내역 콘솔(#250).
 *
 * `done`은 "클레임 불가"가 아니다. 변심 청약철회 창(공급받은 날부터 7일)이 닫혔다는
 * 뜻일 뿐이고, 하자·오배송은 공급받은 날부터 3개월 남아 있다. 그래서 이 화면은
 * 확정일과 함께 **하자 클레임 잔여 기한**을 함께 보여준다 — 운영자가 "확정됐으니
 * 끝난 주문"으로 읽고 반품 문의를 되돌려 보내지 않게 하는 것이 이 컬럼의 목적이다.
 *
 * 기한의 기산점은 `done_at`이 아니라 `delivered_at`이다. 확정일은 자동 잡이 찍은
 * 운영 시각이고, 법정 기산점은 재화를 공급받은 날이다(#189).
 */

export interface AdminSettledFilters {
  from: string | null;
  to: string | null;
  query: string;
  page: number;
}

export interface AdminSettledOrderRow {
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

export const ADMIN_SETTLED_PAGE_SIZE = 20;

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

/** 그리드 셀 문구. 기산점이 없으면 남은 기간을 지어내지 않는다. */
export function adminDefectClaimLabel(window: AdminDefectClaimWindow) {
  if (window.daysRemaining === null) return '공급일 미기록 · 원장 확인 필요';
  return window.open ? `가능 · ${window.daysRemaining}일 남음` : '기한 종료';
}

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

  const rawPage = Number(singleParam(searchParams.page));
  const rawQuery = singleParam(searchParams.query).trim();

  return {
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function adminSettledHref(
  filters: AdminSettledFilters,
  overrides: Partial<AdminSettledFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  return `/admin/sales/settled?${params.toString()}`;
}
