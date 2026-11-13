import { describe, expect, it } from 'vitest';
import {
  GRADE_BENEFIT_CADENCE_LABELS, GRADE_BENEFIT_CADENCES, isGradeBenefitCadence, isLoyaltyGrade, LOYALTY_GRADES, LOYALTY_WINDOW_DAYS,
  loyaltyBasisSummary, loyaltyGradeLabel,
} from './loyalty';
describe('grade benefit cadence', () => {
  it('matches the DB check values and labels both cadences', () => {
    expect(GRADE_BENEFIT_CADENCES).toEqual(['upgrade', 'monthly']);
    expect(isGradeBenefitCadence('monthly')).toBe(true);
    expect(isGradeBenefitCadence('weekly')).toBe(false);
    expect(isGradeBenefitCadence(undefined)).toBe(false);
    expect(GRADE_BENEFIT_CADENCE_LABELS).toEqual({ upgrade: '승급 시 1회', monthly: '매월 1일' });
  });
});
describe('loyalty names and timing', () => {
  it('retains the four grades and rolling window', () => {
    expect(LOYALTY_GRADES).toEqual(['welcome', 'silver', 'gold', 'platinum']);
    expect(LOYALTY_WINDOW_DAYS).toBe(90);
    expect(isLoyaltyGrade('vip')).toBe(false);
    expect(isLoyaltyGrade(null)).toBe(false);
    expect(loyaltyGradeLabel('platinum')).toBe('PLATINUM');
  });
  it('describes current configured criteria without hard-coded thresholds', () => {
    const summary = loyaltyBasisSummary();
    expect(summary).toContain('고객등급 관리에 설정된 조건');
    expect(summary).toContain('최신 수동 보정');
    expect(summary).not.toContain('100,000');
  });
});
