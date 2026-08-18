import type { OrderShipment } from '@/lib/orders/shipment';
import type { AdminOrderStatus } from './orders';

/**
 * 배송현황 관리 콘솔(#251).
 *
 * 발주·발송 콘솔이 "아직 안 나간 주문"을 보는 화면이라면 여기는 "나간 뒤"를 본다.
 * 두 화면을 하나로 합치지 않는 이유는 운영자가 하는 일이 다르기 때문이다 —
 * 발송 전에는 운송장을 넣고, 발송 후에는 도착을 확인한다.
 *
 * ## 배송완료는 왜 수동인가
 *
 * 택배사 추적 API 연동은 물류 사양 확인(#177) 뒤의 일이다. 그 전까지 `delivered`는
 * 운영자가 조회 링크로 확인하고 누르는 버튼이다. `delivered_at`은 청약철회 기산점
 * (전자상거래법 제17조)이므로 자동화가 없다고 기록을 건너뛸 수는 없다 — 비어 있으면
 * 거래확정 잡도, 하자 클레임 잔여 기한도 근거를 잃는다.
 *
 * ## 어드민 운송장은 진실원이 아니다
 *
 * 김포 창고는 WMS로 운송장을 발행한다(#177). 이 화면의 운송장은 그 결과를 옮겨
 * 적은 **운영 기록**이고, 어긋나면 WMS가 맞다.
 */

export const ADMIN_SHIPPING_TABS = [
  { id: 'transit', label: '배송중', status: 'shipping' },
  { id: 'delivered', label: '배송완료', status: 'delivered' },
] as const satisfies ReadonlyArray<{ id: string; label: string; status: AdminOrderStatus }>;

export type AdminShippingTabId = (typeof ADMIN_SHIPPING_TABS)[number]['id'];

export const DEFAULT_ADMIN_SHIPPING_TAB: AdminShippingTabId = 'transit';

export function adminShippingTab(id: AdminShippingTabId) {
  const tab = ADMIN_SHIPPING_TABS.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Unknown shipping tab: ${id}`);
  return tab;
}

/**
 * 배송이 길어졌다고 보는 기준(일).
 *
 * 국내 택배 표준 리드타임은 1~2일이다. 3일을 넘긴 건은 분실·오배송을 의심해
 * 운영자가 먼저 들여다봐야 한다 — 고객 문의가 들어온 뒤에 아는 것과 다르다.
 */
export const ADMIN_SHIPPING_STALE_DAYS = 3;

export const ADMIN_SHIPPING_PAGE_SIZE = 20;

export interface AdminShippingFilters {
  tab: AdminShippingTabId;
  from: string | null;
  to: string | null;
  query: string;
  page: number;
}

export interface AdminShippingOrderRow {
  id: string;
  buyerName: string;
  createdAt: string;
  /** 발송 시각. 사다리 도입 전 주문은 비어 있다. */
  shippedAt: string | null;
  deliveredAt: string | null;
  total: number;
  /** 택배사·운송장·조회 URL. 레지스트리에 없는 코드면 `null`이다. */
  shipment: OrderShipment | null;
}

export interface AdminShippingConsoleData {
  filters: AdminShippingFilters;
  rows: AdminShippingOrderRow[];
  pageSize: number;
  total: number;
  counts: Record<AdminShippingTabId, number>;
}

type SearchParamValue = string | string[] | undefined;
type AdminShippingSearchParams = Record<string, SearchParamValue>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAB_IDS = new Set<string>(ADMIN_SHIPPING_TABS.map((tab) => tab.id));
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** URL 파라미터를 화면이 믿을 수 있는 필터로 좁힌다. 발주·발송 콘솔과 같은 규율이다. */
export function normalizeAdminShippingFilters(
  searchParams: AdminShippingSearchParams,
): AdminShippingFilters {
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
    tab: TAB_IDS.has(rawTab) ? rawTab as AdminShippingTabId : DEFAULT_ADMIN_SHIPPING_TAB,
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function adminShippingHref(
  filters: AdminShippingFilters,
  overrides: Partial<AdminShippingFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set('tab', next.tab);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  return `/admin/sales/shipping?${params.toString()}`;
}

/**
 * 발송 후 흐른 날짜.
 *
 * 발송 기록이 없는 주문은 0일이 아니라 `null`이다 — 사다리 도입 전 행을 "오늘
 * 발송"으로 접으면 오래 떠 있는 배송이 목록에서 가장 안전해 보인다.
 */
export function adminShippingTransitDays(shippedAt: string | null, now: Date): number | null {
  if (!shippedAt) return null;
  const shipped = new Date(shippedAt);
  if (Number.isNaN(shipped.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - shipped.getTime()) / DAY_MS));
}

export function adminShippingTransitLabel(shippedAt: string | null, now: Date) {
  const days = adminShippingTransitDays(shippedAt, now);
  if (days === null) return '미기록';
  return `${days}일`;
}

/** 배송이 길어졌는지. 그리드가 이 값으로 행을 강조한다. */
export function isAdminShippingStale(shippedAt: string | null, now: Date) {
  const days = adminShippingTransitDays(shippedAt, now);
  return days !== null && days >= ADMIN_SHIPPING_STALE_DAYS;
}
