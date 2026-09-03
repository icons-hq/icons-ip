import type { AdminGoodRecord, AdminIpRecord } from './catalog.server';
import { GOOD_TYPES } from '../goods-taxonomy';

/**
 * 카탈로그(IP·굿즈) 목록 — 상태 탭·검색·필터·정렬·페이지.
 *
 * 판매·CS 콘솔과 같은 규칙이다: 조건은 전부 URL에 남고, 이 모듈은 URL 값을 믿을 수
 * 있는 값으로 좁힌 뒤 메모리의 레코드 배열에 적용한다. 카탈로그는 한 번에 전부
 * 불러오므로(수백 건) 서버 RPC 없이 여기서 자른다 — 1만 건 규모가 되면 같은 필터
 * 계약을 그대로 RPC 페이지네이션으로 옮긴다.
 *
 * `selected`는 목록에서 편집으로 들어가는 딥링크(`?selected=g100`)다. 카드 화면의
 * `?cardId=`와 같은 자리이며, `new`는 빈 등록 폼을 뜻한다.
 */

export const ADMIN_CATALOG_PAGE_SIZES = [20, 50, 100, 200] as const;
export const ADMIN_CATALOG_DEFAULT_PAGE_SIZE = 20;
/** `?selected=new` — 기존 레코드가 아니라 빈 등록 폼. */
export const ADMIN_CATALOG_NEW_RECORD = 'new';

export type AdminCatalogSortDirection = 'asc' | 'desc';

type SearchParamValue = string | string[] | undefined;
export type AdminCatalogSearchQuery = Record<string, SearchParamValue>;

const SELECTED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const QUERY_MAX_LENGTH = 100;

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickOption<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizePage(value: string) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

function normalizeSize(value: string) {
  const size = Number.parseInt(value, 10);
  return (ADMIN_CATALOG_PAGE_SIZES as readonly number[]).includes(size)
    ? size
    : ADMIN_CATALOG_DEFAULT_PAGE_SIZE;
}

function normalizeSelected(value: string) {
  return SELECTED_PATTERN.test(value) ? value : null;
}

function normalizeDirection(value: string): AdminCatalogSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

function contains(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle);
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ko');
}

/** 정렬 키가 같은 행은 원래 순서를 지킨다 — 정렬을 걸어도 목록이 뒤섞이지 않는다. */
function sortRows<T>(
  rows: readonly T[],
  direction: AdminCatalogSortDirection,
  valueOf: (row: T) => string | number,
): T[] {
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => sign * compareValues(a.value, b.value) || a.index - b.index)
    .map((entry) => entry.row);
}

function paginate<T>(rows: readonly T[], page: number, size: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, totalPages);
  return {
    page: current,
    rows: rows.slice((current - 1) * size, current * size),
    total: rows.length,
  };
}

/** 기본값과 같은 조건은 URL에서 뺀다 — `/admin/catalog/goods`가 곧 "전체 목록 1페이지"다. */
function buildHref(
  pathname: string,
  params: Record<string, string | number | null | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function countByTab<Tab extends string>(
  tabs: readonly Tab[],
  rows: readonly { tab: Tab }[],
): Record<Tab | 'all', number> {
  const counts = Object.fromEntries(tabs.map((tab) => [tab, 0])) as Record<Tab | 'all', number>;
  for (const row of rows) counts[row.tab] += 1;
  counts.all = rows.length;
  return counts;
}

/* ------------------------------------------------------------------------- */
/* 굿즈                                                                       */
/* ------------------------------------------------------------------------- */

export const ADMIN_GOOD_LIST_PATH = '/admin/catalog/goods';

export const ADMIN_GOOD_LIST_TABS = ['all', 'selling', 'low', 'soldout', 'archived'] as const;
export type AdminGoodListTab = (typeof ADMIN_GOOD_LIST_TABS)[number];
export type AdminGoodStatus = Exclude<AdminGoodListTab, 'all'>;

export const ADMIN_GOOD_LIST_TAB_LABELS: Record<AdminGoodListTab, string> = {
  all: '전체',
  selling: '판매중',
  low: '재고 부족',
  soldout: '품절',
  archived: '보관',
};

export const ADMIN_GOOD_STOCK_FILTERS = ['all', 'ok', 'low', 'soldout', 'zero'] as const;
export type AdminGoodStockFilter = (typeof ADMIN_GOOD_STOCK_FILTERS)[number];

export const ADMIN_GOOD_STOCK_OPTIONS: { value: AdminGoodStockFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'ok', label: '운영 상태 ok' },
  { value: 'low', label: '운영 상태 low' },
  { value: 'soldout', label: '운영 상태 soldout' },
  { value: 'zero', label: '수량 0' },
];

