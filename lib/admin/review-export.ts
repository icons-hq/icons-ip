import { isReviewKind, isReviewKindFilter, isReviewRepeatFilter, REVIEW_KIND_LABELS, REVIEW_REPEAT_OPTIONS } from '@/lib/review-types';
import { isUuid } from '@/lib/uuid';
import { REVIEW_BEST_LABELS, REVIEW_BEST_STATES, type ReviewBestStatus } from '@/lib/review-best';
import { ADMIN_REVIEW_STATUS_LABELS, type ReviewStatus } from '@/lib/reviews';
import { ADMIN_REVIEW_SEARCH_FIELDS, ADMIN_REVIEW_SORT_OPTIONS, type AdminReviewFilters } from './reviews';
import { kstDateTimeText, listExportPeriodLabel, type ListExportColumn } from './list-export';
import type { ListExportWorkbookSheet } from './list-export.server';

export const REVIEW_EXPORT_PATH = '/api/admin/reviews/export';
export const REVIEW_EXPORT_LIMIT = 10_000;
export const REVIEW_EXPORT_QUERY_KEYS = ['from', 'to', 'rating', 'low', 'status', 'photo', 'reply', 'best', 'query', 'field', 'sort', 'reviewId', 'kind', 'repeat'] as const;
const FILTER_KEYS = ['from', 'to', 'rating', 'lowRating', 'status', 'photo', 'reply', 'best', 'query', 'field', 'sort', 'reviewId', 'kind', 'repeat'] as const;
const ROW_KEYS = ['id', 'goodId', 'goodName', 'authorName', 'rating', 'body', 'imageCount', 'helpfulCount', 'status', 'bestState', 'reportCount', 'openReportCount', 'hasReply', 'replyAt', 'createdAt', 'editedAt'] as const;
export type ReviewExportFilters = Omit<AdminReviewFilters, 'page' | 'pageSize' | 'best'> & { best: 'all' | ReviewBestStatus };
export interface ReviewExportRow {
  kind?: import('../review-types').ReviewKind; repeatPurchase?: boolean | null;
  id: string; goodId: string; goodName: string; authorName: string; rating: number; body: string;
  imageCount: number; helpfulCount: number; status: ReviewStatus; bestState: ReviewBestStatus;
  reportCount: number; openReportCount: number; hasReply: boolean; replyAt: string | null; createdAt: string; editedAt: string | null;
}
export interface ReviewExportSnapshot {
  version: 1 | 2; filters: ReviewExportFilters; total: number; rows: ReviewExportRow[]; capturedAt: string; fingerprint: string;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T => typeof value === 'string' && choices.includes(value as T);
const textCell = (value: unknown): value is string => typeof value === 'string' && value.length <= 32_767;
const canonicalUuid = (value: unknown): value is string => isUuid(value) && value === value.toLowerCase();

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
export function reviewExportInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(match && calendarDate(match[1]) && Number.isFinite(Date.parse(value)));
}
const nullableInstant = (value: unknown) => value === null || reviewExportInstant(value);

/** A strict wire contract; malformed requests never widen to the whole list. */
export function parseReviewExportFilters(value: unknown): ReviewExportFilters | null {
  if (!object(value) || !exactKeys(value, FILTER_KEYS) && !exactKeys(value, FILTER_KEYS.filter(key => key !== 'kind' && key !== 'repeat'))
    || value.from !== null && !calendarDate(value.from) || value.to !== null && !calendarDate(value.to)
    || typeof value.from === 'string' && typeof value.to === 'string' && value.from > value.to
    || !oneOf(value.rating, ['all', '1', '2', '3', '4', '5']) || typeof value.lowRating !== 'boolean'
    || !oneOf(value.status, ['all', 'visible', 'hidden']) || !oneOf(value.photo, ['all', 'with', 'without'])
    || !oneOf(value.reply, ['all', 'with', 'without']) || !oneOf(value.best, ['all', ...REVIEW_BEST_STATES])
    || typeof value.query !== 'string' || value.query !== value.query.trim() || value.query.length > 100 || value.query.includes('\0')
    || !oneOf(value.field, ['all', 'good', 'author', 'body']) || !oneOf(value.sort, ADMIN_REVIEW_SORT_OPTIONS.map(option => option.value))
    || value.reviewId !== null && !canonicalUuid(value.reviewId)
    || value.kind !== undefined && !isReviewKindFilter(value.kind) || value.repeat !== undefined && !isReviewRepeatFilter(value.repeat)) return null;
  return value as unknown as ReviewExportFilters;
}

