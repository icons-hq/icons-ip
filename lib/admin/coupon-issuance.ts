import { transactionInteger, transactionInstant, transactionRecord } from '@/lib/goods-transaction-values';
import { marketingCouponCode } from './marketing-coupons';
import { isUuid } from '@/lib/uuid';
export const COUPON_ISSUE_PATH = '/admin/sales/coupons/issue';
export type CouponIssueTargets = { kind: 'customers'; userIds: string[] } | { kind: 'segment'; segmentId: string; revision: number };
export interface CouponIssueRow { userId: string; userCouponId: string | null; nickname: string; reason: string | null }
export interface CouponIssueBatch { id: string; couponCode: string; couponName: string; couponRevision: number; targetKind: 'customers' | 'segment'; segmentName: string | null;
  status: 'prepared' | 'invalid' | 'completed' | 'failed'; targetCount: number; plannedCount: number; existingCount: number; invalidCount: number; issuedCount: number;
  createdAt: string; validUntil: string; finishedAt: string | null; error: string | null; rows: CouponIssueRow[]; canExecute: boolean }
export const COUPON_ISSUE_ERRORS: Record<string, string> = {
  coupon_issue_auth_changed: '현재 관리자 로그인으로 다시 열어주세요.', coupon_issue_operation_conflict: '같은 작업 ID의 내용이 달라졌습니다. 저장된 결과를 확인해주세요.',
  coupon_issue_target_limit: '세그먼트가 1,000명을 넘습니다. 조건을 좁혀서 다시 확인해주세요.', coupon_issue_no_targets: '조건에 맞는 고객이 없습니다.',
  coupon_issue_invalid_targets: '발급 조건을 충족하지 않는 고객이 있습니다. 대상을 수정해주세요.', coupon_exhausted: '쿠폰 잔여 발급 한도가 부족합니다.',
  coupon_not_found: '쿠폰이 없거나 발급·사용이 중단됐습니다.', coupon_issue_not_started: '쿠폰 발급 시작 전입니다.', coupon_not_started: '쿠폰 시작 전입니다.',
  coupon_issue_ended: '쿠폰 발급기간이 끝났습니다.', coupon_expired: '쿠폰 사용기간이 끝났습니다.', coupon_customer_unavailable: '현재 발급할 수 없는 고객 계정입니다.',
  coupon_first_purchase_only: '첫구매 대상이 아닙니다.', coupon_repeat_purchase_only: '구매 이력이 필요한 쿠폰입니다.',
  customer_segment_changed: '세그먼트가 수정·삭제됐거나 수집 설정이 꺼졌습니다.', coupon_issue_segment_changed: '확인한 고객의 세그먼트 조건이 바뀌었습니다.',
  coupon_issue_preview_stale: '확인 후 15분이 지났습니다. 대상을 다시 확인해주세요.', coupon_issue_policy_changed: '쿠폰 정책이 바뀌었습니다. 다시 확인해주세요.',
  coupon_issue_failed: '발급을 완료하지 못했습니다. 이 작업에서 새로 발급한 쿠폰은 없습니다.', coupon_issue_batch_not_found: '현재 계정·세션에서 실행할 수 없는 작업입니다.',
};
export function couponIssueError(code: string | null | undefined) { return code ? COUPON_ISSUE_ERRORS[code] ?? '발급 조건과 현재 권한을 확인해주세요.' : ''; }
export function parseCouponIssueTargets(value: unknown): CouponIssueTargets | null {
  if (!transactionRecord(value)) return null;
  if (value.kind === 'customers' && Object.keys(value).length === 2 && Array.isArray(value.userIds) && value.userIds.length >= 1 && value.userIds.length <= 1000
    && value.userIds.every(isUuid) && new Set(value.userIds).size === value.userIds.length) return { kind: 'customers', userIds: [...value.userIds].sort() as string[] };
  if (value.kind === 'segment' && Object.keys(value).length === 3 && isUuid(value.segmentId) && transactionInteger(value.revision, 1, 999999999)) return { kind: 'segment', segmentId: value.segmentId, revision: value.revision };
  return null;
}
export function couponIssueCustomerIds(text: string): string[] | null {
  const values = text.trim().split(/[\s,;]+/).filter(Boolean).map(value => value.toLowerCase());
  return values.length && values.length <= 5000 && values.every(isUuid) && new Set(values).size <= 1000 ? [...new Set(values)].sort() : null;
}
export function parseCouponIssueBatch(value: unknown): CouponIssueBatch | null {
  if (!transactionRecord(value) || !isUuid(value.id) || !marketingCouponCode(value.couponCode) || typeof value.couponName !== 'string' || !transactionInteger(value.couponRevision, 1)
    || !['customers','segment'].includes(String(value.targetKind)) || value.segmentName !== null && typeof value.segmentName !== 'string'
    || !['prepared','invalid','completed','failed'].includes(String(value.status)) || !transactionInstant(value.createdAt) || !transactionInstant(value.validUntil)
    || value.finishedAt !== null && !transactionInstant(value.finishedAt) || value.error !== null && typeof value.error !== 'string' || typeof value.canExecute !== 'boolean'
    || ![value.targetCount,value.plannedCount,value.existingCount,value.invalidCount,value.issuedCount].every(count => transactionInteger(count, 0, 1000))
    || !Array.isArray(value.rows) || value.rows.length !== value.targetCount || new Set(value.rows.map(row => row?.userId)).size !== value.rows.length) return null;
  if (value.rows.some(row => !transactionRecord(row) || !isUuid(row.userId) || row.userCouponId !== null && !isUuid(row.userCouponId) || typeof row.nickname !== 'string' || row.reason !== null && typeof row.reason !== 'string')) return null;
  if (Number(value.plannedCount) > Number(value.targetCount) || Number(value.existingCount) > Number(value.targetCount) || Number(value.invalidCount) > Number(value.targetCount)
    || value.status === 'completed' && (Number(value.issuedCount) + Number(value.existingCount) !== value.targetCount || value.invalidCount !== 0 || value.error !== null || !value.finishedAt)
    || value.status !== 'completed' && value.issuedCount !== 0 || value.status === 'failed' && (!value.error || !value.finishedAt)
    || value.canExecute && value.status !== 'prepared') return null;
  return value as unknown as CouponIssueBatch;
}