export const ADMIN_GOOD_SEARCH_FIELDS_LIST = ['all', 'name', 'id', 'ip'] as const;
export type AdminGoodSearchField = (typeof ADMIN_GOOD_SEARCH_FIELDS_LIST)[number];

export const ADMIN_GOOD_SEARCH_FIELDS: { value: AdminGoodSearchField; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'name', label: '굿즈 이름' },
  { value: 'id', label: 'ID' },
  { value: 'ip', label: 'IP' },
];

export const ADMIN_GOOD_SORT_KEYS = ['id', 'name', 'ip', 'price', 'stockQty'] as const;
export type AdminGoodSortKey = (typeof ADMIN_GOOD_SORT_KEYS)[number];

export interface AdminGoodListFilters {
  tab: AdminGoodListTab;
  /** IP id. 비면 전체. */
  ip: string;
  /** 굿즈 유형(GOOD_TYPES). 비면 전체. */
  type: string;
  stock: AdminGoodStockFilter;
  field: AdminGoodSearchField;
  query: string;
  sort: AdminGoodSortKey | null;
  dir: AdminCatalogSortDirection;
  page: number;
  size: number;
  /** 편집 중인 레코드 id 또는 `new`. 없으면 목록 화면. */
  selected: string | null;
}

export interface AdminGoodListRow {
  good: AdminGoodRecord;
  ipTitle: string;
  tab: AdminGoodStatus;
}

export interface AdminGoodList {
  rows: AdminGoodListRow[];
  /** 검색·필터·탭을 모두 적용한 건수(페이지 자르기 전). */
  total: number;
  /** 검색·필터만 적용하고 탭은 적용하지 않은 상태별 건수 — 탭 칩이 "이 검색 안에서" 몇 건인지 보여준다. */
  counts: Record<AdminGoodListTab, number>;
  page: number;
  size: number;
}

export function normalizeAdminGoodListFilters(query: AdminCatalogSearchQuery): AdminGoodListFilters {
  const type = singleParam(query.type);
  const sort = singleParam(query.sort);

  return {
    tab: pickOption(singleParam(query.tab), ADMIN_GOOD_LIST_TABS, 'all'),
    ip: normalizeSelected(singleParam(query.ip)) ?? '',
    type: (GOOD_TYPES as readonly string[]).includes(type) ? type : '',
    stock: pickOption(singleParam(query.stock), ADMIN_GOOD_STOCK_FILTERS, 'all'),
    field: pickOption(singleParam(query.field), ADMIN_GOOD_SEARCH_FIELDS_LIST, 'all'),
    query: singleParam(query.query).slice(0, QUERY_MAX_LENGTH),
    sort: (ADMIN_GOOD_SORT_KEYS as readonly string[]).includes(sort) ? (sort as AdminGoodSortKey) : null,
    dir: normalizeDirection(singleParam(query.dir)),
    page: normalizePage(singleParam(query.page)),
    size: normalizeSize(singleParam(query.size)),
    selected: normalizeSelected(singleParam(query.selected)),
  };
}

export function adminGoodListHref(
  filters: AdminGoodListFilters,
  patch: Partial<AdminGoodListFilters> = {},
) {
  const next = { ...filters, ...patch };
  return buildHref(ADMIN_GOOD_LIST_PATH, {
    tab: next.tab === 'all' ? null : next.tab,
    ip: next.ip,
    type: next.type,
    stock: next.stock === 'all' ? null : next.stock,
    field: next.field === 'all' ? null : next.field,
    query: next.query,
    sort: next.sort,
    dir: next.sort && next.dir === 'desc' ? 'desc' : null,
    page: next.page > 1 ? next.page : null,
    size: next.size === ADMIN_CATALOG_DEFAULT_PAGE_SIZE ? null : next.size,
    selected: next.selected,
  });
}

