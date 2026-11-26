import { krwAmountWords } from '@/lib/format';
import { isVirtualAccountRefundAccountReviewCode } from '@/lib/payments/virtual-account-refund-account';
import { isUuid } from '@/lib/uuid';
import type { AdminConfirmRequest } from './confirm';
import { SAVE_CHECK_LABEL } from './goods-template-save';
import { ADMIN_SALES_ACCESS_DENIED } from './vocabulary';

/*
 * 운영자의 가상계좌 환급 계좌 대신 입력(ADR-0049 결정 5 보강, 2026-11-25 — VAC-041·VAC-042).
 *
 * 입금된 토스 가상계좌 주문의 취소·반품 환불이 환급 계좌 때문에 결제확인필요(provider_refund_account_required·
 * provider_refund_account_invalid)로 멈췄을 때, 구매자가 전화 등으로 알려준 계좌를 운영자가 주문 처리 패널·클레임 상세에서 입력한다.
 * 판정·저장은 DB(admin_set_order_claim_refund_account)가 구매자 입력과 같은 규칙으로 하고, 이 모듈은 입력을 좁히고 결과 문구를 고른다.
 */

/** 입력 칸을 보일 결제확인필요 사유(계좌 없음·결제사 거절). */
export function showsVirtualAccountRefundAccountEntry(lastErrorCode: string | null | undefined): boolean {
  return isVirtualAccountRefundAccountReviewCode(lastErrorCode);
}

export interface AdminRefundAccountEntry {
  claimId: string;
  orderId: string;
  claimType: 'cancel' | 'return';
  operationId: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  reason: string;
}

const ACCOUNT_NUMBER = /^[0-9-]{8,30}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function field(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && [...trimmed].length <= max && !CONTROL.test(trimmed) ? trimmed : null;
}

/**
 * 계좌번호 칸의 안내 한 줄. 이대로 적으면 저장 형식(숫자·하이픈 8~30자)과 결제사 판정(하이픈을 뺀 숫자 6~20자리,
 * private.virtual_account_refund_account_usable)을 모두 지난다 — 칸 아래 안내·오류 문구·입력 검사가 같은 말을 쓴다.
 */
export const ADMIN_REFUND_ACCOUNT_NUMBER_RULE = '숫자 8~20자리. 하이픈(-)은 넣어도 됩니다.';
export const ADMIN_REFUND_ACCOUNT_REASON_EXAMPLE = '예: 11/26 고객 전화로 계좌 확인';

/**
 * 저장을 누르기 전에 어느 칸이 왜 안 되는지 말한다(없으면 null). DB와 같은 규칙이다 — 형식은 admin_set_order_claim_refund_account,
 * 숫자 자릿수는 결제사 판정. 은행이 목록에 있는지와 최종 판정은 DB가 다시 한다.
 */
export function adminRefundAccountEntryProblem(input: unknown): string | null {
  const row = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (!field(row.bankName, 40)) return '은행을 목록에서 골라 주세요.';
  const accountNumber = field(row.accountNumber, 30);
  const digits = accountNumber ? accountNumber.replace(/-/g, '').length : 0;
  if (!accountNumber || !ACCOUNT_NUMBER.test(accountNumber) || digits < 6 || digits > 20) return `계좌번호를 다시 확인해주세요. ${ADMIN_REFUND_ACCOUNT_NUMBER_RULE}`;
  if (!field(row.accountHolder, 40)) return '예금주를 40자 안으로 적어 주세요.';
  const reason = field(row.reason, 200);
  if (!reason || [...reason].length < 2) return `입력 사유를 2자 이상 200자 이하로 적어 주세요. ${ADMIN_REFUND_ACCOUNT_REASON_EXAMPLE}`;
  return null;
}

/** 서버 액션 입력을 좁힌다. 형식이 어긋나면 null(DB에 닿기 전에 거른다 — 최종 판정은 DB). */
export function normalizeAdminRefundAccountEntry(input: unknown): AdminRefundAccountEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const bankName = field(row.bankName, 40);
  const accountNumber = field(row.accountNumber, 30);
  const accountHolder = field(row.accountHolder, 40);
  const reason = field(row.reason, 200);
  if (typeof row.claimId !== 'string' || !isUuid(row.claimId) || typeof row.orderId !== 'string' || !isUuid(row.orderId)
    || typeof row.operationId !== 'string' || !isUuid(row.operationId)
    || (row.claimType !== 'cancel' && row.claimType !== 'return')
    || !bankName || !accountNumber || !ACCOUNT_NUMBER.test(accountNumber) || !/[0-9]/.test(accountNumber) || !accountHolder
    || !reason || [...reason].length < 2) {
    return null;
  }
  return {
    claimId: row.claimId.toLowerCase(), orderId: row.orderId.toLowerCase(), claimType: row.claimType,
    operationId: row.operationId.toLowerCase(), bankName, accountNumber, accountHolder, reason,
  };
}

