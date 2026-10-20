/**
 * 어드민 상품 Q&A 콘솔 (S8 #330).
 *
 * 리뷰 콘솔(#254)과 같은 목록 구조를 따른다: 필터 패널 → 카운트 칩 → 그리드.
 * 필터와 페이지는 전부 URL에 남는다 — 운영자가 "미답변 2페이지"를 동료에게 링크로
 * 넘길 수 있어야 하고, 새로고침으로 조건이 날아가면 안 된다.
 *
 * 비공개 1:1 **문의**와 섞지 않는다. 상품 Q&A는 굿즈 상세에 공개로 붙는 구매 전
 * 질문이고, 답변도 공개된다(CONTEXT.md). 두 콘솔의 어휘가 섞이면 운영자가 공개
 * 표면에 1:1 답변 문구를 그대로 쓴다.
 *
 * 판정은 서버가 한다. 여기 있는 것은 URL을 신뢰할 수 있는 값으로 좁히는 일뿐이다.
 */

import { customerServiceDate, customerServicePageSize } from './customer-service-list';

export const ADMIN_PRODUCT_QUESTION_PAGE_SIZE = 20;
export type AdminProductQuestionSearchField = 'body' | 'good' | 'goodId' | 'id';
export const ADMIN_PRODUCT_QUESTION_SEARCH_FIELDS = [
  { value: 'body', label: '문의 내용' },
  { value: 'good', label: '상품명' },
  { value: 'goodId', label: '상품번호' },
  { value: 'id', label: '문의번호' },
] as const;
export const ADMIN_PRODUCT_QUESTION_SORT_OPTIONS = [
  { value: 'recent', label: '문의등록일 최신순' },
  { value: 'oldest', label: '문의등록일 오래된순' },
] as const;

export type AdminProductQuestionStatusFilter = 'all' | 'unanswered' | 'answered' | 'hidden';

export const ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS: {
  value: AdminProductQuestionStatusFilter;
  label: string;
}[] = [
  { value: 'all', label: '전체' },
  { value: 'unanswered', label: '답변 미등록' },
  { value: 'answered', label: '답변 완료' },
  { value: 'hidden', label: '비노출' },
];

export interface AdminProductQuestionFilters {
  status: AdminProductQuestionStatusFilter;
  page: number;
  from?: string | null;
  to?: string | null;
  query?: string;
  field?: AdminProductQuestionSearchField;
  sort?: 'recent' | 'oldest';
  pageSize?: number;
}

export interface AdminProductQuestionRow {
  id: string;
  goodId: string;
  goodName: string;
  /** 현재 상품 대표 이미지. 등록하지 않았거나 조회할 수 없으면 표시하지 않는다. */
  goodImageUrl?: string | null;
  userId: string;
  authorName: string;
  body: string;
  /** 운영자 블라인드 상태. 작성자 삭제는 행 자체를 지운다(리뷰와 같은 분리). */
  hidden: boolean;
  answerBody: string | null;
  answeredAt: string | null;
  answeredByName: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface AdminProductQuestionCounts {
  total: number;
  unanswered: number;
  answered: number;
  hidden: number;
}

export interface AdminProductQuestionConsoleData {
  filters: AdminProductQuestionFilters;
  rows: AdminProductQuestionRow[];
  counts: AdminProductQuestionCounts;
  pageSize: number;
  total: number;
}

export const DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS: AdminProductQuestionFilters = {
  status: 'all',
  page: 1,
  from: null,
  to: null,
  query: '',
  field: 'body',
  sort: 'recent',
  pageSize: ADMIN_PRODUCT_QUESTION_PAGE_SIZE,
};

export const ADMIN_PRODUCT_QUESTIONS_PATH = '/admin/cs/qna';

type SearchParamValue = string | string[] | undefined;

const STATUS_FILTERS = new Set<string>(
  ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS.map((option) => option.value),
);

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

export function normalizeAdminProductQuestionFilters(
  searchParams: Record<string, SearchParamValue>,
): AdminProductQuestionFilters {
  const rawStatus = singleParam(searchParams.status);
  const rawPage = Number(singleParam(searchParams.page));
  let from = customerServiceDate(searchParams.from);
  let to = customerServiceDate(searchParams.to);
  if (from && to && from > to) { from = null; to = null; }
  const field = singleParam(searchParams.field);

  return {
    status: STATUS_FILTERS.has(rawStatus)
      ? rawStatus as AdminProductQuestionStatusFilter
      : 'all',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    from,
    to,
    query: singleParam(searchParams.query).trim().slice(0, 100),
    field: ADMIN_PRODUCT_QUESTION_SEARCH_FIELDS.some((entry) => entry.value === field) ? field as AdminProductQuestionSearchField : 'body',
    sort: singleParam(searchParams.sort) === 'oldest' ? 'oldest' : 'recent',
    pageSize: customerServicePageSize(searchParams.pageSize),
  };
}

export function adminProductQuestionHref(
  filters: AdminProductQuestionFilters,
  overrides: Partial<AdminProductQuestionFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.status !== 'all') params.set('status', next.status);
  params.set('page', String(next.page));
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) {
    params.set('query', next.query);
    if (next.field && next.field !== 'body') params.set('field', next.field);
  }
  if (next.sort === 'oldest') params.set('sort', next.sort);
  if (next.pageSize && next.pageSize !== ADMIN_PRODUCT_QUESTION_PAGE_SIZE) params.set('pageSize', String(next.pageSize));
  return `${ADMIN_PRODUCT_QUESTIONS_PATH}?${params.toString()}`;
}

/** 필터를 전부 버린 초기 상태 링크. */
export function adminProductQuestionResetHref() {
  return adminProductQuestionHref(DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS);
}

/** 작성자 표기. 닉네임이 비면 주문·문의·리뷰 콘솔과 같은 fan_ 축약을 쓴다. */
export function adminProductQuestionAuthorLabel(name: string | null, userId: string) {
  return name?.trim() || `fan_${userId.slice(0, 6)}`;
}

/** 그리드의 본문 미리보기. 줄바꿈을 접어 한 줄로 만든다. */
export function productQuestionBodyPreview(body: string, limit = 60) {
  const normalized = body.trim().replace(/\s+/g, ' ');
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

export function formatAdminProductQuestionDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
