import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import type { AdminOrderItemRecord, AdminOrderStatus } from './orders';

/**
 * 발주·발송 관리 콘솔(#250·#251).
 *
 * 탭은 사다리의 한 칸씩을 본다. 발송지연만 예외로, 같은 `confirmed` 칸을 보되
 * 발주확인 후 오래 묵은 것만 남긴다.
 *
 * 발송지연을 상태로 만들지 않는 이유: 자사몰이라 지연에 붙는 페널티가 없고,
 * 사다리에 칸을 하나 더 만들면 발송처리 때 되돌려야 하는 전이가 생긴다. v1에
 * 필요한 것은 "몇 건이 늦었나"라는 지표와 "왜 늦었나"라는 메모뿐이다(#251).
 */
export const ADMIN_DISPATCH_TABS = [
  { id: 'new', label: '신규주문', status: 'paid' },
  { id: 'ready', label: '발송 대기', status: 'confirmed' },
  { id: 'delayed', label: '발송지연', status: 'confirmed', delayedOnly: true },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  status: AdminOrderStatus;
  delayedOnly?: true;
}>;

/**
 * 발송지연으로 보는 기준(일).
 *
 * 확정된 제안값이다. 자사몰이라 외부 규정이 정해 주는 숫자가 없어서, 발주확인
 * 다음 영업일 출고를 기본으로 두고 주말 하나를 얹은 값을 쓴다.
 */
export const ADMIN_DISPATCH_DELAY_DAYS = 3;

export type AdminDispatchTabId = (typeof ADMIN_DISPATCH_TABS)[number]['id'];

export const DEFAULT_ADMIN_DISPATCH_TAB: AdminDispatchTabId = 'new';

