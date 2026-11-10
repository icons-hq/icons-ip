import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { customerServicePageSize } from './customer-service-list';
import type { InquirySatisfactionSummary, InquirySatisfactionValue } from '../inquiry-satisfaction';
import {
  ADMIN_INQUIRY_STATUS_LABELS,
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_IDS,
  INQUIRY_STATUSES,
  type InquiryCategory,
  type InquiryStatus,
} from '../inquiries';

/**
 * 어드민 1:1 문의 큐(#253).
 *
 * 필터·정렬·페이지네이션은 전부 URL에 남는다 — 운영자가 "미답변만 3페이지"를
 * 동료에게 링크로 넘길 수 있어야 하고, 새로고침으로 조건이 날아가면 안 된다.
 */

export const ADMIN_INQUIRY_PAGE_SIZE = 20;

/** 기본 상태 필터는 미답변이다. 큐 화면의 존재 이유가 "지금 답할 것"이기 때문이다. */
export const DEFAULT_ADMIN_INQUIRY_STATUS: AdminInquiryStatusFilter = 'open';

export type AdminInquiryStatusFilter = InquiryStatus | 'all';
export type AdminInquiryCategoryFilter = InquiryCategory | 'all';
export type AdminInquirySearchField = 'all' | 'title' | 'buyer' | 'order';
export type AdminInquirySatisfactionFilter = 'all' | 'satisfied' | 'dissatisfied' | 'unrated';
export const ADMIN_INQUIRY_SATISFACTION_OPTIONS = [
  { value: 'all', label: '전체' }, { value: 'satisfied', label: '만족' },
  { value: 'dissatisfied', label: '불만족' }, { value: 'unrated', label: '미평가' },
] as const;

export const ADMIN_INQUIRY_SEARCH_FIELDS: { value: AdminInquirySearchField; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'title', label: '제목' },
  { value: 'buyer', label: '구매자' },
  { value: 'order', label: '주문·문의번호' },
];

export const ADMIN_INQUIRY_STATUS_OPTIONS: { value: AdminInquiryStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...INQUIRY_STATUSES.map((status) => ({
    value: status as AdminInquiryStatusFilter,
    label: ADMIN_INQUIRY_STATUS_LABELS[status],
  })),
];

export const ADMIN_INQUIRY_CATEGORY_OPTIONS: { value: AdminInquiryCategoryFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...INQUIRY_CATEGORIES.map((category) => ({
    value: category.id as AdminInquiryCategoryFilter,
    label: adminGoodsCopy(category.label),
  })),
];

export interface AdminInquiryFilters {
  status: AdminInquiryStatusFilter;
  category: AdminInquiryCategoryFilter;
  from: string | null;
  to: string | null;
  query: string;
  field: AdminInquirySearchField;
  page: number;
  pageSize?: number;
  satisfaction?: AdminInquirySatisfactionFilter;
}

export interface AdminInquiryRow {
  orderNumber?: string;
  id: string;
  reference: number;
  category: InquiryCategory;
  title: string;
  status: InquiryStatus;
  buyerName: string;
  buyerEmail: string | null;
  orderId: string | null;
  goodId: string | null;
  goodName: string | null;
  handlerName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  waitingSince: string | null;
  createdAt: string;
  lastMessageAt: string;
  answeredAt: string | null;
  messageCount: number;
  satisfaction?: InquirySatisfactionValue;
}

export interface AdminInquiryConsoleData {
  filters: AdminInquiryFilters;
  rows: AdminInquiryRow[];
  pageSize: number;
  total: number;
  /** 상태별 건수. 0건도 그대로 싣는다 — 감추면 집계 실패와 구분되지 않는다. */
  counts: Record<InquiryStatus, number>;
  satisfactionSummary?: InquirySatisfactionSummary;
}

export interface AdminInquiryNavigation {
  position: number | null;
  total: number;
  previousHref: string | null;
  nextHref: string | null;
}

/** Use the current filtered page; an answered/removed record must not acquire a false position. */
export async function adminInquiryNavigation(
  inquiryId: string,
  data: AdminInquiryConsoleData,
  mode: 'preview' | 'detail',
  adjacentId: (offset: number) => Promise<string | null>,
): Promise<AdminInquiryNavigation> {
  const index = data.rows.findIndex((row) => row.id === inquiryId);
  if (index < 0) return { position: null, total: data.total, previousHref: null, nextHref: null };
  const offset = (data.filters.page - 1) * data.pageSize;
  const position = offset + index + 1;
  const href = mode === 'preview' ? adminInquiryPreviewHref : adminInquiryDetailHref;
  const [previous, next] = await Promise.all([
    index > 0 ? data.rows[index - 1].id : offset > 0 ? adjacentId(offset - 1) : null,
    index + 1 < data.rows.length ? data.rows[index + 1].id : position < data.total ? adjacentId(position) : null,
  ]);
  return {
    position, total: data.total,
    previousHref: previous && previous !== inquiryId ? href(previous, { ...data.filters, page: index > 0 ? data.filters.page : data.filters.page - 1 }) : null,
    nextHref: next && next !== inquiryId ? href(next, { ...data.filters, page: index + 1 < data.rows.length ? data.filters.page : data.filters.page + 1 }) : null,
  };
}

