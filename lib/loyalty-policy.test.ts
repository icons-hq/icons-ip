import { describe, expect, it } from 'vitest';
import { loyaltyProgressNote, parseLoyaltyCriteria, parseLoyaltyPolicy, type LoyaltyCriterion } from './loyalty-policy';
const tiers: LoyaltyCriterion[] = [
  { grade: 'silver', enabled: true, amount: 100000, itemCount: 2 },
  { grade: 'gold', enabled: true, amount: 300000, itemCount: 5 },
  { grade: 'platinum', enabled: true, amount: 1000000, itemCount: 10 },
];
describe('configurable loyalty criteria', () => {
  it('accepts amount, item count or both while keeping the ladder ordered', () => {
    expect(parseLoyaltyCriteria(tiers)).toEqual(tiers);
    expect(parseLoyaltyCriteria(tiers.map(t => ({ ...t, amount: null })))).not.toBeNull();
    expect(parseLoyaltyCriteria(tiers.map(t => ({ ...t, itemCount: null })))).not.toBeNull();
    expect(parseLoyaltyCriteria(tiers.map(t => ({ ...t, enabled: false })))).not.toBeNull();
  });
  it.each([
    tiers.slice(1), [...tiers].reverse(), tiers.map(t => ({ ...t, extra: true })),
    tiers.map(t => ({ ...t, amount: 0 })), tiers.map(t => ({ ...t, itemCount: 1.5 })),
    tiers.map(t => ({ ...t, amount: null, itemCount: null })),
    tiers.map((t, i) => ({ ...t, enabled: i !== 0 })),
    tiers.map(t => ({ ...t, amount: 1000 })),
    tiers.map(t => ({ ...t, itemCount: 1000001 })),
  ])('rejects malformed or contradictory settings', (value) => {
    expect(parseLoyaltyCriteria(value)).toBeNull();
  });
  it('derives both remaining conditions and distinguishes satisfied from top grade', () => {
    expect(loyaltyProgressNote('welcome', 40000, 1, tiers)).toBe('SILVER까지 60,000원 또는 굿즈 주문 항목 1건');
    expect(loyaltyProgressNote('silver', 300000, 2, tiers)).toContain('조건 충족');
    expect(loyaltyProgressNote('silver', 0, 5, tiers)).toContain('조건 충족');
    expect(loyaltyProgressNote('welcome', 1000000, 0, tiers)).toBe('PLATINUM 조건 충족 · 다음 재산정 시 반영');
    expect(loyaltyProgressNote('platinum', 0, 0, tiers)).toBeNull();
    expect(loyaltyProgressNote('welcome', 0, 0, tiers.map(t => ({ ...t, enabled: false })))).toBeNull();
  });
  it('rejects missing policy metadata instead of falling back to old thresholds', () => {
    expect(parseLoyaltyPolicy({ tiers, revision: 2, updatedAt: '2026-10-13T03:00:00Z' })?.revision).toBe(2);
    expect(parseLoyaltyPolicy({ tiers, revision: 0, updatedAt: 'bad' })).toBeNull();
  });
});
