import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOYALTY_THRESHOLDS,
  LOYALTY_WINDOW_DAYS,
  isLoyaltyGrade,
  loyaltyGradeForSpend,
  loyaltyGradeLabel,
  nextLoyaltyGrade,
} from './loyalty';

/*
 * 등급 산정의 진실원은 private.recalculate_loyalty_grade 다. 앱 상수만 고치고
 * 마이그레이션을 빠뜨리면 "다음 등급까지 얼마" 안내와 실제 승급 시점이 어긋난다.
 * 마지막으로 산정을 정의한 마이그레이션에서 값을 읽어 두 구현을 묶는다.
 */
function latestLoyaltyPolicyFromMigrations() {
  const dir = join(process.cwd(), 'supabase/migrations');
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

  let silver: number | null = null;
  let gold: number | null = null;
  let platinum: number | null = null;
  let windowDays: number | null = null;

  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    const platinumMatch = sql.match(/p_spend\s*>=\s*(\d+)\s+then\s+'platinum'/);
    const goldMatch = sql.match(/p_spend\s*>=\s*(\d+)\s+then\s+'gold'/);
    const silverMatch = sql.match(/p_spend\s*>=\s*(\d+)\s+then\s+'silver'/);
    const windowMatch = sql.match(/c_window\s+constant\s+interval\s*:=\s*interval\s*'(\d+) days'/);
    if (platinumMatch) platinum = Number(platinumMatch[1]);
    if (goldMatch) gold = Number(goldMatch[1]);
    if (silverMatch) silver = Number(silverMatch[1]);
    if (windowMatch) windowDays = Number(windowMatch[1]);
  }

  return { silver, gold, platinum, windowDays };
}

describe('loyalty policy', () => {
  it('keeps the app thresholds on the migration numbers', () => {
    const { silver, gold, platinum, windowDays } = latestLoyaltyPolicyFromMigrations();

    expect(silver, 'loyalty_grade_for_spend 의 silver 임계를 찾지 못했다').not.toBeNull();
    expect(gold, 'loyalty_grade_for_spend 의 gold 임계를 찾지 못했다').not.toBeNull();
    expect(platinum, 'loyalty_grade_for_spend 의 platinum 임계를 찾지 못했다').not.toBeNull();
    expect(windowDays, 'recalculate_loyalty_grade 의 c_window 를 찾지 못했다').not.toBeNull();

    expect(silver).toBe(LOYALTY_THRESHOLDS.silver);
    expect(gold).toBe(LOYALTY_THRESHOLDS.gold);
    expect(platinum).toBe(LOYALTY_THRESHOLDS.platinum);
    expect(windowDays).toBe(LOYALTY_WINDOW_DAYS);
  });

  it('grades spend on the same ladder as the database', () => {
    expect(loyaltyGradeForSpend(0)).toBe('welcome');
    expect(loyaltyGradeForSpend(LOYALTY_THRESHOLDS.silver - 1)).toBe('welcome');
    expect(loyaltyGradeForSpend(LOYALTY_THRESHOLDS.silver)).toBe('silver');
    expect(loyaltyGradeForSpend(LOYALTY_THRESHOLDS.gold)).toBe('gold');
    expect(loyaltyGradeForSpend(LOYALTY_THRESHOLDS.platinum)).toBe('platinum');
  });

  it('reports the next grade and the remaining spend', () => {
    expect(nextLoyaltyGrade('welcome', 40000)).toEqual({
      grade: 'silver',
      threshold: LOYALTY_THRESHOLDS.silver,
      remaining: 60000,
    });
    expect(nextLoyaltyGrade('gold', LOYALTY_THRESHOLDS.gold)).toEqual({
      grade: 'platinum',
      threshold: LOYALTY_THRESHOLDS.platinum,
      remaining: LOYALTY_THRESHOLDS.platinum - LOYALTY_THRESHOLDS.gold,
    });
  });

  it('has no next grade above the top grade', () => {
    expect(nextLoyaltyGrade('platinum', 2000000)).toBeNull();
  });

  it('narrows unknown values safely', () => {
    expect(isLoyaltyGrade('gold')).toBe(true);
    expect(isLoyaltyGrade('vip')).toBe(false);
    expect(isLoyaltyGrade(null)).toBe(false);
  });

  it('labels grades as uppercase common nouns', () => {
    expect(loyaltyGradeLabel('welcome')).toBe('WELCOME');
    expect(loyaltyGradeLabel('platinum')).toBe('PLATINUM');
  });
});
