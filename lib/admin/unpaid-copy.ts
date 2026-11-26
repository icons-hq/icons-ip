/**
 * 미결제 확인 화면의 확인창 문구(2026-11-26, 어드민 화면 규칙 PR 3).
 *
 * [입금 확인]·[기한 연장]·[즉시 취소]와 입금 내역의 [이 주문으로 확정]은 누르는 순간 주문의 결제 상태·재고가 바뀌고 고객에게 메일이 나간다.
 * 그래서 누르기 전에 어느 주문인지(주문번호·구매자·금액)와 그 결과를 한 번 말한다. 값은 화면에 이미 내려와 있는 줄에서만 가져온다 —
 * 확인창을 위해 새로 읽는 값은 없다.
 *
 * 결제 확정·재고·상태 전이는 DB 함수(admin_confirm_bank_transfer_deposit·admin_extend_bank_transfer_deadline·
 * admin_cancel_unpaid_bank_transfer_order)가 한다. 여기 문구는 그 결과를 있는 그대로 옮길 뿐이라, 함수가 바뀌면 이 문구도 함께 본다.
 */

import { krwAmountWords } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import { bankDepositConfidenceLabel, bankDepositNeedsSecondLook } from '@/lib/payments/bank-deposit-feed';
import { bankTransferDepositNameWithCode } from '@/lib/payments/bank-transfer';
import type { AdminConfirmRequest } from './confirm';
import type { AdminBankDepositRow, AdminUnpaidOrderRow } from './unpaid';

/** 기한 연장이 늘리는 시간. DB는 연장을 누른 시각부터 24시간 뒤로 새 기한을 정한다(기존 기한에 더하지 않는다). */
export const UNPAID_EXTENSION_HOURS = 24;

type OrderReference = Pick<AdminUnpaidOrderRow, 'orderNumber' | 'depositCode'>;

/**
 * 패널 제목·확인창에서 주문을 가리키는 말. 주문번호가 있으면 주문번호로, 번호가 없는 옛 주문만 입금확인코드로 가리킨다
 * (목록의 첫 열이 입금확인코드라 운영자가 그 줄을 찾을 수 있다).
 */
export function unpaidOrderLabel(order: OrderReference) {
  return order.orderNumber ? `주문 ${order.orderNumber}` : `입금확인코드 ${order.depositCode} 주문`;
}

/** 입금 기한(KST). 기한을 모르는 줄은 그렇게 말한다. */
export function unpaidDeadlineText(expiresAt: string | null) {
  return (expiresAt && formatOrderDateTime(expiresAt)) || '기한 정보 없음';
}

/** 확인창 첫 줄: 어느 주문인지(주문번호 · 구매자 · 금액). */
function orderLine(order: Pick<AdminUnpaidOrderRow, 'orderNumber' | 'depositCode' | 'buyerName' | 'total'>) {
  return [unpaidOrderLabel(order), order.buyerName, krwAmountWords(order.total)].join(' · ');
}

/** 입금 확인: 주문이 결제완료가 되고 고객 메일이 나간다. 이 화면에는 되돌리는 버튼이 없다. */
export function unpaidConfirmDepositRequest(order: AdminUnpaidOrderRow): AdminConfirmRequest {
  return {
    title: '입금을 확인할까요?',
    message: [
      orderLine(order),
      `안내된 입금자명 ${bankTransferDepositNameWithCode(order.recipientName, order.depositCode)}`,
      '입금을 확인하면 주문이 결제완료(신규주문)가 되고 고객에게 주문 확인 메일을 보냅니다.',
      '이 화면에서는 되돌릴 수 없습니다. 잘못 확인했다면 주문을 취소하고 환불해야 합니다.',
    ].join('\n'),
    confirmLabel: '결제완료로 확정',
    cancelLabel: '돌아가기',
  };
}

/**
 * 기한 연장: 새 기한은 연장을 누른 시각부터 24시간 뒤다. 확인창을 연 시각을 기준으로 미리 보여 주고, 실제 시각은 처리한 순간에 정해진다.
 * `now`는 확인창을 여는 시각(ms)이다.
 *
 * 기존 기한에 24시간을 더하는 것이 아니라서(주문한 지 얼마 안 된 주문은 몇 시간만 늘어난다) 제목과 버튼은 '24시간 연장'이라 약속하지 않고,
 * 지금 기한과 새 기한을 나란히 보인다.
 */
