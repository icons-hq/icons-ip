import { describe, expect, it } from 'vitest';
import { couponRevokeError, couponRevokeSummary, parseCouponRevokeResult } from './coupon-revoke';

const op = 'bf702800-0000-4000-8000-000000000001', a = 'bf702800-0000-4000-8000-000000000002', b = 'bf702800-0000-4000-8000-000000000003';
const result = { operationId: op, requestedCount: 2, revokedCount: 1, lines: [{ userCouponId: a, status: 'revoked', couponCode: 'X', userId: op }, { userCouponId: b, status: 'in_use' }] };

describe('쿠폰 회수 결과 계약', () => {
  it('줄 상태와 건수가 맞는 응답만 읽는다', () => {
    expect(parseCouponRevokeResult(result)).toMatchObject({ revokedCount: 1, replayed: false });
    expect(parseCouponRevokeResult({ ...result, replayed: true })?.replayed).toBe(true);
    for (const patch of [{ revokedCount: 2 }, { requestedCount: 3 }, { lines: [{ userCouponId: a, status: 'gone' }, result.lines[1]] }, { operationId: 'x' }]) {
      expect(parseCouponRevokeResult({ ...result, ...patch })).toBeNull();
    }
    expect(parseCouponRevokeResult(null)).toBeNull();
  });

  it('회수하지 않은 줄의 이유를 한 번씩 알린다', () => {
    const parsed = parseCouponRevokeResult(result)!;
    expect(couponRevokeSummary(parsed)).toContain('1장을 회수했고 1장은 회수하지 않았습니다');
    expect(couponRevokeSummary(parsed)).toContain('결제 대기 주문이 사용 중');
    expect(couponRevokeSummary({ ...parsed, requestedCount: 1, revokedCount: 1, lines: [parsed.lines[0]] })).toBe('1장을 회수했습니다.');
  });

  it('DB 거절 코드를 운영자 문구로 바꾸고 모르는 오류는 일반 문구로 접는다', () => {
    expect(couponRevokeError('coupon_revoke_reason_invalid')).toContain('회수 사유');
    expect(couponRevokeError('operator_capability_required')).toContain('마케팅 관리');
    expect(couponRevokeError('boom')).toContain('회수하지 못했습니다');
    expect(couponRevokeError(undefined)).toContain('회수하지 못했습니다');
  });
});