/**
 * 목록 상태. 보관이 가장 먼저고, 수량 0은 운영 상태와 무관하게 품절이다 —
 * 공개 화면이 수량 0을 자동 품절로 그리는 것과 같은 규칙(GoodSection의 유효 표시 상태).
 */
export function adminGoodStatus(good: Pick<AdminGoodRecord, 'archivedAt' | 'stock' | 'stockQty'>): AdminGoodStatus {
  if (good.archivedAt) return 'archived';
  if (good.stock === 'soldout' || good.stockQty <= 0) return 'soldout';
  if (good.stock === 'low') return 'low';
  return 'selling';
}

function matchesStockFilter(good: AdminGoodRecord, filter: AdminGoodStockFilter) {
  if (filter === 'all') return true;
  if (filter === 'zero') return good.stockQty <= 0;
  return good.stock === filter;
}

function matchesGoodSearch(
  good: AdminGoodRecord,
  ipTitle: string,
  field: AdminGoodSearchField,
  needle: string,
) {
  if (!needle) return true;
  const byName = () => contains(good.name, needle);
  const byId = () => contains(good.id, needle);
  const byIp = () => contains(ipTitle, needle) || contains(good.ipId, needle);
  if (field === 'name') return byName();
  if (field === 'id') return byId();
  if (field === 'ip') return byIp();
  return byName() || byId() || byIp();
}

function goodSortValue(row: AdminGoodListRow, key: AdminGoodSortKey): string | number {
  if (key === 'ip') return row.ipTitle;
  if (key === 'price' || key === 'stockQty') return row.good[key];
  return row.good[key];
}

export function buildAdminGoodList(
  goods: readonly AdminGoodRecord[],
  ips: readonly Pick<AdminIpRecord, 'id' | 'title'>[],
  filters: AdminGoodListFilters,
): AdminGoodList {
  const ipTitles = new Map(ips.map((ip) => [ip.id, ip.title]));
  const needle = filters.query.toLowerCase();

  const searched: AdminGoodListRow[] = [];
  for (const good of goods) {
    if (filters.ip && good.ipId !== filters.ip) continue;
    if (filters.type && good.type !== filters.type) continue;
    if (!matchesStockFilter(good, filters.stock)) continue;
    const ipTitle = ipTitles.get(good.ipId) ?? good.ipId;
    if (!matchesGoodSearch(good, ipTitle, filters.field, needle)) continue;
    searched.push({ good, ipTitle, tab: adminGoodStatus(good) });
  }

  const counts = countByTab(ADMIN_GOOD_LIST_TABS.filter((tab) => tab !== 'all'), searched);
  const tabbed = filters.tab === 'all' ? searched : searched.filter((row) => row.tab === filters.tab);
  const sorted = filters.sort
    ? sortRows(tabbed, filters.dir, (row) => goodSortValue(row, filters.sort as AdminGoodSortKey))
    : tabbed;
  const paged = paginate(sorted, filters.page, filters.size);

  return { rows: paged.rows, total: paged.total, counts, page: paged.page, size: filters.size };
}

/* ------------------------------------------------------------------------- */
/* IP                                                                         */
/* ------------------------------------------------------------------------- */

export const ADMIN_IP_LIST_PATH = '/admin/catalog/ips';

export const ADMIN_IP_LIST_TABS = ['all', 'active', 'archived'] as const;
export type AdminIpListTab = (typeof ADMIN_IP_LIST_TABS)[number];
export type AdminIpStatus = Exclude<AdminIpListTab, 'all'>;

export const ADMIN_IP_LIST_TAB_LABELS: Record<AdminIpListTab, string> = {
  all: '전체',
  active: '운영 중',
  archived: '보관',
};

export const ADMIN_IP_SORT_KEYS = ['id', 'title', 'goods', 'fans'] as const;
export type AdminIpSortKey = (typeof ADMIN_IP_SORT_KEYS)[number];

export interface AdminIpListFilters {
  tab: AdminIpListTab;
  /** 버티컬 key. 비면 전체. */
  vertical: string;
  query: string;
  sort: AdminIpSortKey | null;
  dir: AdminCatalogSortDirection;
  page: number;
  size: number;
  selected: string | null;
}

