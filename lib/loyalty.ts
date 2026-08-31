/* 회원 등급(Loyalty) 정책의 앱 쪽 미러 (S7 · ADR-0011 B2).
 *
 * 등급 산정의 진실원은 private.recalculate_loyalty_grade 다. 여기 상수는 프로필
 * 스트립의 "다음 등급까지 얼마" 안내와 어드민 기준 표기를 위한 표시용 파생이고,
 * 마이그레이션의 임계값과 어긋나면 안내가 거짓말이 된다 — loyalty.test.ts 가
 * 마지막 정의 마이그레이션에서 값을 읽어 두 구현을 묶는다.
 *
 * 용어: 무료 등급이다. 멤버십(유료 v2)·VIP·티어 어휘를 쓰지 않는다(CONTEXT.md). */

export const LOYALTY_GRADES = ['welcome', 'silver', 'gold', 'platinum'] as const;

export type LoyaltyGrade = (typeof LOYALTY_GRADES)[number];

/** 산정 창 — 최근 N일의 결제 확정 실적만 본다. */
export const LOYALTY_WINDOW_DAYS = 90;

/** 등급별 실적 하한(원). WELCOME 은 시작 등급이라 하한이 없다. */
export const LOYALTY_THRESHOLDS: Record<Exclude<LoyaltyGrade, 'welcome'>, number> = {
  silver: 100000,
  gold: 300000,
  platinum: 1000000,
};

export function isLoyaltyGrade(value: unknown): value is LoyaltyGrade {
  return typeof value === 'string' && (LOYALTY_GRADES as readonly string[]).includes(value);
}

export function loyaltyGradeForSpend(spend: number): LoyaltyGrade {
  if (spend >= LOYALTY_THRESHOLDS.platinum) return 'platinum';
  if (spend >= LOYALTY_THRESHOLDS.gold) return 'gold';
  if (spend >= LOYALTY_THRESHOLDS.silver) return 'silver';
  return 'welcome';
}

/** 뱃지·안내 표기. 등급명은 대문자 일반명사다. */
export function loyaltyGradeLabel(grade: LoyaltyGrade): string {
  return grade.toUpperCase();
}

/** 어드민 화면들이 공유하는 산정 기준 안내 한 문단 — 임계값·창·재산정 시점을
 * 한 곳에서 말해야 등급 분쟁 때 안내가 갈라지지 않는다. */
export function loyaltyBasisSummary(): string {
  const won = (value: number) => value.toLocaleString('ko-KR');
  return `산정 기준: 최근 ${LOYALTY_WINDOW_DAYS}일 결제 확정(취소 제외) 주문 총액이 `
    + `SILVER ${won(LOYALTY_THRESHOLDS.silver)}원 · GOLD ${won(LOYALTY_THRESHOLDS.gold)}원 · `
    + `PLATINUM ${won(LOYALTY_THRESHOLDS.platinum)}원 이상이면 승급됩니다. `
    + '재산정은 결제 확정·취소 시점과 수동 재산정에서 일어나며, '
    + '창 안의 수동 보정 등급은 재산정의 하한으로 유지됩니다.';
}

export interface NextLoyaltyGrade {
  grade: LoyaltyGrade;
  threshold: number;
  remaining: number;
}

/** 다음 등급과 남은 실적. 최상위 등급이면 null. */
export function nextLoyaltyGrade(current: LoyaltyGrade, spend: number): NextLoyaltyGrade | null {
  const index = LOYALTY_GRADES.indexOf(current);
  const next = LOYALTY_GRADES[index + 1];
  if (!next || next === 'welcome') return null;
  const threshold = LOYALTY_THRESHOLDS[next];
  return { grade: next, threshold, remaining: Math.max(0, threshold - Math.max(0, spend)) };
}