/** DB 오류 메시지 → 운영자 문구(어드민 문구 가이드: 어느 칸을 어떻게 고치는지까지). */
export const VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS: Record<string, string> = {
  invalid_entry: `은행, 계좌번호, 예금주, 입력 사유(2자 이상)를 모두 확인해주세요. 계좌번호는 ${ADMIN_REFUND_ACCOUNT_NUMBER_RULE}`,
  invalid_claim_refund_account: `은행, 계좌번호, 예금주를 모두 확인해주세요. 계좌번호는 ${ADMIN_REFUND_ACCOUNT_NUMBER_RULE}`,
  invalid_virtual_account_refund_account: `이 계좌로는 결제사가 환불할 수 없습니다. 은행은 목록에서 고르고, 계좌번호는 다시 확인해주세요. ${ADMIN_REFUND_ACCOUNT_NUMBER_RULE}`,
  invalid_refund_account_reason: `입력 사유를 2자 이상 200자 이하로 적어 주세요. ${ADMIN_REFUND_ACCOUNT_REASON_EXAMPLE}`,
  refund_account_not_virtual_account: '입금된 가상계좌 주문만 여기서 환불 계좌를 대신 입력할 수 있습니다. 화면을 새로고침해 결제수단을 확인해주세요.',
  refund_account_refund_in_progress: '결제사 환불을 진행하고 있어 지금은 계좌를 바꿀 수 없습니다. 잠시 뒤 새로고침해 결과를 확인해주세요.',
  refund_account_finance_started: '이미 환불을 시작했거나 계좌 말고 다른 이유로 멈춘 요청이라 계좌를 바꿀 수 없습니다. 요청 상세의 결제사 확인 오류를 먼저 확인해주세요.',
  refund_account_claim_closed: '끝났거나 닫힌 요청이라 계좌를 받을 수 없습니다. 화면을 새로고침해 상태를 확인해주세요.',
  refund_account_payment_unavailable: '이 요청의 결제는 환불 계좌를 받을 수 없는 상태입니다. 화면을 새로고침해 결제 상태를 확인해주세요.',
  refund_account_gift_order: '선물 주문은 여기서 환불 계좌를 입력할 수 없습니다. 토스페이먼츠 상점관리자에서 환불한 뒤 [상태 다시 확인]을 눌러주세요.',
  refund_account_request_conflict: '앞서 누른 저장과 내용이 달라 저장하지 않았습니다. 화면을 새로고침해 등록된 계좌를 확인한 뒤 다시 입력해주세요.',
  claim_not_found: '요청을 찾지 못했습니다. 화면을 새로고침해 다시 확인해주세요.',
  operator_capability_required: ADMIN_SALES_ACCESS_DENIED,
  unknown: `저장됐는지 확인하지 못했습니다. [${SAVE_CHECK_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.`,
};

/** 저장 버튼 이름. 취소는 저장과 함께 환불을 다시 요청하고, 반품은 저장만 한다. */
export const VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS = { cancel: '저장하고 환불 다시 요청', return: '환불 계좌 저장' } as const;

/**
 * 저장 전 확인창(D-34). 방금 적은 은행·계좌번호·예금주를 가리지 않고 그대로 되읽는다 — 오타를 잡는 것이 목적이다.
 * 취소는 저장하면 서버가 이 계좌로 환불을 바로 다시 요청하고(retryVirtualAccountRefund), 반품은 저장만 하고 운영자가 환불 버튼을 누른다.
 * 금액은 화면이 넘긴 값이 있을 때만 적는다(실제 환불 금액은 서버가 환불할 때 다시 계산한다).
 */
