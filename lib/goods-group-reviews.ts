import type { ReviewRatingSummary } from './reviews';
import { isUuid } from './uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from './goods-transaction-values';

export interface GoodsGroupReviewRow {
  id: string; goodId: string; goodName: string; variantNames: string[];
  rating: number; body: string; imagePaths: string[]; authorName: string; isMine: boolean;
  createdAt: string; editedAt: string | null; adminReply: string | null; adminReplyAt: string | null;
}
export interface GoodsGroupReviewPage {
  grouped: boolean; summary: ReviewRatingSummary; total: number; reviews: GoodsGroupReviewRow[];
}

const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown) => value === null || date(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max;

export function parseGoodsGroupReviewPage(value: unknown): GoodsGroupReviewPage | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['grouped', 'summary', 'total', 'reviews'])
    || typeof value.grouped !== 'boolean' || !transactionInteger(value.total, 0) || !transactionRecord(value.summary)
    || !Array.isArray(value.reviews) || value.reviews.length > 50 || value.reviews.length > value.total) return null;
  const summary = value.summary;
  if (!transactionExactKeys(summary, ['count', 'average', 'distribution', 'photoCount'])
    || !transactionInteger(summary.count, 0) || !transactionInteger(summary.photoCount, 0, summary.count)
    || value.total > summary.count || typeof summary.average !== 'number' || !Number.isFinite(summary.average)
    || (summary.count === 0 ? summary.average !== 0 : summary.average < 1 || summary.average > 5)
    || !Array.isArray(summary.distribution) || summary.distribution.length !== 5
    || summary.distribution.some(count => !transactionInteger(count, 0))
    || summary.distribution.reduce((sum, count) => sum + count, 0) !== summary.count) return null;
  const rows: GoodsGroupReviewRow[] = []; const ids = new Set<string>();
  for (const row of value.reviews) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'goodId', 'goodName', 'variantNames', 'rating', 'body', 'imagePaths', 'authorName', 'isMine', 'createdAt', 'editedAt', 'adminReply', 'adminReplyAt'])
      || typeof row.id !== 'string' || !isUuid(row.id) || ids.has(row.id)
      || typeof row.goodId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(row.goodId)
      || !text(row.goodName, 500) || !row.goodName || !Array.isArray(row.variantNames) || row.variantNames.length > 100
      || row.variantNames.some(name => !text(name, 200)) || !transactionInteger(row.rating, 1, 5)
      || !text(row.body, 10000) || !Array.isArray(row.imagePaths) || row.imagePaths.length > 10
      || row.imagePaths.some(path => !text(path, 500) || !path) || !text(row.authorName, 200) || !row.authorName
      || typeof row.isMine !== 'boolean' || !date(row.createdAt) || !nullableDate(row.editedAt)
      || (row.adminReply !== null && !text(row.adminReply, 10000)) || !nullableDate(row.adminReplyAt)) return null;
    ids.add(row.id); rows.push(row as unknown as GoodsGroupReviewRow);
  }
  return { grouped: value.grouped, summary: summary as unknown as ReviewRatingSummary, total: value.total, reviews: rows };
}
