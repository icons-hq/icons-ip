/**
 * 결제 취소 확정 실패 코드를 운영자 말로 옮긴다. 문장은 무슨 일이 있었고 다음에 무엇을 하는지만 말한다.
 * 코드는 DB·가이드 계약이라 지우지 않되 문장에 섞지 않고, '문의할 때 알려 줄 코드'로 한 번만 붙인다.
 * 코드별 조치 근거: 가이드 '취소·반품·교환 관리'의 결제사 확인 오류 코드.
 */
type PaymentCancelErrorCopy = { label: string; next: string };

/** 코드 앞에 붙이는 말. 화면은 이 말과 코드를 작은 글로 한 번만 보인다(`splitAdminSupportCode`). */
export const ADMIN_SUPPORT_CODE_LABEL = '문의할 때 알려 줄 코드';

const RETRY: PaymentCancelErrorCopy = { label: '결제사 응답을 받지 못했습니다', next: '잠시 뒤 [환불 완료 확정]을 다시 눌러주세요.' };
const HAND_OVER = '다시 눌러도 같은 결과가 나오니 결제 담당자에게 넘겨주세요. 요청번호와 코드를 함께 알려주면 됩니다.';

const COPY: Record<string, PaymentCancelErrorCopy> = {
  provider_unavailable: RETRY,
  provider_cancel_ambiguous: RETRY,
  provider_cancel_rejected: { label: '결제사가 취소를 거절했습니다', next: '결제 담당자에게 요청번호와 코드를 알려주세요. 결제 담당자가 결제사 관리자 화면에서 거절 사유를 확인해 해결한 뒤 [환불 완료 확정]을 다시 누릅니다.' },
  provider_cancel_failed: { label: '결제사 취소에 실패했습니다', next: '결제 담당자에게 요청번호와 코드를 알려 원인 확인을 요청한 뒤 [환불 완료 확정]을 다시 눌러주세요.' },
  provider_merchant_mismatch: { label: '엑스스퀘어 상점의 결제가 아닙니다', next: HAND_OVER },
  provider_payment_not_found: { label: '결제사에서 이 결제를 찾지 못했습니다', next: HAND_OVER },
  provider_identity_mismatch: { label: '결제 정보가 일치하지 않습니다', next: HAND_OVER },
  provider_configuration_error: { label: '결제 연결 설정에 문제가 있습니다', next: HAND_OVER },
  provider_mismatch: { label: '결제 정보가 일치하지 않습니다', next: HAND_OVER },
  // 반품배송비 차감 부분 취소(ADR-0031): 결제사 잔액이 이 취소 전·후의 기대값과 다르다 — 다른 취소가 끼어들었을 수 있다.
  provider_balance_mismatch: { label: '결제사 잔액이 예상과 다릅니다', next: `결제사 관리자에서 이 결제의 취소 내역을 확인해주세요. ${HAND_OVER}` },
  /* 토스 가상계좌(ADR-0049). 입금 뒤 환불은 고객 환불 계좌로만 나간다 — 계좌가 없거나 결제사가 계좌를 받지 않으면 결제사를 다시 부르지 않고 멈춘다. */
  provider_refund_account_required: {
    label: '환불 계좌가 없어 가상계좌 결제를 환불하지 못했습니다',
    next: '고객에게 주문 상세에서 계좌를 입력해 달라는 앱 알림과 메일이 자동으로 갑니다. 고객이 주문 상세에서 환급 계좌를 입력하면 취소는 그 계좌로 자동으로 다시 환불하고, 반품은 운영 알림이 오면 [환불 완료 확정](주문 처리 화면에서는 [상태 다시 확인])을 눌러 그 계좌로 환불합니다. 고객이 전화 등으로 계좌를 알려주면 이 화면의 환불 계좌 칸에 입력 사유와 함께 대신 입력합니다(취소는 저장하면 자동으로 다시 환불, 반품은 저장한 뒤 같은 버튼). 토스페이먼츠 상점관리자에서 환불한 뒤 같은 버튼을 눌러도 닫힙니다.',
  },
  provider_refund_account_invalid: {
    label: '결제사가 환불 계좌를 받지 않았습니다',
    next: '고객에게 주문 상세에서 환급 계좌(은행·계좌번호·예금주)를 다시 입력해 달라는 앱 알림과 메일이 자동으로 갑니다. 취소는 바뀐 계좌로 자동으로 다시 환불하고, 반품은 계좌가 바뀌면 [환불 완료 확정]을 눌러 그 계좌로 환불합니다. 고객이 전화 등으로 알려준 계좌는 이 화면의 환불 계좌 칸에 대신 입력할 수 있습니다.',
  },
  provider_refund_failed: {
    label: '결제는 취소됐지만 고객 계좌로 환불 송금이 실패했습니다',
    next: '토스페이먼츠 상점관리자에서 환불 실패 사유를 확인하고, 고객에게 맞는 환불 계좌를 받아 다시 환불한 뒤 [환불 완료 확정]을 다시 눌러주세요. 환불이 끝난 뒤 송금이 실패한 건은 주문 처리 화면의 \'환불 송금\' 줄과 시스템 상태에 따로 보입니다.',
  },
  /* 입금 오류 되돌림(ADR-0049 결정 4): 은행이 입금을 취소해 돈이 없다 — 환불하지 않고 계좌 반납이 먼저다. */
  provider_deposit_reversed: {
    label: '은행이 가상계좌 입금을 취소해 입금된 돈이 없습니다',
    next: '시스템이 가상계좌를 반납한 뒤 이 요청을 결제 없이 마저 닫습니다(환불 없음, 자동 재확인 주기 10~30분). 주문 상세의 출고 보류 안내가 \'입금 오류 되돌림\'을 보이면 기다리면 됩니다. 30분이 지나도 그대로면 [환불 완료 확정]을 다시 누르세요 — 반납부터 다시 시도합니다. 출고 보류 안내가 \'확인 필요\'면 그 안내를 따릅니다.',
  },
  provider_virtual_account_released: {
    label: '입금 전에 가상계좌를 반납했습니다',
    next: '입금된 돈이 없어 환불할 금액이 없습니다. 화면을 새로고침해 주문이 취소됐는지 확인해주세요.',
  },
  provider_deposit_expired: {
    label: '입금 기한이 지나 가상계좌가 닫혔습니다',
    next: '입금된 돈이 없어 주문은 자동 취소되고 재고·쿠폰·적립금이 돌아갑니다. 화면을 새로고침해 확인해주세요.',
  },
  provider_virtual_account_canceled: {
    label: '결제사에서 가상계좌 결제가 취소됐습니다',
    next: '입금 전에 반납됐거나 토스페이먼츠 상점관리자에서 이미 환불한 결제입니다. 화면을 새로고침해 주문이 취소됐는지 확인하고, 상점관리자에서 직접 환불했다면 고객에게 환불이 끝났는지 확인해주세요.',
  },
  provider_virtual_account_release_pending: {
    label: '가상계좌 반납 결과를 아직 확인하지 못했습니다',
    next: '시스템이 결제사에 자동으로 다시 확인합니다. 잠시 뒤 [환불 완료 확정]을 다시 눌러주세요.',
  },
  provider_deposit_window_out_of_range: {
    label: '입금 기한이 허용 범위(발급 뒤 72시간 안) 밖이라 가상계좌를 반납했습니다',
    next: `토스페이먼츠 결제 어드민의 가상계좌 입금 기한 설정(권장 24시간)을 확인해야 합니다. ${HAND_OVER}`,
  },
  provider_virtual_account_invalid: {
    label: '결제사가 보낸 가상계좌 정보의 형식이 맞지 않아 계좌를 반납했습니다',
    next: HAND_OVER,
  },
};

