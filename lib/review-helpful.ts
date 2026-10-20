import { parseGoodsGroupReviewPage, type GoodsGroupReviewPage, type GoodsGroupReviewRow } from './goods-group-reviews';
import { transactionExactKeys, transactionInteger, transactionRecord } from './goods-transaction-values';
import { isReviewSort, type GoodReviewListOptions } from './reviews';
import { isUuid } from './uuid';

export interface ReviewHelpfulMetrics {
  helpfulCount: number;
  helpfulByMe: boolean;
  canMarkHelpful: boolean;
}
export interface ReviewHelpfulState extends ReviewHelpfulMetrics { reviewId: string }
export interface ReviewHelpfulRequest {
  goodId: string;
  reviewId: string;
  marked: boolean;
  options: GoodReviewListOptions;
}
export interface GoodsGroupReviewHelpfulPage extends Omit<GoodsGroupReviewPage, 'reviews'> {
  viewerAuthenticated: boolean;
  reviews: (GoodsGroupReviewRow & ReviewHelpfulMetrics)[];
}

function metrics(value: Record<string, unknown>): ReviewHelpfulMetrics | null {
  if (!transactionInteger(value.helpfulCount) || typeof value.helpfulByMe !== 'boolean'
    || typeof value.canMarkHelpful !== 'boolean' || (value.helpfulByMe && value.helpfulCount === 0)) return null;
  return { helpfulCount: value.helpfulCount, helpfulByMe: value.helpfulByMe, canMarkHelpful: value.canMarkHelpful };
}

export function parseReviewHelpfulState(value: unknown): ReviewHelpfulState | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['reviewId', 'helpfulCount', 'helpfulByMe', 'canMarkHelpful'])
    || typeof value.reviewId !== 'string' || !isUuid(value.reviewId)) return null;
  const parsed = metrics(value);
  return parsed ? { reviewId: value.reviewId, ...parsed } : null;
}

export function parseReviewHelpfulRequest(value: unknown): ReviewHelpfulRequest | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'reviewId', 'marked', 'options'])
    || typeof value.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(value.goodId)
    || typeof value.reviewId !== 'string' || !isUuid(value.reviewId) || typeof value.marked !== 'boolean'
    || !transactionRecord(value.options) || Object.keys(value.options).some(key => !['sort', 'photoOnly', 'page', 'kind', 'repeat'].includes(key))
    || value.options.kind !== undefined && !['all', 'ordinary', 'month'].includes(String(value.options.kind))
    || value.options.repeat !== undefined && !['all', 'yes', 'no', 'unknown'].includes(String(value.options.repeat))
    || !isReviewSort(value.options.sort) || typeof value.options.photoOnly !== 'boolean'
    || !transactionInteger(value.options.page, 1)) return null;
  return { goodId: value.goodId, reviewId: value.reviewId.toLowerCase(), marked: value.marked,
    options: { sort: value.options.sort, photoOnly: value.options.photoOnly, page: value.options.page,
      ...(value.options.kind !== undefined ? { kind: value.options.kind as import('./review-types').ReviewKindFilter } : {}),
      ...(value.options.repeat !== undefined ? { repeat: value.options.repeat as import('./review-types').ReviewRepeatFilter } : {}) } };
}

/** Keep the original strict reader contract intact; v2 adds only viewer state and helpful metrics. */
export function parseGoodsGroupReviewHelpfulPage(value: unknown): GoodsGroupReviewHelpfulPage | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['grouped', 'summary', 'total', 'reviews', 'viewerAuthenticated'])
    || typeof value.viewerAuthenticated !== 'boolean' || !Array.isArray(value.reviews)) return null;
  const extras: ReviewHelpfulMetrics[] = [];
  const originalRows: unknown[] = [];
  for (const row of value.reviews) {
    if (!transactionRecord(row)) return null;
    const parsed = metrics(row);
    if (!parsed || (row.isMine === true && (parsed.helpfulByMe || parsed.canMarkHelpful))
      || (!value.viewerAuthenticated && (parsed.helpfulByMe || parsed.canMarkHelpful))) return null;
    extras.push(parsed);
    originalRows.push(Object.fromEntries(Object.entries(row).filter(([key]) => !['helpfulCount', 'helpfulByMe', 'canMarkHelpful'].includes(key))));
  }
  const original = parseGoodsGroupReviewPage({ grouped: value.grouped, summary: value.summary, total: value.total, reviews: originalRows });
  return original ? { ...original, viewerAuthenticated: value.viewerAuthenticated,
    reviews: original.reviews.map((row, index) => ({ ...row, ...extras[index] })) } : null;
}
