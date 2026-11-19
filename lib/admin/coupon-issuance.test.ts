import { describe, expect, it } from 'vitest';
import { couponIssueCustomerIds, parseCouponIssueTargets, parseCouponIssueBatch } from './coupon-issuance';
const id = 'bf701900-0000-4000-8000-000000000001', other = 'bf701900-0000-4000-8000-000000000002';
describe('쿠폰 지정 발급 계약', () => {
  it('고객 ID를 정규화하고 중복·비회원 입력을 제한한다', () => {
    expect(couponIssueCustomerIds(`${id}\n${id.toUpperCase()}`)).toEqual([id]);
    expect(couponIssueCustomerIds('name@example.test')).toBeNull();
    expect(parseCouponIssueTargets({ kind: 'customers', userIds: [id, id] })).toBeNull();
    expect(parseCouponIssueTargets({ kind: 'customers', userIds: [other, id] })).toEqual({ kind: 'customers', userIds: [id, other] });
    expect(parseCouponIssueTargets({ kind: 'segment', segmentId: id, revision: 2 })).not.toBeNull();
    expect(parseCouponIssueTargets({ kind: 'segment', segmentId: id, revision: 0 })).toBeNull();
  });
  it('실제 발급 합계와 최종 상태를 검증한다', () => {
    const batch = { id, couponCode: 'TEST-CODE', couponName: '쿠폰', couponRevision: 1, targetKind: 'customers', segmentName: null, status: 'completed',
      targetCount: 1, plannedCount: 1, existingCount: 0, invalidCount: 0, issuedCount: 1, createdAt: '2026-10-16T01:00:00Z', validUntil: '2026-10-16T01:15:00Z', finishedAt: '2026-10-16T01:01:00Z', error: null,
      rows: [{ userId: other, userCouponId: id, nickname: '검증', reason: null }], canExecute: false };
    expect(parseCouponIssueBatch(batch)).not.toBeNull();
    for (const patch of [{ issuedCount: 2 }, { canExecute: true }, { finishedAt: null }, { status: 'prepared' }, { rows: [] }]) expect(parseCouponIssueBatch({ ...batch, ...patch })).toBeNull();
    /* 발급 문서가 줄마다 싣는 보유·회수 상태(회수 화면용)는 선택 값이고 모양을 확인한다. */
    expect(parseCouponIssueBatch({ ...batch, rows: [{ ...batch.rows[0], heldStatus: 'active', revokedAt: '2026-10-16T02:00:00Z' }] })).not.toBeNull();
    expect(parseCouponIssueBatch({ ...batch, rows: [{ ...batch.rows[0], heldStatus: 'revoked' }] })).toBeNull();
    expect(parseCouponIssueBatch({ ...batch, rows: [{ ...batch.rows[0], revokedAt: 'yesterday' }] })).toBeNull();
    expect(parseCouponIssueBatch({ ...batch, status: 'failed', issuedCount: 0, error: 'coupon_issue_failed' })).not.toBeNull();
  });
});
