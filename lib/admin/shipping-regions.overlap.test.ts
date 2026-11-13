import { describe, expect, it } from 'vitest';
import { shippingRegionPeriodsOverlap, shippingRegionPolicyScheduled } from './shipping-regions';

describe('지역 정책 기간 겹침·예정 판정', () => {
  const NOW = Date.parse('2026-11-09T00:00:00Z');
  it("DB의 '[)' 범위 겹침과 같다 — 맞닿기만 하면 겹치지 않고, 끝이 없으면 무한이다", () => {
    expect(shippingRegionPeriodsOverlap({ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, { startsAt: '2026-12-01T00:00:00Z', endsAt: null })).toBe(false);
    expect(shippingRegionPeriodsOverlap({ startsAt: '2026-11-01T00:00:00Z', endsAt: null }, { startsAt: '2026-12-01T00:00:00Z', endsAt: null })).toBe(true);
    expect(shippingRegionPeriodsOverlap({ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-02T00:00:00Z' }, { startsAt: '2026-12-01T00:00:00Z', endsAt: null })).toBe(true);
  });
  it('시작 전인 활성 정책만 예정이다', () => {
    expect(shippingRegionPolicyScheduled({ status: 'active', startsAt: '2026-12-01T00:00:00Z' }, NOW)).toBe(true);
    expect(shippingRegionPolicyScheduled({ status: 'active', startsAt: '2026-11-01T00:00:00Z' }, NOW)).toBe(false);
    expect(shippingRegionPolicyScheduled({ status: 'draft', startsAt: '2026-12-01T00:00:00Z' }, NOW)).toBe(false);
  });
});
