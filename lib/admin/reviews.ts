import {
  ADMIN_REVIEW_STATUS_LABELS,
  LOW_REVIEW_RATING_MAX,
  REVIEW_RATINGS,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '../reviews';

/**
 * 어드민 리뷰 관리 콘솔(#254).
 *
 * 스마트스토어 리뷰관리의 목록 구조를 따른다: 필터 패널 → 카운트 칩 → 그리드.
 * 필터·정렬·페이지는 전부 URL에 남는다 — 운영자가 "저평점 미답변 2페이지"를
 * 동료에게 링크로 넘길 수 있어야 하고, 새로고침으로 조건이 날아가면 안 된다.
 *
 * 판정은 서버(admin_search_reviews)가 한다. 여기 있는 것은 URL을 신뢰할 수 있는
 * 값으로 좁히는 일뿐이다 — 그대로 RPC에 넘기면 어드민 화면이 임의 입력의 통로가 된다.
 */

export const ADMIN_REVIEW_PAGE_SIZE = 20;

export type AdminReviewStatusFilter = ReviewStatus | 'all';
export type AdminReviewRatingFilter = 'all' | '1' | '2' | '3' | '4' | '5';
export type AdminReviewTernaryFilter = 'all' | 'with' | 'without';
export type AdminReviewSearchField = 'all' | 'good' | 'author' | 'body';
export type AdminReviewSort = 'recent' | 'oldest' | 'rating_desc' | 'rating_asc';

export const ADMIN_REVIEW_STATUS_OPTIONS: { value: AdminReviewStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...REVIEW_STATUSES.map((status) => ({
    value: status as AdminReviewStatusFilter,
    label: ADMIN_REVIEW_STATUS_LABELS[status],
  })),
];

export const ADMIN_REVIEW_RATING_OPTIONS: { value: AdminReviewRatingFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...REVIEW_RATINGS.map((rating) => ({
    value: String(rating) as AdminReviewRatingFilter,
    label: `${rating}점`,
  })),
];

export const ADMIN_REVIEW_PHOTO_OPTIONS: { value: AdminReviewTernaryFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'with', label: '사진 있음' },
  { value: 'without', label: '사진 없음' },
];

export const ADMIN_REVIEW_REPLY_OPTIONS: { value: AdminReviewTernaryFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'with', label: '답글 있음' },
  { value: 'without', label: '답글 없음' },
];

export const ADMIN_REVIEW_SEARCH_FIELDS: { value: AdminReviewSearchField; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'good', label: '굿즈' },
  { value: 'author', label: '작성자' },
  { value: 'body', label: '리뷰 내용' },
];

export const ADMIN_REVIEW_SORT_OPTIONS: { value: AdminReviewSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
  { value: 'rating_desc', label: '평점 높은순' },
  { value: 'rating_asc', label: '평점 낮은순' },
];

export interface AdminReviewFilters {
  from: string | null;
  to: string | null;
  rating: AdminReviewRatingFilter;
  /** 저평점(1~2점) 고정 필터. rating 셀렉트와 독립이며 AND로 걸린다. */
  lowRating: boolean;
  status: AdminReviewStatusFilter;
  photo: AdminReviewTernaryFilter;
  reply: AdminReviewTernaryFilter;
  query: string;
  field: AdminReviewSearchField;
  sort: AdminReviewSort;
  /** 모더레이션 큐에서 넘어온 딥링크. 있으면 그 리뷰 한 건만 본다. */
  reviewId: string | null;
  page: number;
}

export interface AdminReviewRow {
  id: string;
  goodId: string;
  goodName: string;
  orderId: string;
  userId: string;
  authorName: string;
  authorEmail: string | null;
  rating: number;
  body: string;
  imageUrls: string[];
  imageCount: number;
  status: ReviewStatus;
  hiddenReason: string | null;
  hiddenAt: string | null;
  adminReply: string | null;
  adminReplyAt: string | null;
  replyAuthorName: string | null;
  reportCount: number;
  openReportCount: number;
  createdAt: string;
  editedAt: string | null;
}

export interface AdminReviewCounts {
  total: number;
  lowRating: number;
  awaitingReply: number;
  hidden: number;
  reported: number;
}

export interface AdminReviewConsoleData {
  filters: AdminReviewFilters;
  rows: AdminReviewRow[];
  counts: AdminReviewCounts;
  pageSize: number;
  total: number;
}

