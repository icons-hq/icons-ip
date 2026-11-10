import { describe, expect, it } from 'vitest';
import { normalizeAdminCouponForm, couponPhase } from './coupons';
import { parseCouponIssueSchedule } from './coupon-schedule';
import { couponDisplayState, couponEffectiveExpiresAt } from '@/lib/coupons';

function form(extra: Record<string, string>) {
  const data = new FormData();
  Object.entries({ code: 'SCHEDULE-7', name: '기간 검증', discountType: 'fixed', discountValue: '1000', status: 'active', startsAt: '2026-10-10T00:00', endsAt: '2026-10-30T23:59', ...extra }).forEach(([key, value]) => data.set(key, value));
  return data;
}
describe('coupon issuance and held expiry', () => {
  it('can issue before the use start, but not after the last usable time', () => {
    const result = normalizeAdminCouponForm(form({ issueStartsAt: '2026-10-01T09:00', issueEndsAt: '2026-10-05T18:00' }));
    expect(result).toMatchObject({ ok: true, value: { issueStartsAt: '2026-10-01T00:00:00.000Z', startsAt: '2026-10-09T15:00:00.000Z', validDays: null } });
    expect(normalizeAdminCouponForm(form({ issueStartsAt: '2026-11-01T09:00' }))).toMatchObject({ ok: false, errors: { issueStartsAt: expect.any(String) } });
    expect(normalizeAdminCouponForm(form({ issueStartsAt: '2026-10-01T09:00', issueEndsAt: '2026-11-05T18:00' }))).toMatchObject({ ok: false, errors: { issueEndsAt: expect.any(String) } });
  });
  it('relative mode ignores inactive period inputs and validates whole days', () => {
    const values = { validityMode: 'relative', issueStartsAt: '2026-10-01T09:00', issueEndsAt: '2026-10-20T18:00', validDays: '3', startsAt: 'bad', endsAt: 'bad' };
    expect(normalizeAdminCouponForm(form(values))).toMatchObject({ ok: true, value: { endsAt: null, startsAt: '2026-10-01T00:00:00.000Z', validDays: 3 } });
    for (const validDays of ['', '0', '-1', '1.2', '366', 'NaN']) expect(normalizeAdminCouponForm(form({ ...values, validDays }))).toMatchObject({ ok: false, errors: { validDays: expect.any(String) } });
  });
  it('keeps captured expiry independent from a changed definition', () => {
    expect(couponEffectiveExpiresAt({ expiresAt: '2026-10-20T00:00:00Z', coupon: { endsAt: '2026-10-10T00:00:00Z', usesValiditySnapshot: true } })).toBe('2026-10-20T00:00:00Z');
    expect(couponEffectiveExpiresAt({ expiresAt: null, coupon: { endsAt: '2026-10-10T00:00:00Z', usesValiditySnapshot: true } })).toBeNull();
    expect(couponEffectiveExpiresAt({ expiresAt: '2026-10-20T00:00:00Z', coupon: { endsAt: '2026-10-10T00:00:00Z' } })).toBe('2026-10-10T00:00:00Z');
  });
  it('uses the held start after an issuance restart or validity mode change', () => {
    expect(couponDisplayState({ status: 'active', expiresAt: '2026-10-20T00:00:00Z', usableFrom: '2026-10-01T00:00:00Z', coupon: { endsAt: null, startsAt: '2026-10-10T00:00:00Z', usesValiditySnapshot: true } }, Date.parse('2026-10-05T00:00:00Z'))).toBe('usable');
  });
  it('rejects malformed returned schedules', () => {
    expect(parseCouponIssueSchedule({ valid_days: 0 })).toBeNull();
    expect(parseCouponIssueSchedule({ issue_starts_at: 'not-a-date' })).toBeNull();
    expect(parseCouponIssueSchedule({})).toEqual({ issueStartsAt: null, issueEndsAt: null, validDays: null });
  });
  it('benefit phase ends with issuance while held coupons may remain usable', () => {
    const coupon = { status: 'active', startsAt: '2026-10-01T00:00:00Z', endsAt: null, issueStartsAt: '2026-10-01T00:00:00Z', issueEndsAt: '2026-10-03T00:00:00Z' } as Parameters<typeof couponPhase>[0];
    expect(couponPhase(coupon, new Date('2026-10-04T00:00:00Z'))).toBe('ended');
    expect(couponPhase({ ...coupon, issueEndsAt: null, endsAt: '2026-10-03T00:00:00Z' }, new Date('2026-10-04T00:00:00Z'))).toBe('ended');
  });
});
