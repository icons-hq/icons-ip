/* 무료 회원 등급의 고정 명칭과 재산정 시점. 조건의 정본은 DB loyalty_settings. */

export const LOYALTY_GRADES = ['welcome', 'silver', 'gold', 'platinum'] as const;

export type LoyaltyGrade = (typeof LOYALTY_GRADES)[number];

/** 산정 창 — 최근 N일의 결제 확정 실적만 본다. */
export const LOYALTY_WINDOW_DAYS = 90;

export function isLoyaltyGrade(value: unknown): value is LoyaltyGrade {
  return typeof value === 'string' && (LOYALTY_GRADES as readonly string[]).includes(value);
}

/** 뱃지·안내 표기. 등급명은 대문자 일반명사다. */
export function loyaltyGradeLabel(grade: LoyaltyGrade): string {
  return grade.toUpperCase();
}

/**
 * 등급 혜택 쿠폰의 지급 방식(S36-062). 정본은 DB coupons.grade_benefit_cadence.
 * - upgrade: 그 등급에 오를 때(건너뛰어 오를 때 포함) 한 번.
 * - monthly: 매월 1일(KST) 그 시점 등급이 쿠폰 등급 이상인 회원에게 한 장씩. 지난달 몫은 소급하지 않는다.
 */
export const GRADE_BENEFIT_CADENCES = ['upgrade', 'monthly'] as const;

export type GradeBenefitCadence = (typeof GRADE_BENEFIT_CADENCES)[number];

export function isGradeBenefitCadence(value: unknown): value is GradeBenefitCadence {
  return typeof value === 'string' && (GRADE_BENEFIT_CADENCES as readonly string[]).includes(value);
}

/** 지급 방식의 짧은 표기 — 운영 화면의 목록·선택지와 고객 안내가 같은 말을 쓴다. */
export const GRADE_BENEFIT_CADENCE_LABELS: Record<GradeBenefitCadence, string> = {
  upgrade: '승급 시 1회',
  monthly: '매월 1일',
};