/* 이름표에 없는 코드. 가이드를 찾아보라고 하지 않고 지금 할 일을 말한다. */
const UNKNOWN: PaymentCancelErrorCopy = {
  label: '결제사 확인에 실패했습니다',
  next: '[환불 완료 확정]을 한 번 더 눌러주세요. 같은 안내가 다시 나오면 결제 담당자에게 요청번호와 코드를 알려주세요.',
};

export function adminPaymentCancelErrorCopy(code: string): PaymentCancelErrorCopy {
  return COPY[code] ?? UNKNOWN;
}

const SUPPORT_CODE_MARK = ` ${ADMIN_SUPPORT_CODE_LABEL}: `;

/** 문장 끝에 코드를 한 번 붙인다. 문장 안의 괄호에 코드를 넣지 않는다. */
export function withAdminSupportCode(message: string, code: string): string {
  return `${message}${SUPPORT_CODE_MARK}${code}`;
}

/**
 * `withAdminSupportCode`로 붙인 코드를 문장에서 떼어 낸다. 화면이 문장은 그대로, 코드는 작은 글로 따로 그릴 때 쓴다.
 * 코드가 없는 문장은 그대로 돌려준다.
 */
export function splitAdminSupportCode(message: string): { text: string; code: string | null } {
  const at = message.lastIndexOf(SUPPORT_CODE_MARK);
  if (at < 0) return { text: message, code: null };
  const code = message.slice(at + SUPPORT_CODE_MARK.length).trim();
  return /^[a-z0-9_]{1,80}$/u.test(code) ? { text: message.slice(0, at), code } : { text: message, code: null };
}

/** 목록·상세의 한 줄 표시. 예: `결제사 응답을 받지 못했습니다 · 문의할 때 알려 줄 코드: provider_unavailable` */
export function adminPaymentCancelErrorLabel(code: string): string {
  return `${adminPaymentCancelErrorCopy(code).label} ·${SUPPORT_CODE_MARK}${code}`;
}

/** 처리 직후 알림. 환불이 끝났는지 모르는 상태임을 먼저 말하고, 다음에 할 일로 끝낸다. */
export function adminPaymentCancelFailureMessage(code: string): string {
  const copy = adminPaymentCancelErrorCopy(code);
  return withAdminSupportCode(
    `결제 취소를 확정하지 못했습니다 — ${copy.label}. 고객 환불이 끝났는지 아직 확인되지 않았고, 주문과 재고는 그대로입니다. ${copy.next}`,
    code,
  );
}
