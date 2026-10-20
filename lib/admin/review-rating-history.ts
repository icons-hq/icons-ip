/** Persisted observations are a separate, versioned contract from live review insights. */
export const REVIEW_RATING_CONTRACT_VERSION = 1;
export type ReviewRatingHistoryStatus = 'available' | 'before_collection_start' | 'outside_retention' | 'not_collected';
export interface ReviewRatingObservation {
  version: number; asOf: string; observationDay: string; observedAt: string; sixMonthFrom: string;
  averageRating: number | null; sixMonthRating: number | null;
  eligibleProductCount: number; ratedProductCount: number; sixMonthRatedProductCount: number;
  reviewCount: number; sixMonthReviewCount: number; fingerprint: string;
}
export interface ReviewRatingHistory {
  version: number; asOf: string; comparisonAsOf: string; status: ReviewRatingHistoryStatus;
  enabled: boolean; collectionStartedAt: string | null; lastSuccessAt: string | null;
  purgedBeforeAsOf: string | null; lastPurgedAt: string | null; observation: ReviewRatingObservation | null;
}
export type ReviewRatingHistoryResult = { kind: 'ready'; data: ReviewRatingHistory } | { kind: 'error' };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const fingerprint = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function isReviewRatingDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0100-01-01'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const time = value.slice(11, 19).split(':').map(Number);
  const offset = value.endsWith('Z') ? [0, 0] : value.slice(-5).split(':').map(Number);
  return isReviewRatingDate(value.slice(0, 10)) && time[0] < 24 && time[1] < 60 && time[2] < 60
    && offset[0] <= 14 && offset[1] < 60 && (offset[0] !== 14 || offset[1] === 0) && Number.isFinite(Date.parse(value));
}
function addDays(value: string, amount: number) { return new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10); }
export function reviewRatingMonthsBefore(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end));
  return date.toISOString().slice(0, 10);
}
function koreanDate(value: string) { return new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10); }
function metric(value: unknown, denominator: number) {
  return denominator === 0 ? value === null : typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}
