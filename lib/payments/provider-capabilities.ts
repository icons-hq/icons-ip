/**
 * 결제사 취소 API로 전액 취소를 발행하고 조회로 확인하는 카드 provider. 토스(주문서형 v2)와
 * 나이스페이(웹표준, 2026-11-06)다. 코페이는 취소·조회 API가 없어 결제사 이메일 접수와
 * 수동 확인(수동 복구 seam)으로 닫고, 무통장은 계좌 송금으로 돌려준다.
 *
 * DB의 같은 판정(admin_start_order_cancellation · complete_order_cancellation_request ·
 * admin_record_order_claim_refund · finalize_goods_payment_attempt의 취소 경합 분기 ·
 * reconcile_expired_prepared_goods_cancellation)과 목록을 맞춘다
 * (20261106100100_nicepay_goods_payment_seam.sql).
 */
export const AUTOMATED_CANCEL_PROVIDERS = ['toss', 'nicepay'] as const;

export type AutomatedCancelProvider = (typeof AUTOMATED_CANCEL_PROVIDERS)[number];

export function providerCancelsAutomatically(provider: unknown): provider is AutomatedCancelProvider {
  return typeof provider === 'string'
    && (AUTOMATED_CANCEL_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * 운영 화면 문장에 쓰는 결제사 이름표. 결제사 이름을 문장에 직접 적지 않고 이 표에서 읽는다 —
 * 나이스페이 결제에 '토스'라고 말하거나 같은 결제사를 Korpay·코페이 두 이름으로 부르지 않게 한다.
 */
export const PAYMENT_PROVIDER_LABELS = {
  toss: '토스',
  nicepay: '나이스페이',
  korpay: '코페이',
  bank_transfer: '무통장 입금',
} as const;

/** 운영 화면 문구에 쓰는 결제사 짧은 이름. 토스 문구("토스 전액 취소")는 그대로 유지한다. */
export function automatedCancelProviderLabel(provider: AutomatedCancelProvider) {
  return PAYMENT_PROVIDER_LABELS[provider];
}

/** 결제사 이름. 이름표에 없는 값이나 결제가 없는 주문은 null이다 — 화면은 '결제사'처럼 이름 없는 말로 받는다. */
export function paymentProviderLabel(provider: unknown): string | null {
  return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_PROVIDER_LABELS, provider)
    ? PAYMENT_PROVIDER_LABELS[provider as keyof typeof PAYMENT_PROVIDER_LABELS]
    : null;
}