export function adminDispatchTab(id: AdminDispatchTabId) {
  const tab = ADMIN_DISPATCH_TABS.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Unknown dispatch tab: ${id}`);
  return tab;
}

export interface AdminDispatchFilters {
  tab: AdminDispatchTabId;
  from: string | null;
  to: string | null;
  query: string;
  page: number;
}

export interface AdminDispatchOrderItemSummary {
  /** 대표 품목 이름. 그리드 첫 줄에 그대로 쓴다. */
  leadName: string;
  /** 대표 품목을 뺀 나머지 품목 수. 0이면 "외 N건"을 붙이지 않는다. */
  otherCount: number;
  /** 주문 전체 수량 합. 품목 수가 아니라 개수 합이다. */
  totalQty: number;
}

/** 발송지연 메모. 운영 기록이며 구매자에게 보이지 않는다. */
export interface AdminDispatchDelayNote {
  reason: string;
  /** 발송 예정일 `YYYY-MM-DD`. 모르면 `null` — 지어낸 날짜는 CS에서 약속이 된다. */
  expectedShipDate: string | null;
  updatedAt: string;
}

export interface AdminDispatchOrderRow {
  id: string;
  buyerName: string;
  createdAt: string;
  /** 발주확인 시각. 사다리 도입 전 주문은 비어 있다. */
  confirmedAt: string | null;
  total: number;
  /** 결제사. 카드·무통장 같은 실제 결제수단은 staff 읽기 표면에 없다. */
  paymentProvider: string | null;
  items: AdminDispatchOrderItemSummary;
  delayNote: AdminDispatchDelayNote | null;
}

export interface AdminDispatchConsoleData {
  filters: AdminDispatchFilters;
  rows: AdminDispatchOrderRow[];
  pageSize: number;
  total: number;
  /** 탭별 건수. 0건도 그대로 싣는다 — 칩이 0을 감추면 집계 실패와 구분되지 않는다. */
  counts: Record<AdminDispatchTabId, number>;
  /** 행 인라인 발송처리 드롭다운이 쓰는 택배사 레지스트리(#251). */
  carriers: ShippingCarrierRegistry;
}

export const ADMIN_DISPATCH_PAGE_SIZE = 20;

type SearchParamValue = string | string[] | undefined;
type AdminDispatchSearchParams = Record<string, SearchParamValue>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAB_IDS = new Set<string>(ADMIN_DISPATCH_TABS.map((tab) => tab.id));

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

/** URL 파라미터를 화면이 믿을 수 있는 필터로 좁힌다. 주문 통합검색과 같은 규율이다. */
export function normalizeAdminDispatchFilters(
  searchParams: AdminDispatchSearchParams,
): AdminDispatchFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawPage = Number(singleParam(searchParams.page));
  const rawQuery = singleParam(searchParams.query).trim();
  const rawTab = singleParam(searchParams.tab);

  return {
    tab: TAB_IDS.has(rawTab) ? rawTab as AdminDispatchTabId : DEFAULT_ADMIN_DISPATCH_TAB,
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function adminDispatchHref(
  filters: AdminDispatchFilters,
  overrides: Partial<AdminDispatchFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set('tab', next.tab);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  return `/admin/sales/dispatch?${params.toString()}`;
}

/**
 * 굿즈 요약 — 대표 품목 하나와 나머지 건수.
 *
 * 목록에서 품목을 전부 펼치면 한 주문이 화면을 다 먹는다. 대표 품목만 보여주되
 * 수량 합은 따로 낸다 — 운영자가 발주확인 전에 확인하는 것은 "몇 개를 보내야
 * 하는가"이지 품목 가짓수가 아니다.
 */
export function adminDispatchItemSummary(
  items: readonly AdminOrderItemRecord[],
): AdminDispatchOrderItemSummary {
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  return {
    leadName: items[0]?.name ?? '품목 없음',
    otherCount: Math.max(0, items.length - 1),
    totalQty,
  };
}

/** "라이트 아크릴 외 2건" 형태의 한 줄 표기. */
export function adminDispatchItemLabel(summary: AdminDispatchOrderItemSummary) {
  return summary.otherCount > 0
    ? `${summary.leadName} 외 ${summary.otherCount}건`
    : summary.leadName;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 주문이 접수된 뒤 흐른 시간.
 *
 * 신규주문 탭의 존재 이유가 적체 파악이라 분 단위 정확도는 필요 없다. 대신 하루가
 * 넘어간 주문은 "1일"이 아니라 일 단위로 계속 커져야 한다 — 3일 묵은 주문과
 * 어제 주문이 같은 문구로 보이면 목록을 정렬해 봐야 소용이 없다.
 */
export function adminDispatchElapsedLabel(createdAt: string, now: Date) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return '-';

  const elapsed = now.getTime() - created.getTime();
  /* 시계 오차나 미래 타임스탬프를 음수로 흘리지 않는다. */
  if (elapsed < MINUTE_MS) return '방금';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}분`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}시간`;
  return `${Math.floor(elapsed / DAY_MS)}일`;
}

/**
 * 발주확인 후 흐른 날짜.
 *
 * 발송 대기 목록의 관심사는 시·분이 아니라 "며칠 묵었나"다. 발주확인 기록이 없는
 * 주문(사다리 도입 전 행)은 0일이 아니라 `null`이다 — 없는 기산점을 0으로 접으면
 * 방금 발주확인한 주문과 구분되지 않는다.
 */
export function adminDispatchConfirmedDays(confirmedAt: string | null, now: Date): number | null {
  if (!confirmedAt) return null;
  const confirmed = new Date(confirmedAt);
  if (Number.isNaN(confirmed.getTime())) return null;

  const elapsed = now.getTime() - confirmed.getTime();
  /* 시계 오차나 미래 타임스탬프를 음수로 흘리지 않는다. */
  return Math.max(0, Math.floor(elapsed / DAY_MS));
}

/** 그리드 셀 문구. 기산점이 없으면 경과일을 지어내지 않는다. */
export function adminDispatchConfirmedDaysLabel(confirmedAt: string | null, now: Date) {
  const days = adminDispatchConfirmedDays(confirmedAt, now);
  if (days === null) return '미기록';
  return `${days}일`;
}

/** 발송지연 여부. 임계값(3일) 이상 묵었으면 지연이다. */
export function isAdminDispatchDelayed(confirmedAt: string | null, now: Date) {
  const days = adminDispatchConfirmedDays(confirmedAt, now);
  return days !== null && days >= ADMIN_DISPATCH_DELAY_DAYS;
}

/**
 * 지연 목록의 경계 시각.
 *
 * DB는 `confirmed_at < 이 시각`으로 거른다. 며칠을 지연으로 볼지는 운영 정책이라
 * 경계 계산을 앱에 두고 DB 함수에는 절대 시각만 넘긴다 — 정책이 바뀔 때
 * 마이그레이션을 요구하지 않는다.
 */
export function adminDispatchDelayThreshold(now: Date) {
  return new Date(now.getTime() - ADMIN_DISPATCH_DELAY_DAYS * DAY_MS);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** DB의 order_dispatch_delays_reason_check와 같은 상한이다. */
export const ADMIN_DISPATCH_DELAY_REASON_MAX = 500;

export interface AdminDispatchDelayFormValue {
  orderId: string;
  /** 비우면 메모를 지운다 — "지연이 풀렸다"를 표현할 방법이 필요하다. */
  reason: string | null;
  expectedShipDate: string | null;
}

export type AdminDispatchDelayFormResult =
  | { ok: true; value: AdminDispatchDelayFormValue }
  | { ok: false; errors: Record<string, string> };

/**
 * 지연 메모 폼 정규화.
 *
 * 발송 예정일은 선택 입력이다. 모르는 날짜를 지어내면 CS에서 그대로 약속이 되므로,
 * 비워 두는 것이 정상 경로여야 한다. 형식이 깨진 날짜는 조용히 버리지 않고 되돌린다 —
 * 운영자가 적은 날짜가 사라지면 저장된 줄 안다.
 */
export function normalizeAdminDispatchDelayForm(formData: FormData): AdminDispatchDelayFormResult {
  const orderId = String(formData.get('orderId') ?? '').trim().toLowerCase();
  const rawReason = String(formData.get('reason') ?? '').trim();
  const rawDate = String(formData.get('expectedShipDate') ?? '').trim();
  const errors: Record<string, string> = {};

  if (!UUID_PATTERN.test(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (rawReason.length > ADMIN_DISPATCH_DELAY_REASON_MAX) {
    errors.reason = `지연 사유는 ${ADMIN_DISPATCH_DELAY_REASON_MAX}자까지 입력할 수 있습니다.`;
  }
  if (rawDate && !validCalendarDate(rawDate)) {
    errors.expectedShipDate = '발송 예정일을 YYYY-MM-DD 형식으로 입력해주세요.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      orderId,
      reason: rawReason || null,
      expectedShipDate: rawReason ? rawDate || null : null,
    },
  };
}