type SearchParamValue = string | string[] | undefined;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUS_FILTERS = new Set<string>(['all', ...INQUIRY_STATUSES]);
const CATEGORY_FILTERS = new Set<string>(['all', ...INQUIRY_CATEGORY_IDS]);
const SEARCH_FIELDS = new Set<string>(ADMIN_INQUIRY_SEARCH_FIELDS.map((field) => field.value));

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

/** URL 파라미터를 화면이 믿을 수 있는 필터로 좁힌다. 주문 콘솔과 같은 규율이다. */
export function normalizeAdminInquiryFilters(
  searchParams: Record<string, SearchParamValue>,
): AdminInquiryFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawStatus = singleParam(searchParams.status);
  const rawCategory = singleParam(searchParams.category);
  const rawField = singleParam(searchParams.field);
  const rawQuery = singleParam(searchParams.query).trim();
  const rawPage = Number(singleParam(searchParams.page));

  return {
    status: STATUS_FILTERS.has(rawStatus)
      ? rawStatus as AdminInquiryStatusFilter
      : DEFAULT_ADMIN_INQUIRY_STATUS,
    category: CATEGORY_FILTERS.has(rawCategory)
      ? rawCategory as AdminInquiryCategoryFilter
      : 'all',
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    field: SEARCH_FIELDS.has(rawField) ? rawField as AdminInquirySearchField : 'all',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: customerServicePageSize(searchParams.pageSize),
    satisfaction: ADMIN_INQUIRY_SATISFACTION_OPTIONS.some(option => option.value === singleParam(searchParams.satisfaction))
      ? singleParam(searchParams.satisfaction) as AdminInquirySatisfactionFilter : 'all',
  };
}

export function adminInquiryHref(
  filters: AdminInquiryFilters,
  overrides: Partial<AdminInquiryFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set('status', next.status);
  if (next.category !== 'all') params.set('category', next.category);
  if (next.satisfaction && next.satisfaction !== 'all') params.set('satisfaction', next.satisfaction);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) {
    params.set('query', next.query);
    if (next.field !== 'all') params.set('field', next.field);
  }
  params.set('page', String(next.page));
  if (next.pageSize && next.pageSize !== ADMIN_INQUIRY_PAGE_SIZE) params.set('pageSize', String(next.pageSize));
  return `/admin/cs/inquiries?${params.toString()}`;
}

/** 상세 화면으로 돌아올 때 목록 조건을 잃지 않게 필터를 그대로 실어 보낸다. */
export function adminInquiryDetailHref(inquiryId: string, filters?: AdminInquiryFilters) {
  if (!filters) return `/admin/cs/inquiries/${inquiryId}`;
  const back = adminInquiryHref(filters).split('?')[1] ?? '';
  return back
    ? `/admin/cs/inquiries/${inquiryId}?back=${encodeURIComponent(back)}`
    : `/admin/cs/inquiries/${inquiryId}`;
}

const BACK_PARAM_KEYS = ['status', 'category', 'from', 'to', 'query', 'field', 'page', 'pageSize', 'satisfaction'] as const;

export function adminInquiryPreviewHref(inquiryId: string, filters: AdminInquiryFilters) {
  return `${adminInquiryHref(filters)}&${new URLSearchParams({ inquiryId })}`;
}

/**
 * `?back=`으로 돌아온 목록 조건.
 *
 * URL에서 온 값이라 그대로 되살리지 않는다. 경로는 항상 문의 목록으로 고정하고,
 * 아는 필터 키만 통과시켜 그 값을 다시 정규화한다 — 모르는 파라미터를 실어 나르면
 * 목록 URL이 임의 입력의 운반 수단이 된다.
 */
export function adminInquiryBackHref(back: unknown) {
  if (typeof back !== 'string' || !back.trim()) return '/admin/cs/inquiries';

  const source = new URLSearchParams(back);
  const known: Record<string, string> = {};
  for (const key of BACK_PARAM_KEYS) {
    const value = source.get(key);
    if (value) known[key] = value;
  }

  return adminInquiryHref(normalizeAdminInquiryFilters(known));
}

export function adminInquiryBackFilters(back: unknown): AdminInquiryFilters {
  const href = adminInquiryBackHref(back);
  return normalizeAdminInquiryFilters(Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? '')));
}

/** 구매자 표기. 닉네임이 비면 주문 콘솔과 같은 fan_ 축약을 쓴다. */
export function adminInquiryBuyerLabel(name: string | null, userId: string) {
  return name?.trim() || `fan_${userId.slice(0, 6)}`;
}


/** 실제 대기 24시간 배지. 기존 영업일 기준 1차 답변 SLA와 별개의 운영 신호다. */
export function isAdminInquiryOverdue(
  inquiry: { status: string; waitingSince: string | null },
  now: Date = new Date(),
) {
  if (inquiry.status !== 'open' || !inquiry.waitingSince) return false;
  const since = Date.parse(inquiry.waitingSince);
  return Number.isFinite(since) && now.getTime() - since >= 24 * 60 * 60 * 1000;
}
