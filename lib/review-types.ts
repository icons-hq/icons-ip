import { parseGoodsGroupReviewHelpfulPage, type GoodsGroupReviewHelpfulPage } from './review-helpful';
import { transactionExactKeys, transactionInteger, transactionRecord } from './goods-transaction-values';
export type ReviewKind = 'ordinary' | 'month';
export type ReviewKindFilter = ReviewKind | 'all';
export type ReviewRepeatFilter = 'all' | 'yes' | 'no' | 'unknown';
export const REVIEW_KIND_LABELS = { ordinary: '일반 리뷰', month: '한달사용 리뷰' } as const;
export const REVIEW_KIND_OPTIONS = [{ value: 'all', label: '전체' }, { value: 'ordinary', label: '일반 리뷰' }, { value: 'month', label: '한달사용 리뷰' }] as const;
export const REVIEW_REPEAT_OPTIONS = [{ value: 'all', label: '전체' }, { value: 'yes', label: '재구매' }, { value: 'no', label: '재구매 해당 없음' }, { value: 'unknown', label: '이력 미확인' }] as const;
export const isReviewKind = (value: unknown): value is ReviewKind => value === 'ordinary' || value === 'month';
export const isReviewKindFilter = (value: unknown): value is ReviewKindFilter => value === 'all' || isReviewKind(value);
export const isReviewRepeatFilter = (value: unknown): value is ReviewRepeatFilter => REVIEW_REPEAT_OPTIONS.some(option => option.value === value);
export interface ReviewTypeMetadata { kind: ReviewKind; repeatPurchase: boolean | null }
export interface TypedReviewPage extends Omit<GoodsGroupReviewHelpfulPage, 'reviews'> { reviews: (GoodsGroupReviewHelpfulPage['reviews'][number] & ReviewTypeMetadata)[] }
export function parseTypedReviewPage(value: unknown): TypedReviewPage | null {
 if (!transactionRecord(value) || !Array.isArray(value.reviews)) return null;
 const metadata: ReviewTypeMetadata[] = [], original: unknown[] = [];
 for (const row of value.reviews) {
  if (!transactionRecord(row) || !isReviewKind(row.kind) || (row.repeatPurchase !== null && typeof row.repeatPurchase !== 'boolean')) return null;
  metadata.push({ kind: row.kind, repeatPurchase: row.repeatPurchase });
  original.push(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'kind' && key !== 'repeatPurchase')));
 }
 const parsed = parseGoodsGroupReviewHelpfulPage({ ...value, reviews: original });
 return parsed ? { ...parsed, reviews: parsed.reviews.map((row, index) => ({ ...row, ...metadata[index] })) } : null;
}
export interface ReviewTypePolicy {
 revision: number; enabled: boolean; basis: 'delivered' | 'confirmed'; startDays: number | null; endDays: number | null;
 maxOrderDays: number | null; rewardEligible: boolean; evidence: string; updatedAt: string;
}
export function parseReviewTypePolicy(value: unknown): ReviewTypePolicy | null {
 if (!transactionRecord(value) || !transactionExactKeys(value, ['revision', 'enabled', 'basis', 'startDays', 'endDays', 'maxOrderDays', 'rewardEligible', 'evidence', 'updatedAt'])
  || !transactionInteger(value.revision, 1) || typeof value.enabled !== 'boolean' || !['delivered', 'confirmed'].includes(String(value.basis))
  || value.startDays !== null && !transactionInteger(value.startDays, 30, 365) || value.endDays !== null && !transactionInteger(value.endDays, 30, 730)
  || value.maxOrderDays !== null && !transactionInteger(value.maxOrderDays, 1, 1095) || typeof value.rewardEligible !== 'boolean'
  || value.enabled && (value.startDays === null || value.endDays === null)
  || typeof value.startDays === 'number' && typeof value.endDays === 'number' && value.startDays > value.endDays
  || typeof value.evidence !== 'string' || value.evidence.length > 1000 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
 return value as unknown as ReviewTypePolicy;
}
export function reviewTypeError(code?: string) {
 return code === 'PT409' ? '설정이 변경됐습니다. 최신 설정을 불러온 뒤 다시 저장해주세요.' : code === '42501' ? '현재 계정과 로그인 상태로 처리할 수 없습니다.' : code === '22023' ? '기준일과 작성 기간, 설정 근거를 확인해주세요.' : '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';
}
export function targetReviewDaysRemaining(target: { deadlineAt: string | null; deliveredAt: string | null }, now = new Date()): number | null {
 if (!target.deadlineAt) return null;
 const remaining = Date.parse(target.deadlineAt) - now.getTime();
 return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 86400000)) : null;
}
