import { transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

/* 지정 발급 쿠폰 개별 회수(PAY-034) — admin_revoke_user_coupons 의 요청·응답 계약.
 * 미사용 쿠폰만 회수되고, 결제 대기 주문이 잡은 쿠폰은 줄 단위로 거절된다. */
export const COUPON_REVOKE_MAX = 500;
export const COUPON_REVOKE_REASON_MIN = 2;
export const COUPON_REVOKE_REASON_MAX = 500;

export type CouponRevokeLineStatus = 'revoked' | 'already_revoked' | 'in_use' | 'used' | 'not_found';
export interface CouponRevokeLine { userCouponId: string; status: CouponRevokeLineStatus }
export interface CouponRevokeResult { operationId: string; requestedCount: number; revokedCount: number; replayed: boolean; lines: CouponRevokeLine[] }

export const COUPON_REVOKE_LINE_LABELS: Record<CouponRevokeLineStatus, string> = {
  revoked: '회수함',
  already_revoked: '이미 회수한 쿠폰',
  in_use: '결제를 마치지 않은 주문이 쿠폰을 잡고 있어 회수하지 않았습니다. 그 주문이 취소돼 쿠폰이 풀린 뒤 다시 회수하세요.',
  used: '이미 사용한 쿠폰이라 회수하지 않았습니다.',
  not_found: '쿠폰을 찾을 수 없습니다.',
};

export const COUPON_REVOKE_ERRORS: Record<string, string> = {
  operator_capability_required: '쿠폰 회수 권한(마케팅 관리)이 필요합니다.',
  coupon_revoke_reason_invalid: `회수 사유를 ${COUPON_REVOKE_REASON_MIN}~${COUPON_REVOKE_REASON_MAX}자로 적어주세요.`,
  coupon_revoke_targets_invalid: `회수할 쿠폰을 1~${COUPON_REVOKE_MAX}개 골라주세요.`,
  coupon_revoke_operation_conflict: '앞서 보낸 회수 요청과 내용이 달라 회수하지 않았습니다. 화면을 새로고침한 뒤 쿠폰을 다시 골라 회수해주세요.',
  coupon_revoke_operation_required: '요청 번호가 없어 회수하지 않았습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
};
export const COUPON_REVOKE_FALLBACK = '쿠폰을 회수하지 못했습니다. 화면을 새로고침해 쿠폰 상태를 확인한 뒤 다시 시도해주세요.';

export function couponRevokeError(message: string | null | undefined): string {
  const normalized = typeof message === 'string' ? message : '';
  for (const [code, label] of Object.entries(COUPON_REVOKE_ERRORS)) if (normalized.includes(code)) return label;
  return COUPON_REVOKE_FALLBACK;
}

const LINE_STATUSES: readonly string[] = ['revoked', 'already_revoked', 'in_use', 'used', 'not_found'];

export function parseCouponRevokeResult(value: unknown): CouponRevokeResult | null {
  if (!transactionRecord(value) || !isUuid(value.operationId) || !transactionInteger(value.requestedCount, 1, COUPON_REVOKE_MAX)
    || !transactionInteger(value.revokedCount, 0, COUPON_REVOKE_MAX) || !Array.isArray(value.lines) || value.lines.length !== value.requestedCount) return null;
  const lines: CouponRevokeLine[] = [];
  for (const line of value.lines) {
    if (!transactionRecord(line) || !isUuid(line.userCouponId) || !LINE_STATUSES.includes(String(line.status))) return null;
    lines.push({ userCouponId: line.userCouponId, status: line.status as CouponRevokeLineStatus });
  }
  if (lines.filter(line => line.status === 'revoked').length !== value.revokedCount) return null;
  return { operationId: value.operationId, requestedCount: value.requestedCount as number, revokedCount: value.revokedCount as number, replayed: value.replayed === true, lines };
}

/** 회수 결과 안내. 회수하지 않은 줄이 있으면 그 이유를 한 번씩 덧붙인다. */
export function couponRevokeSummary(result: CouponRevokeResult): string {
  const skipped = result.requestedCount - result.revokedCount;
  if (skipped <= 0) return `${result.revokedCount}장을 회수했습니다.`;
  const reasons = [...new Set(result.lines.filter(line => line.status !== 'revoked').map(line => COUPON_REVOKE_LINE_LABELS[line.status]))];
  return `${result.revokedCount}장을 회수했고 ${skipped}장은 회수하지 않았습니다. ${reasons.join(' ')}`;
}