export function parseReviewRatingHistory(value: unknown, expectedAsOf: string): ReviewRatingHistory | null {
  if (!object(value) || !exact(value, ['version', 'asOf', 'comparisonAsOf', 'status', 'enabled', 'collectionStartedAt', 'lastSuccessAt', 'purgedBeforeAsOf', 'lastPurgedAt', 'observation'])
    || (!count(value.version) || value.version < 1) || !isReviewRatingDate(value.asOf) || value.asOf !== expectedAsOf
    || !isReviewRatingDate(value.comparisonAsOf) || value.comparisonAsOf !== reviewRatingMonthsBefore(value.asOf, 3)
    || !['available', 'before_collection_start', 'outside_retention', 'not_collected'].includes(value.status as string)
    || typeof value.enabled !== 'boolean'
    || !(value.collectionStartedAt === null || timestamp(value.collectionStartedAt)) || !(value.lastSuccessAt === null || timestamp(value.lastSuccessAt))
    || !(value.purgedBeforeAsOf === null || isReviewRatingDate(value.purgedBeforeAsOf)) || !(value.lastPurgedAt === null || timestamp(value.lastPurgedAt))
    || (value.purgedBeforeAsOf === null) !== (value.lastPurgedAt === null)
    || (value.enabled && value.collectionStartedAt === null)
    || (value.lastSuccessAt !== null && (value.collectionStartedAt === null || Date.parse(value.lastSuccessAt) < Date.parse(value.collectionStartedAt)))) return null;
  const observationDay = addDays(value.comparisonAsOf, 1);
  if (value.status !== 'available') {
    if (value.observation !== null) return null;
    const beforeStart = value.collectionStartedAt === null || observationDay < koreanDate(value.collectionStartedAt);
    const outsideRetention = value.purgedBeforeAsOf !== null && value.comparisonAsOf < value.purgedBeforeAsOf;
    const expectedStatus = beforeStart ? 'before_collection_start' : outsideRetention ? 'outside_retention' : 'not_collected';
    return value.status === expectedStatus ? value as unknown as ReviewRatingHistory : null;
  }
  const row = value.observation;
  if (!object(row) || !exact(row, ['version', 'asOf', 'observationDay', 'observedAt', 'sixMonthFrom', 'averageRating', 'sixMonthRating', 'eligibleProductCount', 'ratedProductCount', 'sixMonthRatedProductCount', 'reviewCount', 'sixMonthReviewCount', 'fingerprint'])
    || row.version !== value.version || row.asOf !== value.comparisonAsOf || row.observationDay !== observationDay
    || !timestamp(row.observedAt) || koreanDate(row.observedAt) !== observationDay || !isReviewRatingDate(row.sixMonthFrom)
    || row.sixMonthFrom !== reviewRatingMonthsBefore(observationDay, 6) || !fingerprint(row.fingerprint)
    || !count(row.eligibleProductCount) || !count(row.ratedProductCount) || !count(row.sixMonthRatedProductCount) || !count(row.reviewCount) || !count(row.sixMonthReviewCount)
    || row.ratedProductCount > row.eligibleProductCount || row.sixMonthRatedProductCount > row.ratedProductCount
    || row.reviewCount < row.ratedProductCount || row.sixMonthReviewCount < row.sixMonthRatedProductCount || row.sixMonthReviewCount > row.reviewCount
    || (row.reviewCount === 0) !== (row.ratedProductCount === 0) || (row.sixMonthReviewCount === 0) !== (row.sixMonthRatedProductCount === 0)
    || !metric(row.averageRating, row.ratedProductCount) || !metric(row.sixMonthRating, row.sixMonthRatedProductCount)
    || value.collectionStartedAt === null || value.lastSuccessAt === null || Date.parse(row.observedAt) < Date.parse(value.collectionStartedAt)
    || Date.parse(row.observedAt) > Date.parse(value.lastSuccessAt)) return null;
  return value as unknown as ReviewRatingHistory;
}
export function reviewRatingComparisonText(current: number | null, history: ReviewRatingHistoryResult, field: 'averageRating' | 'sixMonthRating'): string {
  if (history.kind === 'error') return '과거 비교를 불러오지 못했습니다';
  const { status, observation } = history.data;
  if (status === 'before_collection_start') return '비교 기록 없음 · 수집 시작 전';
  if (status === 'outside_retention') return '보존 기간 외';
  if (status === 'not_collected') return '비교 기록 없음 · 해당 날짜 미수집';
  if (current === null || observation?.[field] == null) return '비교할 평점 없음';
  const delta = Math.round(current * 100) - Math.round(observation[field] * 100);
  return `3개월 전 대비 ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${(Math.abs(delta) / 100).toFixed(2)}점`;
}
export interface ReviewRatingCollectionResult { status: 'busy' | 'disabled' | 'too_early' | 'recorded' | 'already_recorded'; version: number | null; asOf: string | null; observedAt: string | null; fingerprint: string | null }
export function parseReviewRatingCollectionResult(value: unknown): ReviewRatingCollectionResult | null {
  if (!object(value) || !exact(value, ['status', 'version', 'asOf', 'observedAt', 'fingerprint'])) return null;
  if (value.status === 'busy') return value.version === null && value.asOf === null && value.observedAt === null && value.fingerprint === null ? value as unknown as ReviewRatingCollectionResult : null;
  if ((!count(value.version) || value.version < 1)) return null;
  if (value.status === 'disabled' || value.status === 'too_early') return value.asOf === null && value.observedAt === null && value.fingerprint === null ? value as unknown as ReviewRatingCollectionResult : null;
  if ((value.status === 'recorded' || value.status === 'already_recorded') && isReviewRatingDate(value.asOf) && timestamp(value.observedAt)
    && addDays(value.asOf, 1) === koreanDate(value.observedAt) && fingerprint(value.fingerprint)) return value as unknown as ReviewRatingCollectionResult;
  return null;
}