export function virtualAccountRefundAccountEntryConfirm(input: {
  claimType: 'cancel' | 'return'; bankName: string; accountNumber: string; accountHolder: string; refundAmount?: number | null;
}): AdminConfirmRequest {
  const amount = typeof input.refundAmount === 'number' && Number.isSafeInteger(input.refundAmount) && input.refundAmount > 0 ? input.refundAmount : null;
  const account = [`은행: ${input.bankName.trim()}`, `계좌번호: ${input.accountNumber.trim()}`, `예금주: ${input.accountHolder.trim()}`,
    ...(amount === null ? [] : [`환불 금액: ${krwAmountWords(amount)}`])].join('\n');
  const check = '계좌번호에 틀린 숫자가 없는지, 결제한 분 본인 계좌인지 확인해주세요.';
  if (input.claimType === 'cancel') {
    return {
      title: '이 계좌로 환불을 다시 요청할까요?', confirmLabel: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS.cancel, cancelLabel: '돌아가기', destructive: true,
      message: `${account}\n\n저장하면 이 계좌로 환불을 바로 다시 요청합니다. ${check} 다른 계좌로 송금되면 여기서 되돌릴 수 없습니다.`,
    };
  }
  return {
    title: '환불 계좌를 저장할까요?', confirmLabel: VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS.return, cancelLabel: '돌아가기',
    message: `${account}\n\n저장만 하고 환불은 아직 하지 않습니다. 저장한 뒤 요청 상세의 [환불 완료 확정](주문 처리 패널에서는 [상태 다시 확인])을 눌러야 이 계좌로 환불합니다. ${check}`,
  };
}

/** 저장 뒤 안내. 취소는 시스템이 환불을 다시 요청하고, 반품은 운영자가 환불 버튼을 누른다(기존 재시도 규칙). */
export function virtualAccountRefundAccountEntryMessage(
  claimType: 'cancel' | 'return',
  retry: 'started' | 'operator_required' | 'account_missing' | 'account_invalid' | 'not_applicable' | 'failed',
): string {
  if (claimType === 'return' || retry === 'operator_required') {
    return '환불 계좌를 저장했습니다. 아직 환불하지 않았습니다. 요청 상세의 [환불 완료 확정](주문 처리 패널에서는 [상태 다시 확인])을 누르면 이 계좌로 환불합니다.';
  }
  if (retry === 'started') return '환불 계좌를 저장하고 이 계좌로 환불을 다시 요청했습니다. 잠시 뒤 새로고침해 결과를 확인해주세요.';
  if (retry === 'account_invalid') return '환불 계좌는 저장했지만 결제사가 이 계좌로는 환불할 수 없습니다. 고객에게 은행과 계좌번호를 다시 확인해 입력해주세요.';
  if (retry === 'failed') return '환불 계좌는 저장했지만 환불을 다시 요청하지 못했습니다. 주문 처리 패널의 [상태 다시 확인]을 눌러주세요.';
  return '환불 계좌는 저장했지만 환불은 다시 요청하지 않았습니다. 새로고침해 결제사 확인 오류를 확인한 뒤 주문 처리 패널의 [상태 다시 확인]을 눌러주세요.';
}

/**
 * 가상계좌 칸의 부분 취소 안내(2026-11-25 — ADR-0049 결정 5 보강). 에스크로가 아님이 확인된 입금 결제만 부분 취소·부분 반품·반품배송비
 * 차감을 받는다(토스: 입금 뒤 부분 취소 가능, 에스크로는 구매확정 전 부분 취소 불가). 화면 안내일 뿐이고 판정은 DB
 * (private.toss_virtual_account_partial_cancel_ready)가 한다 — 에스크로 선택을 모르면 작업자 확인(배송 등록 작업 '에스크로 결제 아님') 뒤에 열린다.
 */
export function adminVirtualAccountPartialCancelHint(account: {
  useEscrow: boolean | null;
  escrow?: { deliveryState: string; escrowStatus: string | null } | null;
}): string {
  const confirmedNonEscrow = account.useEscrow === false
    || (account.useEscrow === null && account.escrow?.deliveryState === 'skipped' && !account.escrow.escrowStatus);
  if (confirmedNonEscrow) {
    return '구매안전서비스(에스크로)를 쓰지 않은 결제라 입금 뒤 부분 취소·부분 반품·반품배송비 차감도 할 수 있습니다(고객 환불 계좌로 부분 환불).';
  }
  if (account.useEscrow === true) {
    return '구매안전서비스(에스크로)를 쓴 결제는 구매확정 전 부분 취소를 받지 않아 주문 전체로만 취소·반품할 수 있습니다.';
  }
  return '구매안전서비스(에스크로) 적용 여부를 확인하기 전에는 주문 전체로만 취소·반품할 수 있습니다.';
}
