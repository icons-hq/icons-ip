import { isVirtualAccountRefundAccountReviewCode } from '@/lib/payments/virtual-account-refund-account';
import { isUuid } from '@/lib/uuid';

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
  invalid_entry: '은행, 계좌번호(숫자·하이픈 8~30자), 예금주, 입력 사유(2자 이상)를 모두 확인해주세요.',
  invalid_claim_refund_account: '은행, 계좌번호(숫자·하이픈 8~30자), 예금주를 모두 확인해주세요.',
  invalid_virtual_account_refund_account: '이 계좌로는 결제대행사가 환불할 수 없습니다. 은행은 목록에서 고르고, 계좌번호는 숫자 6~20자리(하이픈 제외)로 적어주세요.',
  invalid_refund_account_reason: '입력 사유를 2자 이상 200자 이하로 적어주세요. 예: 11/26 고객 전화로 계좌 확인',
  refund_account_not_virtual_account: '입금된 가상계좌 주문만 여기서 환불 계좌를 대신 입력할 수 있습니다. 화면을 새로고침해 결제수단을 확인해주세요.',
  refund_account_refund_in_progress: '결제사 환불을 진행하고 있어 지금은 계좌를 바꿀 수 없습니다. 잠시 뒤 새로고침해 결과를 확인해주세요.',
  refund_account_finance_started: '이미 환불을 시작했거나 계좌 말고 다른 이유로 확인이 필요한 요청이라 계좌를 바꿀 수 없습니다. 결제사 확인 오류를 먼저 확인해주세요.',
  refund_account_claim_closed: '끝났거나 닫힌 요청이라 계좌를 받을 수 없습니다. 화면을 새로고침해 상태를 확인해주세요.',
  refund_account_payment_unavailable: '이 요청의 결제는 환불 계좌를 받을 수 없는 상태입니다. 화면을 새로고침해 결제 상태를 확인해주세요.',
  refund_account_gift_order: '선물 주문은 여기서 환불 계좌를 입력할 수 없습니다. 토스페이먼츠 상점관리자에서 환불한 뒤 [상태 다시 확인]을 눌러주세요.',
  refund_account_request_conflict: '같은 저장 요청이 다른 내용으로 이미 처리됐습니다. 화면을 새로고침한 뒤 다시 입력해주세요.',
  claim_not_found: '요청을 찾지 못했습니다. 화면을 새로고침해 다시 확인해주세요.',
  operator_capability_required: '주문 관리 권한이 있는 계정만 환불 계좌를 입력할 수 있습니다.',
  unknown: '저장 결과를 확인하지 못했습니다. 화면을 새로고침해 등록된 계좌를 먼저 확인해주세요.',
};

/** 저장 뒤 안내. 취소는 시스템이 환불을 다시 요청하고, 반품은 운영자가 환불 버튼을 누른다(기존 재시도 규칙). */
export function virtualAccountRefundAccountEntryMessage(
  claimType: 'cancel' | 'return',
  retry: 'started' | 'operator_required' | 'account_missing' | 'account_invalid' | 'not_applicable' | 'failed',
): string {
  if (claimType === 'return' || retry === 'operator_required') {
    return '환불 계좌를 저장했습니다. 반품은 클레임 상세의 [환불 완료 확정](주문 처리 패널은 [상태 다시 확인])을 누르면 이 계좌로 환불합니다.';
  }
  if (retry === 'started') return '환불 계좌를 저장하고 이 계좌로 환불을 다시 요청했습니다. 잠시 뒤 새로고침해 결과를 확인해주세요.';
  if (retry === 'account_invalid') return '환불 계좌를 저장했지만 이 계좌로는 결제대행사가 환불할 수 없습니다. 은행·계좌번호를 다시 확인해 입력해주세요.';
  if (retry === 'failed') return '환불 계좌를 저장했습니다. 환불 다시 요청은 보내지 못했습니다 — 주문 처리 패널의 [상태 다시 확인]을 눌러주세요.';
  return '환불 계좌를 저장했습니다. 지금은 시스템이 환불을 다시 요청할 상태가 아닙니다 — 화면을 새로고침해 결제사 확인 오류를 확인한 뒤 [상태 다시 확인]을 눌러주세요.';
}
