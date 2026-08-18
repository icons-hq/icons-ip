import type { AdminOrderItemRecord, AdminOrderStatus } from './orders';

/**
 * 발주·발송 관리 콘솔(#250).
 *
 * 탭은 사다리의 한 칸씩을 본다. 발송 대기(`confirmed`)는 목록만 열어 두고
 * 발송처리 UI는 #251이 얹는다 — 적체가 어디에 쌓였는지는 운영자가 처리 수단보다
 * 먼저 알아야 하고, 탭을 나중에 도입하면 그때까지 만들어진 링크·북마크가 깨진다.
 */
export const ADMIN_DISPATCH_TABS = [
  { id: 'new', label: '신규주문', status: 'paid' },
  { id: 'ready', label: '발송 대기', status: 'confirmed' },
] as const satisfies ReadonlyArray<{ id: string; label: string; status: AdminOrderStatus }>;

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

export interface AdminDispatchOrderRow {
  id: string;
  buyerName: string;
  createdAt: string;
  total: number;
  /** 결제사. 카드·무통장 같은 실제 결제수단은 staff 읽기 표면에 없다. */
  paymentProvider: string | null;
  items: AdminDispatchOrderItemSummary;
}

export interface AdminDispatchConsoleData {
  filters: AdminDispatchFilters;
  rows: AdminDispatchOrderRow[];
  pageSize: number;
  total: number;
  /** 탭별 건수. 0건도 그대로 싣는다 — 칩이 0을 감추면 집계 실패와 구분되지 않는다. */
  counts: Record<AdminDispatchTabId, number>;
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
