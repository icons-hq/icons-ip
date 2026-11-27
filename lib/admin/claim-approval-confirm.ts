import type { AdminConfirmRequest } from './confirm';
import { krwAmountWords } from '@/lib/format';
import { PAYMENT_PROVIDER_LABELS } from '@/lib/payments/provider-capabilities';

/*
 * 취소 승인 확인창의 문구. 취소·반품·교환 관리의 요청 상세(components/admin/screens/ClaimActionPanel)와
 * 주문통합검색의 주문 처리 패널(lib/admin/order-confirmations)이 같은 함수를 쓴다 — 같은 취소 요청을 어느 화면에서 승인해도
 * 확인창이 같은 금액·같은 말을 하게 한다. 서버 액션을 부르지 않는 순수 함수만 둔다(금액 읽기는 부르는 화면이 한다).
 */

/**
 * 확인창 한 번에 실을 것. 버튼(없으면 양식)의 data-confirm* 속성으로 싣고 `confirmClaimPanelSubmit`이 읽는다.
 * 누르는 시점의 값이 필요한 확인(취소 승인의 금액, 거부 사유)은 속성 대신 제출 처리에서 바로 만든다.
 */
export interface ClaimPanelConfirm {
  message: string;
  /** 무엇을 하는지. 요청번호가 있으면 앞에 붙는다(예: 'C00012 취소 승인'). */
  title?: string;
  /** 확인 버튼 이름. 하는 일을 말한다(예: '30,500원 취소'). */
  confirmLabel?: string;
  /** 되돌릴 수 없으면 확인 버튼을 위험색으로 그린다. */
  destructive?: boolean;
}

/** 확인창이 가리키는 대상. 요청번호(C00012)·주문번호·구매자 — 없는 값은 확인창에서 빠진다. */
export interface ClaimConfirmTarget {
  claimReference?: string | null;
  orderReference?: string | null;
  buyerName?: string | null;
}

/** 확인창을 닫고 돌아가는 버튼. '취소'는 처리 이름(주문 취소·결제 취소)과 겹쳐 쓰지 않는다. */
export const CLAIM_CONFIRM_BACK_LABEL = '돌아가기';
export const CLAIM_CONFIRM_IRREVERSIBLE = '되돌릴 수 없습니다.';

export function claimPanelConfirmRequest(confirm: ClaimPanelConfirm): AdminConfirmRequest {
  return {
    message: confirm.message,
    ...(confirm.title ? { title: confirm.title } : {}),
    ...(confirm.confirmLabel ? { confirmLabel: confirm.confirmLabel } : {}),
    cancelLabel: CLAIM_CONFIRM_BACK_LABEL,
    ...(confirm.destructive ? { destructive: true } : {}),
  };
}

export function claimConfirmTitle(target: ClaimConfirmTarget, action: string) {
  return target.claimReference ? `${target.claimReference} ${action}` : action;
}

/** 확인창 본문. 첫 줄은 대상(주문번호·구매자), 그 아래로 한 줄에 한 가지씩 적는다. */
export function claimConfirmBody(target: ClaimConfirmTarget, ...lines: (string | null | false | undefined)[]) {
  const who = [target.orderReference ? `주문 ${target.orderReference}` : null, target.buyerName ? `구매자 ${target.buyerName}` : null]
    .filter(Boolean).join(' · ');
  return [who, ...lines].filter(Boolean).join('\n');
}

/**
 * 취소 승인 확인창. 결제마다 승인 뒤 일어나는 일이 다르다.
 * 결제사 취소가 바로 나가는 결제(토스·나이스페이)는 금액을 누르는 시점에 읽어 `claimCancelApprovalMoneyConfirm`으로 만든다.
 */
export function claimCancelApprovalConfirm(paymentProvider: string | null, target: ClaimConfirmTarget = {}): ClaimPanelConfirm {
  const title = claimConfirmTitle(target, '취소 승인');
  if (paymentProvider === 'korpay') {
    return { title, confirmLabel: '승인하고 환불 처리 시작', message: claimConfirmBody(target, `취소를 승인할까요? 승인 뒤 ${PAYMENT_PROVIDER_LABELS.korpay} 취소 접수와 환불 완료 확정으로 진행합니다.`) };
  }
  if (paymentProvider === 'bank_transfer') {
    return { title, confirmLabel: '승인하고 환불 처리 시작', message: claimConfirmBody(target, '취소를 승인할까요? 승인 뒤 환불계좌 송금 절차로 진행합니다.') };
  }
  if (paymentProvider === null) {
    return { title, confirmLabel: '승인하고 주문 취소', destructive: true, message: claimConfirmBody(target, `취소를 승인할까요? 결제 전 주문은 바로 주문이 취소되고 ${CLAIM_CONFIRM_IRREVERSIBLE}`) };
  }
  return { title, confirmLabel: '승인하고 환불 처리 시작', message: claimConfirmBody(target, '취소를 승인할까요? 승인하면 환불 처리 단계로 넘어갑니다.') };
}

/**
 * 결제사 취소가 바로 나가는 취소 승인의 확인창. 금액은 화면에 내려와 있던 값이 아니라 누르는 시점에 서버가 읽은 값이다 —
 * 승인 전에는 환불 기록이 없어 화면이 가진 금액이 주문 금액뿐이고, 앞서 부분 취소한 주문은 그 금액보다 적게 취소된다.
 */
export function claimCancelApprovalMoneyConfirm(input: {
  autoCancelLabel: string;
  /** 승인하면 결제사에 취소를 요청하는 금액(결제 금액 − 이미 취소한 금액). */
  amount: number;
  paidAmount: number | null;
  target?: ClaimConfirmTarget;
}): ClaimPanelConfirm {
  const { autoCancelLabel, amount, paidAmount } = input;
  const target = input.target ?? {};
  const title = claimConfirmTitle(target, '취소 승인');
  if (amount === 0) {
    return {
      title, confirmLabel: '승인하고 주문 취소', destructive: true,
      message: claimConfirmBody(target,
        `${autoCancelLabel} 결제는 앞서 모두 취소해 더 취소할 금액이 없습니다.`,
        `승인하면 결제사 취소 없이 주문 취소·재고 복원을 확정합니다. ${CLAIM_CONFIRM_IRREVERSIBLE}`),
    };
  }
  return {
    title, confirmLabel: `${krwAmountWords(amount)} 취소`, destructive: true,
    message: claimConfirmBody(target,
      paidAmount !== null && amount < paidAmount
        ? `${autoCancelLabel} 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 ${krwAmountWords(amount)}을 취소합니다(결제 금액 ${krwAmountWords(paidAmount)}).`
        : `${autoCancelLabel} 결제 전액 ${krwAmountWords(amount)}을 취소합니다.`,
      '승인하면 바로 결제사에 취소를 요청합니다. 되돌릴 수 없고, 취소가 확인되면 주문 취소·재고 복원까지 함께 끝납니다.'),
  };
}
