import { isReviewKind, type ReviewKind } from './review-types';
import { isUuid } from './uuid';
import type { ReviewEventDisclosure } from './review-events';

export const REVIEW_BEST_SETTINGS_PATH = '/admin/display/detail/reviews';
export const REVIEW_BEST_STATES = ['selected', 'not_selected', 'needs_review'] as const;
export type ReviewBestStatus = typeof REVIEW_BEST_STATES[number];
export const REVIEW_BEST_PROBLEMS = ['review_deleted', 'review_hidden', 'purchase_ineligible', 'customer_unavailable', 'good_unavailable', 'review_changed', 'purchase_changed'] as const;
export type ReviewBestProblem = typeof REVIEW_BEST_PROBLEMS[number];
export const REVIEW_BEST_LABELS: Record<ReviewBestStatus, string> = { selected: '선정됨', not_selected: '미선정', needs_review: '재확인 필요' };
export const REVIEW_BEST_PROBLEM_LABELS: Record<ReviewBestProblem, string> = {
  review_deleted: '작성자가 삭제한 리뷰입니다.', review_hidden: '블라인드된 리뷰입니다.',
  purchase_ineligible: '현재 구매 내역이 선정 조건을 충족하지 않습니다.', customer_unavailable: '작성자 계정을 확인할 수 없습니다.',
  good_unavailable: '현재 공개되지 않은 상품의 리뷰입니다.', review_changed: '선정 후 리뷰가 변경되었습니다. 내용을 확인하고 다시 선정해주세요.',
  purchase_changed: '선정 후 구매 내역이 변경되었습니다. 내역을 확인하고 다시 선정해주세요.',
};
export interface ReviewBestState {
  reviewId: string; selected: boolean; revision: number; reviewFingerprint: string;
  selectedAt: string | null; reason: string | null; problem: ReviewBestProblem | null; state: ReviewBestStatus;
}
export interface ReviewBestSettings { enabled: boolean; revision: number; unavailable?: boolean }
export interface ReviewBestRequest { reviewId: string; selected: boolean; reason: string; expectedRevision: number; reviewFingerprint: string; operationId: string }
export interface SelectedReviewCard { kind?: ReviewKind; repeatPurchase?: boolean | null; id: string; rating: number; body: string; authorName: string; createdAt: string; imagePaths: string[] }
export interface PublicSelectedReviewCard extends Omit<SelectedReviewCard, 'imagePaths'> { imageUrls: string[]; eventDisclosure?: ReviewEventDisclosure }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
export function parseReviewBestState(value: unknown): ReviewBestState | null {
  if (!object(value) || !isUuid(value.reviewId) || typeof value.selected !== 'boolean' || !revision(value.revision) || !fingerprint(value.reviewFingerprint)
    || value.selectedAt !== null && !instant(value.selectedAt) || value.reason !== null && (typeof value.reason !== 'string' || [...value.reason].length > 500)
    || value.problem !== null && !REVIEW_BEST_PROBLEMS.includes(value.problem as ReviewBestProblem) || !REVIEW_BEST_STATES.includes(value.state as ReviewBestStatus)
    || value.selected && (!value.revision || !value.selectedAt || !value.reason) || !value.selected && value.state !== 'not_selected'
    || value.selected && value.state !== (value.problem ? 'needs_review' : 'selected')) return null;
  return { reviewId: value.reviewId, selected: value.selected, revision: value.revision, reviewFingerprint: value.reviewFingerprint,
    selectedAt: value.selectedAt as string | null, reason: value.reason as string | null, problem: value.problem as ReviewBestProblem | null, state: value.state as ReviewBestStatus };
}
export function parseReviewBestRequest(value: unknown): ReviewBestRequest | null {
  if (!object(value) || Object.keys(value).length !== 6 || !isUuid(value.reviewId) || typeof value.selected !== 'boolean' || !revision(value.expectedRevision)
    || !fingerprint(value.reviewFingerprint) || !isUuid(value.operationId) || typeof value.reason !== 'string') return null;
  const reason = value.reason.trim();
  if ([...reason].length < 2 || [...reason].length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) return null;
  return { reviewId: value.reviewId, selected: value.selected, reason, expectedRevision: value.expectedRevision, reviewFingerprint: value.reviewFingerprint, operationId: value.operationId };
}
export function parseReviewBestSettings(value: unknown): ReviewBestSettings | null {
  return object(value) && typeof value.enabled === 'boolean' && revision(value.revision) ? { enabled: value.enabled, revision: value.revision } : null;
}
export function parseSelectedReviewCards(value: unknown): SelectedReviewCard[] | null {
  if (!Array.isArray(value) || ![0, 3].includes(value.length) || new Set(value.map(row => row?.id)).size !== value.length
    || value.some(row => !object(row) || !isUuid(row.id) || !Number.isInteger(row.rating) || Number(row.rating) < 1 || Number(row.rating) > 5
      || typeof row.body !== 'string' || !row.body || [...row.body].length > 1000 || typeof row.authorName !== 'string' || !instant(row.createdAt)
      || !Array.isArray(row.imagePaths) || row.imagePaths.length > 5 || row.imagePaths.some(path => typeof path !== 'string' || !path))) return null;
  return value.map(row => ({ id: row.id, rating: row.rating, body: row.body, authorName: row.authorName, createdAt: row.createdAt, imagePaths: row.imagePaths }));
}
export function canSelectBestReview(value: ReviewBestState) {
  return value.problem === null || value.problem === 'review_changed' || value.problem === 'purchase_changed';
}

export function parseTypedSelectedReviewCards(value: unknown): SelectedReviewCard[] | null {
 const cards = parseSelectedReviewCards(value);
 if (!cards || !Array.isArray(value) || value.some(row => !isReviewKind(row.kind) || row.repeatPurchase !== null && typeof row.repeatPurchase !== 'boolean')) return null;
 return cards.map((card, index) => ({ ...card, kind: value[index].kind, repeatPurchase: value[index].repeatPurchase }));
}
