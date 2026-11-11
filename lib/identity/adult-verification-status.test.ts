import { describe, expect, it } from 'vitest';

import { formatAdultVerificationDate, parseAdultVerificationStatus } from './adult-verification-status';

describe('parseAdultVerificationStatus', () => {
  it('인증·만료·해제 응답을 화면 상태로 좁힌다', () => {
    expect(parseAdultVerificationStatus({
      status: 'verified', verifiedAt: '2026-10-23T06:59:09Z', expiresAt: '2027-10-23T06:59:09Z',
    })).toEqual({ status: 'verified', verifiedAt: '2026-10-23T06:59:09Z', expiresAt: '2027-10-23T06:59:09Z' });
    expect(parseAdultVerificationStatus({
      status: 'expired', verifiedAt: '2025-10-23T00:00:00Z', expiresAt: '2026-10-23T00:00:00Z',
    })).toMatchObject({ status: 'expired' });
    expect(parseAdultVerificationStatus({ status: 'revoked', reason: 'subject_moved', revokedAt: '2026-10-23T00:00:00Z' }))
      .toEqual({ status: 'revoked', reason: 'subject_moved', revokedAt: '2026-10-23T00:00:00Z' });
  });

  it('모르는 상태·사유·날짜는 none으로 접는다', () => {
    expect(parseAdultVerificationStatus(null)).toEqual({ status: 'none' });
    expect(parseAdultVerificationStatus({ status: 'verified', verifiedAt: 'soon', expiresAt: '2027-10-23T00:00:00Z' })).toEqual({ status: 'none' });
    expect(parseAdultVerificationStatus({ status: 'revoked', reason: 'unknown', revokedAt: '2026-10-23T00:00:00Z' })).toEqual({ status: 'none' });
    expect(parseAdultVerificationStatus({ status: 'admin' })).toEqual({ status: 'none' });
  });
});

describe('formatAdultVerificationDate', () => {
  it('KST 달력 날짜로 쓴다', () => {
    expect(formatAdultVerificationDate('2027-10-22T15:00:00Z')).toBe('2027.10.23');
    expect(formatAdultVerificationDate('2027-10-22T14:59:59Z')).toBe('2027.10.22');
    expect(formatAdultVerificationDate('not a date')).toBe('');
  });
});
