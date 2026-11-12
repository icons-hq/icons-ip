/**
 * 결제 취소 확정 실패 코드를 운영자 말로 옮긴다. 코드는 DB·가이드 계약이라 지우지 않고 뒤에 함께 적는다.
 * 코드별 조치 근거: 가이드 '취소·반품·교환 관리'의 결제사 확인 오류 코드.
 */
type PaymentCancelErrorCopy = { label: string; next: string };

const RETRY: PaymentCancelErrorCopy = { label: '결제사 응답을 받지 못했습니다', next: '잠시 뒤 [환불 완료 확정]을 다시 눌러주세요.' };
const HAND_OVER = '다시 눌러도 같은 결과가 나오니 결제 담당자에게 넘겨주세요.';

const COPY: Record<string, PaymentCancelErrorCopy> = {
  provider_unavailable: RETRY,
  provider_cancel_ambiguous: RETRY,
  provider_cancel_rejected: { label: '결제사가 취소를 거절했습니다', next: '결제 담당자가 원인을 해소한 뒤 [환불 완료 확정]을 눌러주세요.' },
  provider_cancel_failed: { label: '결제사 취소에 실패했습니다', next: '결제 담당자에게 원인 확인을 요청한 뒤 [환불 완료 확정]으로 다시 시도해주세요.' },
  provider_merchant_mismatch: { label: 'ICONS 상점의 결제가 아닙니다', next: HAND_OVER },
  provider_payment_not_found: { label: '결제사에서 이 결제를 찾지 못했습니다', next: HAND_OVER },
  provider_identity_mismatch: { label: '결제 정보가 일치하지 않습니다', next: HAND_OVER },
  provider_configuration_error: { label: '결제 연결 설정에 문제가 있습니다', next: HAND_OVER },
  provider_mismatch: { label: '결제 정보가 일치하지 않습니다', next: HAND_OVER },
  // 반품배송비 차감 부분 취소(ADR-0031): 결제사 잔액이 이 취소 전·후의 기대값과 다르다 — 다른 취소가 끼어들었을 수 있다.
  provider_balance_mismatch: { label: '결제사 잔액이 예상과 다릅니다', next: `결제사 관리자에서 이 결제의 취소 내역을 확인해주세요. ${HAND_OVER}` },
};

const UNKNOWN: PaymentCancelErrorCopy = { label: '결제사 확인에 실패했습니다', next: '가이드의 취소·반품·교환 관리에서 코드별 조치를 확인해주세요.' };

export function adminPaymentCancelErrorCopy(code: string): PaymentCancelErrorCopy {
  return COPY[code] ?? UNKNOWN;
}

/** 목록·상세의 한 줄 표시. 예: `결제사 응답을 받지 못했습니다 (provider_unavailable)` */
export function adminPaymentCancelErrorLabel(code: string): string {
  return `${adminPaymentCancelErrorCopy(code).label} (${code})`;
}

/** 처리 직후 알림. 환불이 끝났는지 모르는 상태임을 먼저 말한다. */
export function adminPaymentCancelFailureMessage(code: string): string {
  const copy = adminPaymentCancelErrorCopy(code);
  return `결제 취소를 확정하지 못했습니다 — ${copy.label}. 고객 환불이 끝났는지 아직 확인되지 않았고, 주문과 재고는 그대로입니다. ${copy.next} (${code})`;
}