export interface AdminIpListRow {
  ip: AdminIpRecord;
  tab: AdminIpStatus;
  verticalLabel: string;
  /** 보관 굿즈까지 센 수. */
  goodsCount: number;
  /** 보관되지 않은 굿즈 수. */
  activeGoodsCount: number;
}

export interface AdminIpList {
  rows: AdminIpListRow[];
  total: number;
  counts: Record<AdminIpListTab, number>;
  page: number;
  size: number;
}

export function normalizeAdminIpListFilters(query: AdminCatalogSearchQuery): AdminIpListFilters {
  const sort = singleParam(query.sort);

  return {
    tab: pickOption(singleParam(query.tab), ADMIN_IP_LIST_TABS, 'all'),
    vertical: normalizeSelected(singleParam(query.vertical)) ?? '',
    query: singleParam(query.query).slice(0, QUERY_MAX_LENGTH),
    sort: (ADMIN_IP_SORT_KEYS as readonly string[]).includes(sort) ? (sort as AdminIpSortKey) : null,
    dir: normalizeDirection(singleParam(query.dir)),
    page: normalizePage(singleParam(query.page)),
    size: normalizeSize(singleParam(query.size)),
    selected: normalizeSelected(singleParam(query.selected)),
  };
}

export function adminIpListHref(
  filters: AdminIpListFilters,
  patch: Partial<AdminIpListFilters> = {},
) {
  const next = { ...filters, ...patch };
  return buildHref(ADMIN_IP_LIST_PATH, {
    tab: next.tab === 'all' ? null : next.tab,
    vertical: next.vertical,
    query: next.query,
    sort: next.sort,
    dir: next.sort && next.dir === 'desc' ? 'desc' : null,
    page: next.page > 1 ? next.page : null,
    size: next.size === ADMIN_CATALOG_DEFAULT_PAGE_SIZE ? null : next.size,
    selected: next.selected,
  });
}

export function adminIpStatus(ip: Pick<AdminIpRecord, 'archivedAt'>): AdminIpStatus {
  return ip.archivedAt ? 'archived' : 'active';
}

function ipSortValue(row: AdminIpListRow, key: AdminIpSortKey): string | number {
  if (key === 'goods') return row.activeGoodsCount;
  if (key === 'fans') return row.ip.fansCount;
  return row.ip[key];
}

export function buildAdminIpList(
  ips: readonly AdminIpRecord[],
  goods: readonly Pick<AdminGoodRecord, 'ipId' | 'archivedAt'>[],
  verticals: readonly { key: string; label: string }[],
  filters: AdminIpListFilters,
): AdminIpList {
  const verticalLabels = new Map(verticals.map((vertical) => [vertical.key, vertical.label]));
  const goodsCounts = new Map<string, { all: number; active: number }>();
  for (const good of goods) {
    const entry = goodsCounts.get(good.ipId) ?? { all: 0, active: 0 };
    entry.all += 1;
    if (!good.archivedAt) entry.active += 1;
    goodsCounts.set(good.ipId, entry);
  }
  const needle = filters.query.toLowerCase();

  const searched: AdminIpListRow[] = [];
  for (const ip of ips) {
    if (filters.vertical && ip.verticalKey !== filters.vertical) continue;
    if (needle && !contains(ip.title, needle) && !contains(ip.id, needle)) continue;
    const count = goodsCounts.get(ip.id) ?? { all: 0, active: 0 };
    searched.push({
      ip,
      tab: adminIpStatus(ip),
      verticalLabel: verticalLabels.get(ip.verticalKey) ?? ip.verticalKey,
      goodsCount: count.all,
      activeGoodsCount: count.active,
    });
  }

  const counts = countByTab(ADMIN_IP_LIST_TABS.filter((tab) => tab !== 'all'), searched);
  const tabbed = filters.tab === 'all' ? searched : searched.filter((row) => row.tab === filters.tab);
  const sorted = filters.sort
    ? sortRows(tabbed, filters.dir, (row) => ipSortValue(row, filters.sort as AdminIpSortKey))
    : tabbed;
  const paged = paginate(sorted, filters.page, filters.size);

  return { rows: paged.rows, total: paged.total, counts, page: paged.page, size: filters.size };
}