export function parseReviewExportQuery(params: URLSearchParams): ReviewExportFilters | null {
  if ([...params.keys()].some(key => !REVIEW_EXPORT_QUERY_KEYS.includes(key as typeof REVIEW_EXPORT_QUERY_KEYS[number]) || params.getAll(key).length !== 1)) return null;
  const low = params.get('low');
  if (low !== null && low !== '0' && low !== '1') return null;
  return parseReviewExportFilters({
    from: params.get('from'), to: params.get('to'), rating: params.get('rating') ?? 'all', lowRating: low === '1',
    status: params.get('status') ?? 'all', photo: params.get('photo') ?? 'all', reply: params.get('reply') ?? 'all', best: params.get('best') ?? 'all',
    query: (params.get('query') ?? '').trim(), field: params.get('field') ?? 'all', sort: params.get('sort') ?? 'recent',
    reviewId: params.get('reviewId')?.trim().toLowerCase() ?? null,
    kind: params.get('kind') ?? 'all', repeat: params.get('repeat') ?? 'all',
  });
}

/** Derive scope only from submitted server filters; page/selection/detail are absent. */
export function reviewExportFilters(filters: AdminReviewFilters): ReviewExportFilters {
  const value = parseReviewExportFilters({ from: filters.from, to: filters.to, rating: filters.rating, lowRating: filters.lowRating,
    status: filters.status, photo: filters.photo, reply: filters.reply, best: filters.best ?? 'all', query: filters.query,
    field: filters.field, sort: filters.sort, reviewId: filters.reviewId, kind: filters.kind ?? 'all', repeat: filters.repeat ?? 'all' });
  if (!value) throw new Error('invalid_review_export_filters');
  return value;
}
export function reviewExportHref(filters: ReviewExportFilters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (key === 'lowRating') { if (value) params.set('low', '1'); }
    else if (value !== null && value !== undefined) params.set(key, String(value));
  }
  return `${REVIEW_EXPORT_PATH}?${params}`;
}

export function parseReviewExportSnapshot(value: unknown, filters: ReviewExportFilters): ReviewExportSnapshot | null {
  if (!object(value) || !exactKeys(value, ['version', 'filters', 'total', 'rows', 'capturedAt', 'fingerprint']) || ![1, 2].includes(Number(value.version))
    || !parseReviewExportFilters(value.filters) || FILTER_KEYS.some(key => (value.filters as ReviewExportFilters)[key] !== filters[key])
    || !integer(value.total, 0, REVIEW_EXPORT_LIMIT) || !Array.isArray(value.rows) || value.rows.length !== value.total
    || !reviewExportInstant(value.capturedAt) || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) return null;
  const ids = new Set<string>();
  for (const row of value.rows) {
    if (!object(row) || !exactKeys(row, value.version === 2 ? [...ROW_KEYS, 'kind', 'repeatPurchase'] : ROW_KEYS) || !canonicalUuid(row.id) || ids.has(row.id)
      || !['goodId', 'goodName', 'authorName', 'body'].every(key => textCell(row[key]))
      || value.version === 2 && (!isReviewKind(row.kind) || row.repeatPurchase !== null && typeof row.repeatPurchase !== 'boolean')
      || !integer(row.rating, 1, 5) || !integer(row.imageCount) || !integer(row.helpfulCount)
      || !oneOf(row.status, ['visible', 'hidden']) || !oneOf(row.bestState, REVIEW_BEST_STATES)
      || !integer(row.reportCount) || !integer(row.openReportCount) || row.openReportCount > row.reportCount
      || typeof row.hasReply !== 'boolean' || !nullableInstant(row.replyAt) || !reviewExportInstant(row.createdAt) || !nullableInstant(row.editedAt)) return null;
    ids.add(row.id);
  }
  return value as unknown as ReviewExportSnapshot;
}

