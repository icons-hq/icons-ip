import { transactionInteger, transactionInstant, transactionRecord } from '@/lib/goods-transaction-values';
import { marketingCouponCode } from './marketing-coupons';
import { isUuid } from '@/lib/uuid';
export const COUPON_ISSUE_PATH = '/admin/sales/coupons/issue';
export type CouponIssueTargets = { kind: 'customers'; userIds: string[] } | { kind: 'segment'; segmentId: string; revision: number };
/** 발급 작업 결과 줄. heldStatus·revokedAt 은 그 쿠폰의 지금 상태다(회수 화면이 쓴다 — 없으면 상태를 모르는 줄). */
export interface CouponIssueRow { userId: string; userCouponId: string | null; nickname: string; reason: string | null; heldStatus?: 'active' | 'used' | null; revokedAt?: string | null;
  /** 같은 쿠폰을 회수한 이력이 있어 새로 발급하지 않고(실행도 막지 않고) 건너뛰는 고객. */ excluded?: 'revoked' }
export interface CouponIssueBatch { id: string; couponCode: string; couponName: string; couponRevision: number; targetKind: 'customers' | 'segment'; segmentName: string | null;
  status: 'prepared' | 'invalid' | 'completed' | 'failed'; targetCount: number; plannedCount: number; existingCount: number; invalidCount: number; issuedCount: number;
  createdAt: string; validUntil: string; finishedAt: string | null; error: string | null; rows: CouponIssueRow[]; canExecute: boolean }
export const COUPON_ISSUE_ERRORS: Record<string, string> = {
  coupon_issue_auth_changed: '로그인 계정이 바뀌었습니다. 지금 로그인한 관리자 계정으로 화면을 새로고침해주세요.', coupon_issue_operation_conflict: '앞서 보낸 발급 요청과 내용이 달라 처리하지 않았습니다. ‘현재 작업 결과 조회’로 저장된 결과를 확인해주세요.',
  coupon_issue_target_limit: '세그먼트가 1,000명을 넘습니다. 조건을 좁혀서 다시 확인해주세요.', coupon_issue_no_targets: '조건에 맞는 고객이 없습니다.',
  coupon_issue_invalid_targets: '발급 조건을 충족하지 않는 고객이 있습니다. 대상을 수정해주세요.', coupon_exhausted: '쿠폰 잔여 발급 한도가 부족합니다.',
  coupon_not_found: '쿠폰이 없거나 발급·사용이 중단됐습니다.', coupon_issue_not_started: '쿠폰 발급 시작 전입니다.', coupon_not_started: '쿠폰 시작 전입니다.',
  coupon_issue_ended: '쿠폰 발급기간이 끝났습니다.', coupon_expired: '쿠폰 사용기간이 끝났습니다.', coupon_customer_unavailable: '현재 발급할 수 없는 고객 계정입니다.',
  coupon_first_purchase_only: '첫구매 대상이 아닙니다.', coupon_repeat_purchase_only: '구매 이력이 필요한 쿠폰입니다.',
  customer_segment_changed: '세그먼트가 수정·삭제됐거나 회원 방문·영상 분석 수집이 꺼졌습니다. 세그먼트를 다시 골라 확인해주세요.', coupon_issue_segment_changed: '대상을 확인한 뒤 이 고객의 세그먼트 조건이 바뀌었습니다.',
  coupon_issue_preview_stale: '대상을 확인한 지 15분이 지났습니다. ‘대상 다시 확인’으로 새로 확인해주세요.', coupon_issue_policy_changed: '대상을 확인한 뒤 쿠폰 내용이 바뀌었습니다. ‘대상 다시 확인’으로 새로 확인해주세요.',
  coupon_issue_failed: '발급을 완료하지 못했습니다. 이 작업에서 새로 발급한 쿠폰은 없습니다.', coupon_issue_batch_not_found: "지금 로그인에서 실행할 수 없는 작업입니다(다른 운영자나 다른 로그인에서 만든 작업). '대상 다시 확인'으로 새로 확인해주세요.",
};
export function couponIssueError(code: string | null | undefined) { return code ? COUPON_ISSUE_ERRORS[code] ?? '발급하지 못했습니다. 쿠폰의 발급 기간·남은 발급 한도와 쿠폰 발급 권한이 있는지 확인한 뒤 다시 시도해주세요.' : ''; }
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
  if (value.rows.some(row => !transactionRecord(row) || !isUuid(row.userId) || row.userCouponId !== null && !isUuid(row.userCouponId) || typeof row.nickname !== 'string' || row.reason !== null && typeof row.reason !== 'string'
    || row.heldStatus != null && !['active', 'used'].includes(String(row.heldStatus)) || row.revokedAt != null && !transactionInstant(row.revokedAt) || row.excluded !== undefined && row.excluded !== 'revoked')) return null;
  if (Number(value.plannedCount) > Number(value.targetCount) || Number(value.existingCount) > Number(value.targetCount) || Number(value.invalidCount) > Number(value.targetCount)
    || value.status === 'completed' && (Number(value.issuedCount) + Number(value.existingCount) !== value.targetCount || value.invalidCount !== 0 || value.error !== null || !value.finishedAt)
    || value.status !== 'completed' && value.issuedCount !== 0 || value.status === 'failed' && (!value.error || !value.finishedAt)
    || value.canExecute && value.status !== 'prepared') return null;
  return value as unknown as CouponIssueBatch;
}

/** 쿠폰 상세에서 다시 열 수 있는 최근 발급 작업(admin_list_coupon_issues). */
export interface CouponIssueSummary { id: string; status: 'completed' | 'failed'; createdAt: string; finishedAt: string | null; targetCount: number; issuedCount: number; revokedCount: number }
export function parseCouponIssueSummaries(value: unknown): CouponIssueSummary[] | null {
  if (!Array.isArray(value)) return null;
  const rows: CouponIssueSummary[] = [];
  for (const row of value) {
    if (!transactionRecord(row) || !isUuid(row.id) || !['completed', 'failed'].includes(String(row.status)) || !transactionInstant(row.createdAt)
      || row.finishedAt !== null && !transactionInstant(row.finishedAt) || ![row.targetCount, row.issuedCount, row.revokedCount].every(count => transactionInteger(count, 0, 1000))) return null;
    rows.push(row as unknown as CouponIssueSummary);
  }
  return rows;
}