export function unpaidExtendDeadlineRequest(order: AdminUnpaidOrderRow, now: number): AdminConfirmRequest {
  const next = formatOrderDateTime(new Date(now + UNPAID_EXTENSION_HOURS * 3_600_000).toISOString());
  return {
    title: '입금 기한을 연장할까요?',
    message: [
      [unpaidOrderLabel(order), order.buyerName].join(' · '),
      `입금 기한(KST) ${unpaidDeadlineText(order.expiresAt)} → ${next}`,
      `새 기한은 연장한 시각부터 ${UNPAID_EXTENSION_HOURS}시간 뒤입니다. 그동안 재고를 계속 잡아 두고, 주문당 한 번만 연장할 수 있습니다.`,
    ].join('\n'),
    confirmLabel: '기한 연장',
    cancelLabel: '돌아가기',
  };
}

/**
 * 즉시 취소: 입금 전 주문이라 결제가 없어 환불도 없다. 재고(예약판매는 예약 물량)를 돌리고, 쓴 쿠폰·적립금은 고객에게 돌려준다.
 * 취소한 주문을 되살리는 길은 없다.
 */
export function unpaidCancelRequest(order: AdminUnpaidOrderRow): AdminConfirmRequest {
  return {
    title: '이 주문을 취소할까요?',
    message: [
      orderLine(order),
      '취소하면 잡아 둔 재고가 돌아가고, 쓴 쿠폰·적립금이 있으면 고객에게 돌아갑니다. 입금 전 주문이라 환불은 없습니다.',
      '취소한 주문은 되살릴 수 없습니다. 이후 들어온 입금은 반환 절차로 처리합니다.',
    ].join('\n'),
    confirmLabel: '주문 취소',
    cancelLabel: '돌아가기',
    destructive: true,
  };
}

/**
 * 입금 내역을 주문에 연결해 확정. 입금 내역 줄에는 제안한 주문의 입금확인코드와 확신도만 내려와 있다 —
 * 그 주문의 주문번호·금액은 이 줄에 없으므로 위 목록에서 같은 입금확인코드의 줄로 대조한다.
 */
export function bankDepositConfirmRequest(deposit: AdminBankDepositRow): AdminConfirmRequest {
  return {
    title: '입금을 이 주문으로 확정할까요?',
    message: [
      `입금 ${krwAmountWords(deposit.amount)} · 입금자명 ${deposit.depositorName}`,
      `연결할 주문 · 입금확인코드 ${deposit.suggestedOrderCode ?? '없음'} (${bankDepositConfidenceLabel(deposit.suggestedConfidence)})`,
      ...(bankDepositNeedsSecondLook(deposit.suggestedConfidence)
        ? ['입금액이 주문 금액과 다릅니다. 부분 입금인지 먼저 확인해주세요.']
        : []),
      '확정하면 주문이 결제완료(신규주문)가 되고 고객에게 주문 확인 메일을 보냅니다. 이 화면에서는 되돌릴 수 없습니다.',
    ].join('\n'),
    confirmLabel: '결제완료로 확정',
    cancelLabel: '돌아가기',
  };
}

/** 입금 내역을 목록에서 내리기: 목록에서만 사라지고 입금 기록과 보류 사유는 남는다(반환 절차의 근거). 이 화면에는 다시 올리는 길이 없다. */
export function bankDepositIgnoreRequest(deposit: AdminBankDepositRow): AdminConfirmRequest {
  return {
    title: '입금을 목록에서 내릴까요?',
    message: [
      `입금 ${krwAmountWords(deposit.amount)} · 입금자명 ${deposit.depositorName}`,
      '내리면 이 목록에서 사라집니다. 입금 기록과 보류 사유는 남아 돈을 돌려줄 때 근거가 됩니다.',
    ].join('\n'),
    confirmLabel: '목록에서 내리기',
    cancelLabel: '돌아가기',
  };
}