const column = (header: string, kind: ListExportColumn['kind'] = 'text', width = 22): ListExportColumn => ({ header, kind, width });
const ternaryLabels = { all: '전체', with: '있음', without: '없음' } as const;
export function reviewExportSheet(snapshot: ReviewExportSnapshot): ListExportWorkbookSheet {
  const { filters } = snapshot;
  const safeFilters = Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'query')
    .map(([key, value]) => [key, value === null ? null : String(value)]));
  return {
    screenLabel: '리뷰', title: '리뷰', recordCount: snapshot.total,
    columns: [column('리뷰 ID', 'code', 40), column('상품 ID', 'code', 28), column('상품명', 'text', 40), column('작성자 표시명'),
      column('평점', 'count', 10), column('리뷰 내용', 'text', 70), column('사진 수', 'count', 12), column('리뷰도움수', 'count', 14),
      column('상태', 'text', 14), column('BEST 상태', 'text', 18), column('전체 신고 수', 'count', 16), column('미처리 신고 수', 'count', 18),
      column('답글 등록 여부', 'text', 18), column('답글 등록 시각 (KST)', 'text', 25), column('작성 시각 (KST)'), column('수정 시각 (KST)'), column('리뷰 구분'), column('재구매 표시')],
    rows: snapshot.rows.map(row => [row.id, row.goodId, row.goodName, row.authorName, row.rating, row.body, row.imageCount, row.helpfulCount,
      ADMIN_REVIEW_STATUS_LABELS[row.status], REVIEW_BEST_LABELS[row.bestState], row.reportCount, row.openReportCount, row.hasReply ? '등록' : '미등록',
      kstDateTimeText(row.replyAt), kstDateTimeText(row.createdAt), kstDateTimeText(row.editedAt), REVIEW_KIND_LABELS[row.kind ?? 'ordinary'], row.repeatPurchase === true ? '재구매' : row.repeatPurchase === false ? '해당 없음' : '이력 미확인']),
    conditions: [['조회 범위', '현재 적용한 검색 조건의 전체 페이지'], ['작성일 (KST)', listExportPeriodLabel(filters.from, filters.to)],
      ['평점', filters.rating === 'all' ? '전체' : `${filters.rating}점`], ['저평점 조건', filters.lowRating ? '1~2점 (평점 조건과 함께 적용)' : '없음'],
      ['상태', filters.status === 'all' ? '전체' : ADMIN_REVIEW_STATUS_LABELS[filters.status]], ['사진', ternaryLabels[filters.photo]], ['답글', ternaryLabels[filters.reply]],
      ['리뷰 구분', filters.kind === 'ordinary' || filters.kind === 'month' ? REVIEW_KIND_LABELS[filters.kind] : '전체'], ['재구매', REVIEW_REPEAT_OPTIONS.find(option => option.value === (filters.repeat ?? 'all'))!.label],
      ['BEST 상태', filters.best === 'all' ? '전체' : REVIEW_BEST_LABELS[filters.best]],
      ['검색 대상', ADMIN_REVIEW_SEARCH_FIELDS.find(option => option.value === filters.field)!.label], ['검색어', filters.query ? `검색어 있음(${filters.query.length}자)` : '없음'],
      ['정렬', ADMIN_REVIEW_SORT_OPTIONS.find(option => option.value === filters.sort)!.label], ['단건 리뷰 조건', filters.reviewId ?? '없음'],
      ['DB 조회 시각 (KST)', kstDateTimeText(snapshot.capturedAt)]],
    notes: ['한 행은 원본 리뷰 한 건입니다. 현재 페이지와 선택한 행에 한정하지 않습니다.',
      '조회 시점의 확인용 파일입니다. 답글·블라인드·BEST 선정·도움수·보상을 변경하거나 다시 가져오는 기능이 없습니다.',
      '연락처·이메일·회원 ID·주문 ID·사진 주소·답글 본문·비공개 처리 사유를 제외했습니다. 리뷰 내용과 작성자 표시명에 고객이 적은 개인정보는 포함될 수 있습니다.'],
    filters: { ...safeFilters, queryPresent: String(Boolean(filters.query)), queryLength: String(filters.query.length), fingerprint: snapshot.fingerprint },
  };
}