export const EMPTY_ADMIN_REVIEW_COUNTS: AdminReviewCounts = {
  total: 0,
  lowRating: 0,
  awaitingReply: 0,
  hidden: 0,
  reported: 0,
};

type SearchParamValue = string | string[] | undefined;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_FILTERS = new Set<string>(['all', ...REVIEW_STATUSES]);
const RATING_FILTERS = new Set<string>(['all', ...REVIEW_RATINGS.map(String)]);
const TERNARY_FILTERS = new Set<string>(['all', 'with', 'without']);
const SEARCH_FIELDS = new Set<string>(ADMIN_REVIEW_SEARCH_FIELDS.map((field) => field.value));
const SORTS = new Set<string>(ADMIN_REVIEW_SORT_OPTIONS.map((sort) => sort.value));

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

export function normalizeAdminReviewFilters(
  searchParams: Record<string, SearchParamValue>,
): AdminReviewFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawRating = singleParam(searchParams.rating);
  const rawStatus = singleParam(searchParams.status);
  const rawPhoto = singleParam(searchParams.photo);
  const rawReply = singleParam(searchParams.reply);
  const rawField = singleParam(searchParams.field);
  const rawSort = singleParam(searchParams.sort);
  const rawQuery = singleParam(searchParams.query).trim();
  const rawReviewId = singleParam(searchParams.reviewId).trim().toLowerCase();
  const rawPage = Number(singleParam(searchParams.page));

  return {
    from,
    to,
    rating: RATING_FILTERS.has(rawRating) ? rawRating as AdminReviewRatingFilter : 'all',
    lowRating: singleParam(searchParams.low) === '1',
    status: STATUS_FILTERS.has(rawStatus) ? rawStatus as AdminReviewStatusFilter : 'all',
    photo: TERNARY_FILTERS.has(rawPhoto) ? rawPhoto as AdminReviewTernaryFilter : 'all',
    reply: TERNARY_FILTERS.has(rawReply) ? rawReply as AdminReviewTernaryFilter : 'all',
    query: rawQuery.length <= 100 ? rawQuery : '',
    field: SEARCH_FIELDS.has(rawField) ? rawField as AdminReviewSearchField : 'all',
    sort: SORTS.has(rawSort) ? rawSort as AdminReviewSort : 'recent',
    reviewId: UUID_PATTERN.test(rawReviewId) ? rawReviewId : null,
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export const DEFAULT_ADMIN_REVIEW_FILTERS: AdminReviewFilters = {
  from: null,
  to: null,
  rating: 'all',
  lowRating: false,
  status: 'all',
  photo: 'all',
  reply: 'all',
  query: '',
  field: 'all',
  sort: 'recent',
  reviewId: null,
  page: 1,
};

export function adminReviewHref(
  filters: AdminReviewFilters,
  overrides: Partial<AdminReviewFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.rating !== 'all') params.set('rating', next.rating);
  if (next.lowRating) params.set('low', '1');
  if (next.status !== 'all') params.set('status', next.status);
  if (next.photo !== 'all') params.set('photo', next.photo);
  if (next.reply !== 'all') params.set('reply', next.reply);
  if (next.sort !== 'recent') params.set('sort', next.sort);
  if (next.reviewId) params.set('reviewId', next.reviewId);
  if (next.query) {
    params.set('query', next.query);
    if (next.field !== 'all') params.set('field', next.field);
  }
  params.set('page', String(next.page));
  return `/admin/cs/reviews?${params.toString()}`;
}

/** 필터를 전부 버린 초기 상태 링크. */
export function adminReviewResetHref() {
  return adminReviewHref(DEFAULT_ADMIN_REVIEW_FILTERS);
}

/** 삼중 필터를 RPC의 boolean/null 삼항으로 바꾼다. `'all'`은 조건 자체를 걸지 않는다. */
export function ternaryFilterToBoolean(value: AdminReviewTernaryFilter): boolean | null {
  if (value === 'with') return true;
  if (value === 'without') return false;
  return null;
}

/** 저평점 배지를 붙일지. 콘솔 그리드와 카운트 칩이 같은 경계를 본다. */
export function isLowReviewRating(rating: number) {
  return rating <= LOW_REVIEW_RATING_MAX;
}

/** 작성자 표기. 닉네임이 비면 주문·문의 콘솔과 같은 fan_ 축약을 쓴다. */
export function adminReviewAuthorLabel(name: string | null, userId: string) {
  return name?.trim() || `fan_${userId.slice(0, 6)}`;
}
