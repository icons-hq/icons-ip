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

/** 구체적인 조건은 고객등급 관리에서 조회한다. 고정 임계값을 안내하지 않는다. */
export function loyaltyBasisSummary(): string {
  return `산정 기준: 최근 ${LOYALTY_WINDOW_DAYS}일 결제 확정(취소 제외) 주문의 총 청구액 또는 상품 주문 항목 수를 고객등급 관리에 설정된 조건과 비교합니다. `
    + '재산정은 결제 확정·취소 시점, 매월 1일 등급 쿠폰 지급 직전(지급 대상 회원)과 수동 재산정에서 일어나며, '
    + '창 안의 최신 수동 보정 등급은 재산정의 하한으로 유지됩니다. 정책 저장만으로 기존 회원을 일괄 재산정하지 않습니다.';
}
