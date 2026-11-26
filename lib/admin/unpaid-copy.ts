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

/**
 * [기한 연장] 버튼과 확인창 버튼의 이름. 남은 기한에 24시간을 더하는 것이 아니라 누른 시각부터 24시간 뒤로 기한을 다시 정하므로
 * (DB: now() + 24시간) '24시간 연장'이라 부르지 않고 하는 일 그대로 부른다 — 주문 직후에 누르면 몇 시간만 늘어난다.
 */
export const UNPAID_EXTEND_BUTTON_LABEL = `기한을 지금부터 ${UNPAID_EXTENSION_HOURS}시간 뒤로`;
/** 기한 연장 결과 문구(app/admin/unpaid-actions). 버튼과 같은 말이다. */
export const UNPAID_EXTENDED_MESSAGE = `입금 기한을 지금부터 ${UNPAID_EXTENSION_HOURS}시간 뒤로 바꿨습니다.`;

type OrderReference = Pick<AdminUnpaidOrderRow, 'orderNumber' | 'depositCode'>;

/**
 * 패널 제목·확인창에서 주문을 가리키는 말. 주문번호가 있으면 주문번호로, 번호가 없는 옛 주문만 입금확인코드로 가리킨다
 * (목록의 첫 열이 입금확인코드라 운영자가 그 줄을 찾을 수 있다).
 */
export function unpaidOrderLabel(order: OrderReference) {
  return order.orderNumber ? `주문 ${order.orderNumber}` : `입금확인코드 ${order.depositCode} 주문`;
}

/**
 * 입금 확인·즉시 취소 뒤 그 주문 자리에 남기는 결과 한 줄. 처리가 끝난 주문은 바로 이 목록에서 빠지므로, 다른 사람이 먼저 처리한 것으로
 * 읽히지 않게 방금 한 일을 주문과 함께 말한다. `message`는 서버 액션이 돌려준 결과 문구(마침표로 끝난다)다.
 */
export function unpaidProcessedNotice(order: OrderReference, message: string) {
  return `${unpaidOrderLabel(order)} · ${message} 처리가 끝나 이 목록에서 빠졌습니다.`;
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
 * 지금 누르면 기한이 얼마 늘지 않을 때 덧붙이는 한 줄. 방금 들어온 주문은 기한이 이미 24시간쯤 남아 있어, 누르면 한 번뿐인 연장을
 * 써 버리고도 기한은 그대로다. 새 기한이 지금 기한보다 1시간도 늦지 않으면 그 사실을 말한다. 기한을 모르는 줄은 말하지 않는다.
 */
function unpaidExtensionGainNote(expiresAt: string | null, nextAt: number): string | null {
  const current = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(current)) return null;
  const minutes = Math.floor((nextAt - current) / 60_000);
  if (minutes >= 60) return null;
  const when = '주문당 한 번뿐이니 기한이 가까워졌을 때 눌러주세요.';
  if (minutes < 0) return `지금 바꾸면 입금 기한이 오히려 앞당겨집니다. ${when}`;
  if (minutes === 0) return `지금 바꾸면 입금 기한이 늘어나지 않습니다. ${when}`;
  return `지금 바꾸면 입금 기한이 ${minutes}분만 늘어납니다. ${when}`;
}

/**
 * 기한 연장: 새 기한은 연장을 누른 시각부터 24시간 뒤다. 확인창을 연 시각을 기준으로 미리 보여 주고, 실제 시각은 처리한 순간에 정해진다.
 * `now`는 확인창을 여는 시각(ms)이다.
 *
 * 기존 기한에 24시간을 더하는 것이 아니라서(주문한 지 얼마 안 된 주문은 몇 시간만 늘어난다) 제목과 버튼은 '24시간 연장'이라 약속하지 않고
 * '지금부터 24시간 뒤로'라고 하는 일 그대로 말하며, 지금 기한과 새 기한을 나란히 보인다.
 */
export function unpaidExtendDeadlineRequest(order: AdminUnpaidOrderRow, now: number): AdminConfirmRequest {
  const nextAt = now + UNPAID_EXTENSION_HOURS * 3_600_000;
  const next = formatOrderDateTime(new Date(nextAt).toISOString());
  const gain = unpaidExtensionGainNote(order.expiresAt, nextAt);
  return {
    title: `입금 기한을 지금부터 ${UNPAID_EXTENSION_HOURS}시간 뒤로 바꿀까요?`,
    message: [
      [unpaidOrderLabel(order), order.buyerName].join(' · '),
      `입금 기한(KST) ${unpaidDeadlineText(order.expiresAt)} → ${next}`,
      ...(gain ? [gain] : []),
      `남은 기한에 ${UNPAID_EXTENSION_HOURS}시간을 더하는 것이 아니라, 누른 시각부터 ${UNPAID_EXTENSION_HOURS}시간 뒤로 다시 정합니다. 그동안 재고를 계속 잡아 두고, 주문당 한 번만 할 수 있습니다.`,
    ].join('\n'),
    confirmLabel: UNPAID_EXTEND_BUTTON_LABEL,
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
