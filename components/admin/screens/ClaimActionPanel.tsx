'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, type ReactNode } from 'react';
import { ADMIN_CANCELLATION_RECHECK_LABELS, adminOrderPanelHref } from '@/lib/admin/orders';
import { adminClaimStageLabel, adminClaimTodayKst } from '@/lib/admin/claims';
import { krw } from '@/lib/format';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_VOCABULARY as V, adminClaimCopy } from '@/lib/admin/vocabulary';
import {
  PAYMENT_PROVIDER_LABELS,
  automatedCancelProviderLabel,
  providerCancelsAutomatically,
} from '@/lib/payments/provider-capabilities';
import {
  decideOrderClaimAction,
  recordOrderClaimCollectionAction,
  planClaimDefectiveStockAction,
  planExchangeDefectiveStockAction,
  readOrderClaimApprovalAmountAction,
  recordOrderClaimRefundAction,
  retryClaimDefectiveStockAction,
  type AdminClaimActionState,
  type AdminClaimApprovalAmountState,
} from '@/app/admin/claim-actions';
import { ADMIN_SUPPORT_CODE_LABEL, splitAdminSupportCode } from '@/lib/admin/payment-cancel-error';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_REFUND_METHODS,
  ORDER_CLAIM_TYPE_LABELS,
  canRejectOrderClaim,
  orderClaimNextStages,
  orderClaimRefundMethodForProvider,
  type OrderClaimRefundMethod,
  type OrderClaimStage,
  type OrderClaimType,
} from '@/lib/orders/claims';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';
import {
  returnFeeDeductionBasisLabel,
  returnFeeDeductionHeadline,
  returnFeeDeductionSkippedNotice,
  type ReturnFeeDeduction,
} from '@/lib/claims/return-fee-deduction';
import { krwAmountWords } from '@/lib/format';
import { DEFECTIVE_STOCK_PENDING_NOTICE, EXCHANGE_STOCK_DECISION_REQUIRED, EXCHANGE_STOCK_FIELD_NOTE, type ClaimDefectiveStock } from '@/lib/admin/defective-stock';
import type { AdminClaimExchangeStockTarget } from '@/lib/admin/claim-reshipments';
import { RETURN_PICKUP_CANCEL_REASON_LABELS, RETURN_PICKUP_STATE_LABELS } from '@/lib/admin/claim-return-pickup';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { ChevronDown } from 'lucide-react';
import { ClaimOriginCollection } from './ClaimOriginCollection';
import { ClaimDefectiveStockChoice } from './ClaimDefectiveStockChoice';
import { ClaimHoldControl } from '@/components/admin/ClaimHoldControl';
import { BankTransferRefund } from '@/components/admin/BankTransferRefund';
import { ReturnClaimWorkspace } from './ReturnClaimWorkspace';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';
import { ClaimRejectionReasonField } from './ClaimRejectionReasonField';
import { adminConfirm, type AdminConfirmRequest } from '@/lib/admin/confirm';
import {
  CLAIM_CONFIRM_IRREVERSIBLE as IRREVERSIBLE,
  claimCancelApprovalConfirm,
  claimCancelApprovalMoneyConfirm,
  claimConfirmBody as confirmBody,
  claimConfirmTitle as confirmTitle,
  claimPanelConfirmRequest,
  type ClaimConfirmTarget,
  type ClaimPanelConfirm,
} from '@/lib/admin/claim-approval-confirm';

/* 취소 승인 확인창의 문구는 주문 처리 패널과 함께 쓰는 한 곳(lib/admin/claim-approval-confirm)에 있다. 이 화면의 다른 부품·테스트가 쓰던 이름 그대로 다시 내보낸다. */
export { claimCancelApprovalConfirm, claimCancelApprovalMoneyConfirm, claimPanelConfirmRequest };
export type { ClaimConfirmTarget, ClaimPanelConfirm };

/* 클레임 액션 패널(#252).
 *
 * 버튼은 지금 가능한 전이만 그린다(orderClaimNextStages · canRejectOrderClaim).
 *
 * 게이트는 DB다. 서버 액션은 폼의 형태만 좁히고 전이표를 다시 보지 않으므로,
 * 폼을 조작해 없는 전이를 부르면 막는 것은 RPC의 stage 전제조건이다. 그래서 이
 * 화면의 표와 DB 규칙이 갈라지면 두 가지가 생긴다 — 눌러도 항상 실패하는 버튼,
 * 또는 DB는 허용하는데 화면에서 사라진 처리. 둘 다 같은 모듈(lib/orders/claims.ts)을
 * 보게 해서 갈라지지 않게 한다.
 *
 * 액션마다 별도 폼이다. 한 폼에 여러 버튼을 두면 엔터 제출이 마크업 순서에 따라
 * 엉뚱한 액션으로 간다.
 *
 * [환불 완료]가 이 화면에서 가장 위험한 버튼이다. 아직 종결되지 않은 클레임에서는
 * 그 액션이 기존 정합화 경로를 먼저 태우고, 그 경로가 재고를 복원하고 미개봉
 * 카드팩을 회수한 뒤에야 원장에 완료를 적는다. 순서를 뒤집으면 "환불 완료인데
 * 재고는 그대로"가 된다. 이미 종결된 클레임에서는 정합화가 끝난 뒤이므로 남은
 * 일이 원장 기록뿐이고, 문구도 그렇게 말해야 한다.
 *
 * 토스·나이스페이 결제는 취소 승인과 [환불 완료 확정]이 결제사 전액 취소를 직접
 * 발행한다(2026-10-12 점검 REF-2). 운영자가 결제사 원장에서 취소를 먼저 확인하는 순서가
 * 아니다. 환불 수단도 결제가 정한다 — 두 결제사는 결제사 취소뿐이라 선택지를 그리지
 * 않는다(REF-8).
 *
 * 처리 결과는 양식 안에 그리지 않는다(2차 재검토 C2-1). 서버 액션의 revalidatePath가
 * 같은 응답에 새 화면을 실어 오므로, 승인으로 단계가 처리중·결제확인필요·처리완료로
 * 바뀌는 순간 그 결과를 돌려준 양식은 사라진다 — 양식 안의 결과 문구도 함께 사라져
 * 운영자는 실패 코드도 다음 할 일도 보지 못한다. 그래서 패널의 액션을 하나의
 * useActionState로 묶고, 마지막 결과를 단계와 무관하게 늘 그려지는 "현재 단계" 아래에
 * 한 번만 그린다. 묶인 액션은 한 번에 하나만 돈다 — 결제사 취소가 도는 동안 같은
 * 클레임의 다른 처리를 누르지 못한다. */

const EMPTY_STATE: AdminClaimActionState = {};

const CLAIM_PANEL_ACTIONS = {
  decision: decideOrderClaimAction,
  collection: recordOrderClaimCollectionAction,
  refund: recordOrderClaimRefundAction,
  defectivePlan: planClaimDefectiveStockAction,
  defectiveRetry: retryClaimDefectiveStockAction,
  exchangeStockPlan: planExchangeDefectiveStockAction,
} as const;
type ClaimPanelAction = keyof typeof CLAIM_PANEL_ACTIONS;
const PANEL_ACTION_FIELD = 'panelAction';

function isClaimPanelAction(value: unknown): value is ClaimPanelAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CLAIM_PANEL_ACTIONS, value);
}

/** 양식이 고른 서버 액션을 실행한다. 결과는 패널 수준 상태로 남는다. */
export async function runClaimPanelAction(
  _previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const kind = formData.get(PANEL_ACTION_FIELD);
  if (!isClaimPanelAction(kind)) {
    return { error: '처리할 작업을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.' };
  }
  return CLAIM_PANEL_ACTIONS[kind](EMPTY_STATE, formData);
}

function PanelActionField({ kind }: { kind: ClaimPanelAction }) {
  return <input name={PANEL_ACTION_FIELD} type="hidden" value={kind} />;
}

function confirmAttributes(confirm: ClaimPanelConfirm | null | undefined) {
  if (!confirm) return {};
  return {
    'data-confirm': confirm.message,
    'data-confirm-title': confirm.title,
    'data-confirm-label': confirm.confirmLabel,
    'data-confirm-tone': confirm.destructive ? 'danger' : undefined,
  };
}

/**
 * 되돌릴 수 없는 처리의 확인(2026-10-12 브라우저 QA QA-6).
 *
 * 취소 승인과 환불 완료 확정은 누르는 순간 결제사 전액 취소·주문 취소·재고 복원까지
 * 간다. 주문 콘솔의 청약철회 승인·운영자 전액 취소처럼 확인을 거친다. 확인 내용은 누른 버튼의
 * data-confirm*이 먼저고, 없으면 양식의 data-confirm*이다 — 한 양식의 [검토중으로 표시]는
 * 묻지 않고 [승인…]만 묻는다.
 *
 * 양식의 기본 제출은 늘 막고, 보낼지만 돌려준다. 보내는 쪽은 transition으로 직접 보낸다 —
 * 양식 action 자리는 비워 둔다(ignoreUnconfirmedClaimSubmit).
 */
export async function confirmClaimPanelSubmit(
  event: React.FormEvent<HTMLFormElement>,
  confirm: (request: AdminConfirmRequest) => boolean | Promise<boolean> = adminConfirm,
): Promise<boolean> {
  event.preventDefault();
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  const source = submitter?.getAttribute('data-confirm') ? submitter : event.currentTarget;
  const message = source.getAttribute('data-confirm');
  if (!message) return true;
  return confirm(claimPanelConfirmRequest({
    message,
    title: source.getAttribute('data-confirm-title') ?? undefined,
    confirmLabel: source.getAttribute('data-confirm-label') ?? undefined,
    destructive: source.getAttribute('data-confirm-tone') === 'danger',
  }));
}

/*
 * 확인이 필요한 양식의 React action 자리. 아무것도 보내지 않는다. 하이드레이션 전에 눌린
 * 제출은 React가 담아 두었다가 이 action으로 재생하는데, 그 경로는 확인 창을 거치지 않는다 —
 * 결제사 전액 취소가 확인 없이 나가지 않도록 버린다. 운영자는 화면이 준비된 뒤 다시 누른다.
 */
function ignoreUnconfirmedClaimSubmit() {}

const APPROVAL_AMOUNT_UNREAD = '취소할 금액을 다시 읽지 못해 승인하지 않았습니다. 새로고침한 뒤 다시 눌러주세요.';
const APPROVAL_PAYMENT_CHANGED = '결제 정보가 그사이 바뀌어 승인하지 않았습니다. 새로고침해 결제 내역을 확인한 뒤 다시 눌러주세요.';

/** 취소 승인 확인창을 누르는 시점의 금액으로 만든다. 읽지 못하면 확인창을 띄우지 않고 이유를 돌려준다 — 모르는 금액으로 묻지 않는다. */
export async function resolveCancelApprovalConfirm(
  input: { claimId: string; paidAmount: number | null; target?: ClaimConfirmTarget },
  read: (claimId: string) => Promise<AdminClaimApprovalAmountState> = readOrderClaimApprovalAmountAction,
): Promise<{ confirm: ClaimPanelConfirm; error?: undefined } | { error: string; confirm?: undefined }> {
  let state: AdminClaimApprovalAmountState;
  try {
    state = await read(input.claimId);
  } catch {
    return { error: APPROVAL_AMOUNT_UNREAD };
  }
  if (!state.ok) return { error: state.error };
  if (state.amount === null || !providerCancelsAutomatically(state.paymentProvider)) return { error: APPROVAL_PAYMENT_CHANGED };
  return {
    confirm: claimCancelApprovalMoneyConfirm({
      autoCancelLabel: automatedCancelProviderLabel(state.paymentProvider),
      amount: state.amount,
      paidAmount: input.paidAmount,
      target: input.target,
    }),
  };
}

type ClaimPanelConfirmer = (request: AdminConfirmRequest) => boolean | Promise<boolean>;

/**
 * 결제사 취소가 바로 나가는 취소 승인의 확인 한 번. 금액을 읽지 못했거나 운영자가 돌아가면 보내지 않는다 —
 * confirmed가 true일 때만 승인을 보낸다. 읽지 못한 이유는 error로 돌려준다.
 */
export async function confirmCancelApproval(
  input: { claimId: string; paidAmount: number | null; target?: ClaimConfirmTarget },
  read: (claimId: string) => Promise<AdminClaimApprovalAmountState> = readOrderClaimApprovalAmountAction,
  confirm: ClaimPanelConfirmer = adminConfirm,
): Promise<{ confirmed: boolean; error: string | null }> {
  const resolved = await resolveCancelApprovalConfirm(input, read);
  if (resolved.error !== undefined) return { confirmed: false, error: resolved.error };
  return { confirmed: await confirm(claimPanelConfirmRequest(resolved.confirm)) === true, error: null };
}

/** 반품·교환 승인 확인창. 자동 회수가 켜져 있을 때만 묻는다 — 승인이 택배사 회수 접수로 이어진다. */
export function claimCollectionApprovalConfirm(claimType: OrderClaimType, target: ClaimConfirmTarget = {}): ClaimPanelConfirm {
  return {
    title: confirmTitle(target, `${ORDER_CLAIM_TYPE_LABELS[claimType]} 승인`),
    confirmLabel: '승인하고 수거 시작',
    message: confirmBody(target, '승인하면 회수 계약 출고지는 몇 분 안에 택배사에 회수를 접수합니다.'),
  };
}

/** 거부 확인창. 거부는 끝 단계라 되돌릴 수 없고, 적은 사유가 구매자에게 그대로 간다 — 보내기 전에 사유를 한 번 더 보인다. */
export function claimRejectionConfirm(input: { claimType: OrderClaimType; reason: string; target?: ClaimConfirmTarget }): ClaimPanelConfirm {
  const target = input.target ?? {};
  return {
    title: confirmTitle(target, `${ORDER_CLAIM_TYPE_LABELS[input.claimType]} 거부`),
    confirmLabel: '거부',
    destructive: true,
    message: confirmBody(target, '구매자에게 아래 사유가 그대로 전달됩니다.', `“${input.reason}”`, `거부하면 ${IRREVERSIBLE}`),
  };
}

export const CLAIM_REJECTION_REASON_LENGTH_ERROR = '거부 사유를 10자 이상 200자 이하로 입력해주세요.';

/**
 * 거부의 확인 한 번. 사유 길이(서버·DB와 같은 10~200자)를 먼저 보고, 맞으면 사유를 보여 주는 확인창을 띄운다.
 * confirmed가 true일 때만 거부를 보낸다 — 길이가 맞지 않으면 확인창 없이 error로 알린다.
 */
export async function confirmClaimRejection(
  input: { claimType: OrderClaimType; note: unknown; target?: ClaimConfirmTarget },
  confirm: ClaimPanelConfirmer = adminConfirm,
): Promise<{ confirmed: boolean; error: string | null }> {
  const reason = typeof input.note === 'string' ? input.note.trim() : '';
  if (reason.length < 10 || reason.length > 200) return { confirmed: false, error: CLAIM_REJECTION_REASON_LENGTH_ERROR };
  const request = claimPanelConfirmRequest(claimRejectionConfirm({ claimType: input.claimType, reason, target: input.target }));
  return { confirmed: await confirm(request) === true, error: null };
}

/**
 * 반품의 첫 환불 접수 확인창(입고완료 단계). 접수하면 처리중이 돼 거부할 수 없고, 반품배송비 차감액이 이때 정해진다.
 * 금액은 DB가 정한 차감 판정이 있을 때만 말한다 — 판정이 없는 접수 전에는 화면이 가진 금액이 환불 기록의 금액이 아니다.
 */
export function claimRefundFilingConfirm(input: {
  autoCancelLabel: string | null;
  cancelScope: string;
  deduction?: { refundAmount: number; deductionAmount: number } | null;
  target?: ClaimConfirmTarget;
}): ClaimPanelConfirm {
  const target = input.target ?? {};
  return {
    title: confirmTitle(target, '환불 접수'),
    confirmLabel: '환불 접수',
    message: confirmBody(target,
      input.deduction
        ? `반품배송비 ${krwAmountWords(input.deduction.deductionAmount)}을 뺀 ${krwAmountWords(input.deduction.refundAmount)}으로 환불을 접수합니다. 접수하면 이 금액으로 정해집니다.`
        : '환불 접수를 기록합니다.',
      '접수한 뒤에는 이 요청을 거부할 수 없습니다.',
      input.autoCancelLabel ? `돈은 아직 나가지 않습니다. ${input.autoCancelLabel} ${input.cancelScope}는 접수한 뒤 [환불 완료 확정]을 눌러야 요청됩니다.` : null),
  };
}

/**
 * 환불 완료 확정 확인창. 아직 종결되지 않은 요청은 정합화(토스·나이스페이면 결제사 취소 발행)가 먼저 돈다.
 * 금액은 화면의 환불 금액(환불 기록·차감 결정)과 같은 값이다. autoCancelLabel은 취소 API로 자동 취소되는 결제사 이름이고, 아니면 null이다.
 */
export function claimRefundCompletionConfirm(input: {
  finalizationPending: boolean;
  autoCancelLabel: string | null;
  /** 화면의 환불 금액(환불 기록 금액). 모르면 금액 없이 묻는다. */
  amount?: number | null;
  /**
   * 반품배송비를 뺀 부분 취소(ADR-0031). paymentAmount는 결제사가 이 결제의 부분 취소를 받지 않을 때 대신 취소되는 전액이다 —
   * 그때는 다시 묻지 않고 전액을 취소하므로 확인창이 미리 말한다.
   */
  partialRefund?: { refundAmount: number; deductionAmount: number; paymentAmount?: number | null } | null;
  /** 이미 일부 취소가 있어 남은 결제 금액만 취소하는 경우의 그 금액. 없으면 결제 전액이다. */
  remainderAmount?: number | null;
  /** 부분 반품(ADR-0047): 고른 상품 몫만 부분 취소한다. 금액을 아직 모르면(접수 전) refundAmount가 null이다. */
  partialReturn?: { refundAmount: number | null; deductionAmount: number } | null;
  target?: ClaimConfirmTarget;
}): ClaimPanelConfirm {
  const { autoCancelLabel, partialRefund = null, remainderAmount = null, partialReturn = null } = input;
  const amount = input.amount ?? null;
  const target = input.target ?? {};
  if (!input.finalizationPending) {
    return {
      title: confirmTitle(target, '환불 완료 기록'), confirmLabel: '환불 완료 기록',
      message: confirmBody(target, '환불 완료 기록만 남길까요? 주문 취소·재고 복원은 이미 끝나 다시 하지 않습니다.'),
    };
  }
  const title = confirmTitle(target, '환불 완료 확정');
  if (partialReturn) {
    const share = partialReturn.refundAmount === null ? '고른 상품 몫' : `부분 반품한 상품 몫 ${krwAmountWords(partialReturn.refundAmount)}`;
    const deduction = partialReturn.deductionAmount > 0 ? `(반품배송비 ${krwAmountWords(partialReturn.deductionAmount)} 차감)` : '';
    return autoCancelLabel
      ? {
        title, destructive: true,
        confirmLabel: partialReturn.refundAmount === null ? '부분 취소' : `${krwAmountWords(partialReturn.refundAmount)} 부분 취소`,
        message: confirmBody(target,
          `${autoCancelLabel} 결제에서 ${share}${deduction}을 부분 취소하고, 고른 상품의 재고를 되돌립니다. 남은 상품과 주문은 그대로 남습니다.`,
          '결제사가 부분 취소를 받지 않으면 전액 환불로 돌리지 않고 확인 필요로 남습니다.',
          IRREVERSIBLE),
      }
      : { title, confirmLabel: '환불 완료 기록', message: confirmBody(target, `${share}${deduction}의 환불 완료를 기록할까요?`) };
  }
  if (autoCancelLabel && partialRefund) {
    const fee = krwAmountWords(partialRefund.deductionAmount);
    const full = typeof partialRefund.paymentAmount === 'number' ? ` ${krwAmountWords(partialRefund.paymentAmount)}` : '';
    return {
      title, confirmLabel: '환불 확정', destructive: true,
      message: confirmBody(target,
        `${autoCancelLabel} 결제에서 반품배송비 ${fee}을 뺀 ${krwAmountWords(partialRefund.refundAmount)}을 부분 취소하고 주문 취소·재고 복원을 확정합니다.`,
        `결제사가 이 결제의 부분 취소를 받지 않으면 다시 묻지 않고 전액${full}을 취소합니다. 그때는 반품배송비 ${fee}을 배송비 청구로 따로 받아야 합니다.`,
        IRREVERSIBLE),
    };
  }
  if (autoCancelLabel && remainderAmount !== null) {
    return {
      title, confirmLabel: `${krwAmountWords(remainderAmount)} 취소`, destructive: true,
      message: confirmBody(target,
        `${autoCancelLabel} 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 ${krwAmountWords(remainderAmount)}을 취소하고 주문 취소·재고 복원을 확정합니다.`,
        IRREVERSIBLE),
    };
  }
  if (autoCancelLabel) {
    return {
      title, confirmLabel: amount === null ? '환불 확정' : `${krwAmountWords(amount)} 취소`, destructive: true,
      message: confirmBody(target,
        `${autoCancelLabel} 결제 전액${amount === null ? '' : ` ${krwAmountWords(amount)}`}을 취소하고 주문 취소·재고 복원을 확정합니다.`,
        IRREVERSIBLE),
    };
  }
  return {
    title, confirmLabel: '환불 확정', destructive: true,
    message: confirmBody(target,
      amount === null ? null : `환불 금액 ${krwAmountWords(amount)}`,
      '결제사 관리자 화면(거래 내역)에서 전액 취소된 것을 확인했나요? 확정하면 주문 취소·재고 복원이 진행되고 되돌릴 수 없습니다.'),
  };
}

/**
 * 부분 반품(ADR-0047)의 환불 접수 확인 문구. 무통장은 접수가 곧 재고 처리·송금 대기 적용, 0원은 접수가 곧 적용·완료, 결제사 부분 취소는
 * 접수로 금액이 고정된다 — 어느 쪽이든 되돌릴 수 없다.
 */
export function partialReturnFilingConfirmation(
  partialReturn: { refundAmount: number | null; deductionAmount: number; bank?: boolean },
  autoCancelLabel: string | null,
) {
  if (partialReturn.bank) return partialReturnBankFilingConfirmation(partialReturn);
  if (partialReturn.refundAmount === 0) {
    return '부분 반품 환불 0원을 접수할까요? 고른 상품의 금액이 적립금·할인으로 모두 채워져 돌려줄 결제 금액이 없습니다. 접수하면 결제사에 취소를 요청하지 않고, 고른 상품의 재고를 바로 처리한 뒤(불량으로 고른 상품은 판매 재고에 넣지 않음) 요청을 완료합니다. 되돌릴 수 없습니다.';
  }
  const amount = partialReturn.refundAmount === null ? '고른 상품 몫' : krwAmountWords(partialReturn.refundAmount);
  const deduction = partialReturn.deductionAmount > 0 ? `(반품배송비 ${krwAmountWords(partialReturn.deductionAmount)} 차감)` : '';
  return `부분 반품 환불 ${amount}${deduction}을 접수할까요? 접수하면 금액이 고정되고 바뀌지 않습니다.${autoCancelLabel ? ` ${autoCancelLabel} 부분 취소는 [환불 완료 확정]을 누를 때 요청됩니다.` : ''} 되돌릴 수 없습니다.`;
}

/** 무통장 부분 반품(ADR-0047)의 환불 접수 확인 문구. 접수가 곧 재고 처리·송금 대기 적용이라 되돌릴 수 없음을 말한다. */
export function partialReturnBankFilingConfirmation(partialReturn: { refundAmount: number | null; deductionAmount: number }) {
  const amount = partialReturn.refundAmount === null ? '고른 상품 몫' : krwAmountWords(partialReturn.refundAmount);
  const deduction = partialReturn.deductionAmount > 0 ? `(반품배송비 ${krwAmountWords(partialReturn.deductionAmount)} 차감)` : '';
  return `부분 반품 환불 ${amount}${deduction}을 접수할까요? 접수하면 고른 상품의 재고를 지금 처리하고(불량으로 고른 상품은 판매 재고 제외) 환불 송금 대기에 올립니다. 남은 상품과 주문은 그대로 남습니다. 되돌릴 수 없습니다.`;
}

/** 부분 반품 환불 접수의 확인창. 문구는 위 두 함수 그대로이고, 대상·버튼 이름을 붙인다. */
function partialReturnFilingConfirm(
  partialReturn: { refundAmount: number | null; deductionAmount: number; bank?: boolean },
  autoCancelLabel: string | null,
  target: ClaimConfirmTarget,
): ClaimPanelConfirm {
  return {
    title: confirmTitle(target, '부분 반품 환불 접수'), confirmLabel: '환불 접수', destructive: true,
    message: confirmBody(target, partialReturnFilingConfirmation(partialReturn, autoCancelLabel)),
  };
}

function Feedback({ state }: { state: AdminClaimActionState }) {
  /* 결제사 확인 코드는 문장에 섞지 않고 아래 작은 글로 한 번만 보인다(L-12). 코드가 없는 문구는 그대로다. */
  const error = state.error ? splitAdminSupportCode(adminClaimCopy(state.error)) : null;
  return (
    <>
      {error ? (
        <AdminNotice role="alert" tone="danger">
          {error.text}
          {error.code ? (
            <span className="mt-1 block text-xs text-muted-foreground" data-claim-support-code="">
              {ADMIN_SUPPORT_CODE_LABEL} <code className="font-mono">{error.code}</code>
            </span>
          ) : null}
        </AdminNotice>
      ) : null}
      {state.message ? (
        <AdminNotice role="status" tone="info">{adminClaimCopy(state.message)}</AdminNotice>
      ) : null}
    </>
  );
}

const FORM_CLASS = 'flex min-w-0 flex-col gap-3';
const HINT_CLASS = 'text-xs text-muted-foreground';
const SECTION_TITLE_CLASS = 'text-sm font-medium text-foreground';

/** 돈이 나가는 버튼 옆에 얼마가 나가는지 적는다. 왼쪽 주문 요약까지 눈을 옮기지 않아도 되게 한다. */
function MoneyAtStake({ amount, label }: { amount: string | null; label: string }) {
  if (!amount) return null;
  return <p className="flex items-baseline gap-1.5" data-claim-money-at-stake="">
    <span className="text-muted-foreground">{label}</span>
    <strong className="text-base font-semibold tabular-nums">{amount}</strong>
  </p>;
}

/** 환불 수단 입력. 결제가 정한 수단이 있으면 고르지 않고 그 값을 그대로 보낸다. */
function RefundMethodField({
  fixedMethod,
  id,
  autoCancelLabel,
  cancelScope = '전액 취소',
}: {
  fixedMethod: OrderClaimRefundMethod | null;
  id: string;
  autoCancelLabel: string | null;
  /** 결제사 취소의 범위. 반품배송비를 빼는 반품은 '부분 취소'다(ADR-0031). */
  cancelScope?: '전액 취소' | '부분 취소' | '남은 금액 취소';
}) {
  if (fixedMethod) {
    return (
      <p className="text-sm">
        <input name="method" type="hidden" value={fixedMethod} />
        <span className="text-muted-foreground">환불 수단 · </span>
        {fixedMethod === 'pg_cancel' && autoCancelLabel
          ? `결제사 취소 (${autoCancelLabel} ${cancelScope})`
          : ORDER_CLAIM_REFUND_METHOD_LABELS[fixedMethod]}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>환불 수단</Label>
      <NativeSelect className="w-full sm:w-64" defaultValue="pg_cancel" id={id} name="method">
        {ORDER_CLAIM_REFUND_METHODS.map((method) => (
          <option key={method} value={method}>
            {ORDER_CLAIM_REFUND_METHOD_LABELS[method]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** 환불 메모(선택). 환불 접수와 완료 확정 양식이 같은 칸을 쓰고, 환불 기록에 남는다. */
function SettlementNoteField({ id, placeholder }: { id: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>환불 메모 (선택)</Label>
      <Input id={id} maxLength={300} name="note" placeholder={placeholder} type="text" />
    </div>
  );
}

export interface ClaimActionPanelProps {
  actorId?: string;
  bankTransfer?: boolean;
  claimId: string;
  claimType: OrderClaimType;
  orderId: string;
  stage: OrderClaimStage;
  /** 확인창에 적는 요청번호(예: C00012). 없으면 확인창 제목에서 빠진다. */
  claimReference?: string | null;
  /** 확인창에 적는 주문번호. */
  orderReference?: string | null;
  /** 주문의 실제 주문번호(없는 옛 주문은 null). 주문 통합검색 링크가 이 번호로 찾아 그 주문의 처리 패널까지 연다. */
  orderNumber?: string | null;
  /** 확인창에 적는 구매자 이름. */
  buyerName?: string | null;
  /** 반품·교환을 승인하면 택배사에 회수가 자동으로 접수되는가(자동 회수 사용). 켜져 있을 때만 승인 전에 묻는다. */
  autoPickupOnApproval?: boolean;
  /** 보류 해제 시 돌아갈 단계. 거부 가능 여부가 여기서 갈린다. */
  heldFrom: OrderClaimStage | null;
  /** 교환품을 한 출고지라도 재출고했는가. 그러면 거부할 수 없다(TKT-166). */
  reshipmentStarted?: boolean;
  /** 코페이 취소 접수 양식. 접수 채널이 이메일이라 콘솔이 붙여넣을 본문을 만든다. */
  cancellationForm: string | null;
  /** 환불 원장 행이 열려 있는가. 없으면 완료를 적을 대상 자체가 없다. */
  refundLedgerOpen: boolean;
  refundFiled: boolean;
  refundCompleted: boolean;
  /** 결제 provider(toss·korpay·bank_transfer). 결제가 없으면 null이다. */
  paymentProvider: string | null;
  /** 환불 원장에 이미 기록된 수단. 첫 기록이 이긴다. */
  recordedRefundMethod: OrderClaimRefundMethod | null;
  collectionPolicy: 'origin' | 'legacy' | null;
  collectionComplete: boolean;
  collectedAt?: string | null;
  returnCollectionContact?: ReactNode;
  returnRefundSummary?: ReactNode;
  collections: AdminClaimCollection[];
  /** 클레임 리비전(배송 분실 기록의 동시성 가드). 없으면 그 기록 폼을 그리지 않는다. */
  claimRevision?: number | null;
  /**
   * 환불 완료 확정 버튼 옆과 확인창에 적는 금액. 환불 원장 금액, 없으면 차감 판정의 환불액, 그것도 없으면 주문 금액이다. 표시 전용이다.
   * 환불 원장이 열리기 전(취소 승인 단계)의 값은 주문 금액이라 실제 취소액이 아닐 수 있다 — 그 단계에서는 이 값을 쓰지 않고
   * 결제 금액(paidAmount)을 보이고, 취소 금액은 누르는 시점에 서버에서 읽는다.
   */
  refundAmount?: number | null;
  /** 결제(승인) 금액. 환불 원장 금액이 이보다 작으면 이미 일부 취소한 주문이라 남은 금액만 취소한다. 표시 전용이다. */
  paidAmount?: number | null;
  /** 반품배송비 차감 판정·결정(ADR-0031). 스위치가 꺼져 있고 결정이 없으면 null — 패널은 지금 그대로다. */
  refundDeduction?: ReturnFeeDeduction | null;
  /** 부분 반품(ADR-0047)이면 고른 굿즈 몫의 환불액(접수 전 미리보기 또는 원장)과 반품배송비 차감. 주문 전체 반품이면 null — 패널은 지금 그대로다. */
  partialReturn?: { refundAmount: number | null; deductionAmount: number; bank?: boolean; refileable?: boolean; convertible?: boolean } | null;
  /** 반품인데 부분 반품 칸을 읽지 못했다. 주문 전체 환불 문구·흐름을 그리지 않도록 환불 단계를 열지 않고 경고만 보인다. */
  partialReturnUnavailable?: boolean;
  /** 반품 품목별 재고 처리 선택(QNA-035). 반품이 아니거나 읽지 못하면 null — 선택 칸을 그리지 않고 지금처럼 전부 복원한다. */
  defectiveStock?: ClaimDefectiveStock | null;
  /** 교환: 회수를 확인했고 재출고 전인 출고지의 회수품 재고 처리(CLM-046). 하자·오배송 교환은 저장해야 재출고가 열린다. */
  exchangeStockTargets?: AdminClaimExchangeStockTarget[];
  /** 처리 제목 바로 아래에 둘 요청 요약(교환이 무엇으로 바꾸려는지). */
  requestSummary?: ReactNode;
  /** 교환: 처리 제목 아래의 단계 표시. */
  exchangeSteps?: ReactNode;
  /** 교환: 지금 할 일 다음에 이어지는 재출고·배송완료 처리. */
  exchangeShipping?: ReactNode;
  /** 교환: 필요할 때만 쓰는 처리(보류와 함께 맨 아래에 묶는다). */
  secondaryActions?: ReactNode;
}

export function ClaimActionPanel({
  actorId,
  bankTransfer = false,
  cancellationForm,
  claimId,
  claimType,
  claimReference = null,
  orderReference = null,
  orderNumber = null,
  buyerName = null,
  autoPickupOnApproval = false,
  heldFrom,
  reshipmentStarted = false,
  orderId,
  refundCompleted,
  refundFiled,
  refundLedgerOpen,
  stage,
  paymentProvider,
  recordedRefundMethod,
  collectionPolicy,
  collectionComplete,
  collections,
  claimRevision = null,
  collectedAt = null,
  returnCollectionContact,
  returnRefundSummary,
  refundAmount = null,
  paidAmount = null,
  refundDeduction = null,
  partialReturn = null,
  partialReturnUnavailable = false,
  defectiveStock = null,
  exchangeStockTargets = [],
  requestSummary = null,
  exchangeSteps = null,
  exchangeShipping = null,
  secondaryActions = null,
}: ClaimActionPanelProps) {
  const [result, panelAction, actionPending] = useActionState(runClaimPanelAction, EMPTY_STATE);
  /* 취소 승인은 확인창을 띄우기 전에 취소 금액을 서버에서 읽는다. 읽는 동안에도 다른 처리를 누르지 못하게 한다. */
  const [checking, setChecking] = useState(false);
  const checkingNow = useRef(false);
  const pending = actionPending || checking;
  /* 목록 위 팝업(R8)에서는 결제사 취소·환불 완료 확정을 기다리는 동안 팝업이 닫히지 않게 한다. */
  useClaimPreviewBusy(pending);
  const [formCopied, setFormCopied] = useState(false);
  /* 레거시 회수 확인의 실제 입고일 기본값·상한(KST 오늘). */
  const [today] = useState(() => adminClaimTodayKst());
  /* 서버에 보내기 전에 화면에서 멈춘 이유(취소 금액을 읽지 못함 · 거부 사유 길이). 보내면 지운다. */
  const [localError, setLocalError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const target: ClaimConfirmTarget = { claimReference, orderReference, buyerName };
  const send = (formData: FormData) => {
    setLocalError(null);
    setRejectError(null);
    startTransition(() => panelAction(formData));
  };
  /* 확인을 통과한 제출만 보낸다. 누른 버튼의 name·value(결정)를 함께 싣는다. */
  const submitConfirmed = async (event: React.FormEvent<HTMLFormElement>) => {
    /* 확인창을 기다리는 사이 이벤트가 비워지므로 보낼 값은 누른 시점에 담아 둔다. */
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter ?? null);
    if (!(await confirmClaimPanelSubmit(event))) return;
    send(formData);
  };

  const next = orderClaimNextStages(claimType, stage);
  const canApprove = stage === 'requested' || stage === 'in_review';
  const canReview = stage === 'requested';
  const canHold = next.includes('on_hold');
  const canResume = stage === 'on_hold';
  const canReject = canRejectOrderClaim(stage, heldFrom, reshipmentStarted);
  const collectionReady = collectionPolicy !== null && collectionComplete;
  const cancellationWithoutCollection = claimType === 'cancel' && collectionPolicy !== null && collectionComplete && collections.length === 0;
  const originCollectionOpen = collectionPolicy === 'origin' && ['collecting', 'collected', 'processing', 'needs_review'].includes(stage);
  const canRecordOrigin = originCollectionOpen && !collectionComplete;
  const canCollect = collectionPolicy === 'legacy' && claimType !== 'cancel' && stage === 'collecting';
  const canFileRefund = claimType !== 'exchange'
    && !partialReturnUnavailable
    /* 부분 반품은 살아 있는 원장이 생기면 금액이 고정된다 — 다시 접수해도 바뀌는 것이 없어 '접수 정보 갱신'을 그리지 않는다. */
    && !(partialReturn && refundFiled)
    && collectionReady
    /* 부분 반품은 결제사가 부분 취소를 받지 않아 확인 필요로 남은 뒤에도 다시 접수할 수 있다(새 원장으로 다시 시도). */
    && (stage === 'collected' || stage === 'processing' || (Boolean(partialReturn?.refileable) && stage === 'needs_review'));
  /* 완료를 적을 수 있는지는 단계가 아니라 원장이 정한다. 레거시 경로로 종결된
     클레임은 stage가 completed여도 refunds.completed_at이 비어 있고, 반대로 원장
     행이 아예 없는 주문에는 적을 대상이 없다(RPC가 claim_refund_ledger_missing으로
     막는다). 단계만 보면 "누르면 반드시 실패하는 버튼"이 생긴다. */
  const refundStageReached = stage === 'processing'
    || stage === 'needs_review'
    || stage === 'completed';
  const canCompleteRefund = claimType !== 'exchange'
    && !partialReturnUnavailable
    && collectionReady
    && refundStageReached
    && refundLedgerOpen
    && !refundCompleted;
  const refundLedgerMissing = claimType !== 'exchange'
    && refundStageReached
    && !refundLedgerOpen;
  /* 원장 없는 취소(결제창만 열렸거나 결제 결과가 정해지기 전)는 [환불 완료 확정]이
     그려지지 않고, 만료 sweep도 처리중 요청을 건너뛴다. 이 건을 닫는 버튼은 주문
     통합검색 주문 패널의 재확인뿐이라 항상 보이는 이 문구가 그 버튼을 가리킨다. */
  const orderPanelRecheckLabel = claimType === 'cancel'
    ? stage === 'processing'
      ? ADMIN_CANCELLATION_RECHECK_LABELS.processing
      : stage === 'needs_review'
        ? ADMIN_CANCELLATION_RECHECK_LABELS.needsReview
        : null
    : null;
  /* 이미 종결된 클레임에서는 정합화가 더 돌지 않는다. 남은 일은 원장 기록뿐이다. */
  const refundFinalizationPending = stage !== 'completed';
  /* 취소 API로 전액 취소를 발행하는 결제사(토스·나이스페이)면 그 이름, 아니면 null. */
  const autoCancelLabel = providerCancelsAutomatically(paymentProvider)
    ? automatedCancelProviderLabel(paymentProvider)
    : null;
  /* 취소 승인이 곧바로 결제사 전액 취소를 발행하는 경우. 다른 승인과 같은 버튼으로 보이면 안 된다. */
  const approvalMovesMoney = canApprove && claimType === 'cancel' && Boolean(autoCancelLabel);
  /*
   * 결정 양식의 제출. 결제사 취소가 바로 나가는 취소 승인만 길이 다르다 — 승인 전에는 환불 기록이 없어 화면이 가진 금액이
   * 주문 금액뿐이라(앞서 부분 취소한 주문은 그보다 적게 취소된다), 누르는 시점에 취소할 금액을 읽어 확인창에 적는다.
   * 읽지 못하면 확인창도 띄우지 않고 보내지도 않는다.
   */
  const submitDecision = async (event: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter ?? null);
    if (!approvalMovesMoney || formData.get('decision') !== 'approve') {
      await submitConfirmed(event);
      return;
    }
    event.preventDefault();
    if (checkingNow.current) return;
    checkingNow.current = true;
    setChecking(true);
    setLocalError(null);
    try {
      const { confirmed, error } = await confirmCancelApproval({ claimId, paidAmount, target });
      if (error) setLocalError(error);
      if (confirmed) send(formData);
    } finally {
      checkingNow.current = false;
      setChecking(false);
    }
  };
  /* 거부는 끝 단계라 되돌릴 수 없고 사유가 구매자에게 그대로 간다. 길이를 먼저 보고, 보낼 사유를 확인창에 그대로 보인다. */
  const submitRejection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter ?? null);
    const { confirmed, error } = await confirmClaimRejection({ claimType, note: formData.get('note'), target });
    setRejectError(error);
    if (confirmed) send(formData);
  };
  /* 수단은 원장 기록 → 결제 provider 순으로 정해진다. 정해지지 않은 결제(Korpay)만
     운영자가 고른다. 서버 액션이 같은 규칙으로 다시 검사한다. */
  const fixedRefundMethod = recordedRefundMethod ?? orderClaimRefundMethodForProvider(paymentProvider);
  const panelTitle = `${ORDER_CLAIM_TYPE_LABELS[claimType]} 처리`;
  const feedback: AdminClaimActionState = localError ? { error: localError } : result;
  /* 승인 단계에는 결제 금액만 확실하다. 실제 취소 금액은 누른 뒤 확인창이 서버에서 읽어 말한다(submitDecision). */
  const approvalPaidAmount = paidAmount ?? refundAmount;
  const amountAtStake = partialReturn ? (partialReturn.refundAmount === null ? null : krw(partialReturn.refundAmount))
    : refundAmount === null ? null : krw(refundAmount);
  /* 반품배송비를 빼고 결제사 부분 취소로 돌려주는 반품(ADR-0031). 판정·결정이 없으면 지금처럼 전액 취소다. */
  const returnDeduction = claimType === 'return' ? refundDeduction : null;
  const partialRefund = returnDeduction?.applicable && returnDeduction.refundAmount !== null && autoCancelLabel
    /* paymentAmount: 결제사가 부분 취소를 받지 않으면 대신 취소되는 전액(차감 결정의 기준 금액). 확인창이 그 경우를 미리 말한다. */
    ? { refundAmount: returnDeduction.refundAmount, deductionAmount: returnDeduction.deductionAmount, paymentAmount: returnDeduction.paymentAmount }
    : null;
  /* 이미 일부 취소가 있어 원장 환불액이 결제 금액보다 작으면 결제사 취소는 남은 금액이다. 화면이 이미 가진 두 금액을 비교할 뿐이다. */
  const remainderAmount = !partialReturn && !partialRefund && autoCancelLabel && refundLedgerOpen && refundAmount !== null && paidAmount !== null && refundAmount < paidAmount
    ? refundAmount
    : null;
  const cancelScope = partialReturn || partialRefund ? '부분 취소' : remainderAmount !== null ? '남은 금액 취소' : '전액 취소';
  const completionLabel = autoCancelLabel ? `환불 완료 확정 (${autoCancelLabel} ${cancelScope})` : '환불 완료 확정 (재고 복원 포함)';
  /*
   * 환불 접수의 확인창. 부분 반품(ADR-0047)은 접수가 금액 고정·재고 처리라 늘 묻고, 주문 전체 반품은 입고완료 단계의 첫 접수만 묻는다 —
   * 그 접수로 처리중이 돼 거부할 수 없게 되고 반품배송비 차감액이 정해진다. 이미 처리중인 요청의 접수·갱신은 다시 할 수 있어 묻지 않는다.
   */
  const filingConfirm = !canFileRefund || bankTransfer ? null
    : partialReturn ? partialReturnFilingConfirm(partialReturn, autoCancelLabel, target)
      : stage === 'collected' && !refundFiled ? claimRefundFilingConfirm({
        autoCancelLabel, cancelScope, target,
        deduction: returnDeduction?.applicable && returnDeduction.refundAmount !== null
          ? { refundAmount: returnDeduction.refundAmount, deductionAmount: returnDeduction.deductionAmount } : null,
      }) : null;
  /* 입고완료 단계에서는 접수를 기록해야 [환불 완료 확정]이 열린다. 접수가 곧 적용·완료인 부분 반품(무통장·0원)은 다음 버튼이 없다. */
  const completionLockedUntilFiled = canFileRefund && !bankTransfer && stage === 'collected' && !refundFiled
    && !partialReturn?.bank && partialReturn?.refundAmount !== 0;
  const deductionHeadline = returnFeeDeductionHeadline(returnDeduction);
  const deductionSkipped = returnFeeDeductionSkippedNotice(returnDeduction);
  const deductionNotice = returnDeduction && (deductionHeadline || deductionSkipped) && stage !== 'completed' ? (
    deductionHeadline ? (
      <div data-claim-refund-deduction="deduct"><AdminNotice title={deductionHeadline} tone="info">
        {`단순 변심 반품이라 결제 금액 ${krwAmountWords(returnDeduction.paymentAmount ?? 0)}에서 반품배송비(${returnFeeDeductionBasisLabel(returnDeduction)})를 빼고 환불합니다.`}
        {returnDeduction.source === 'plan' ? ' 환불 접수를 기록할 때 이 금액으로 정해집니다.' : ''}
        {/* 확정 버튼이 열리면 같은 말을 버튼 바로 위 경고와 확인창이 금액과 함께 한다 — 여기서 되풀이하지 않는다. */}
        {autoCancelLabel && !canCompleteRefund
          ? ` [환불 완료 확정]을 누르면 ${autoCancelLabel} 부분 취소로 환불액만 취소합니다. 결제사가 이 결제의 부분 취소를 받지 않으면 전액 환불하고, 반품배송비는 배송비 청구로 따로 받습니다.`
          : ''}
      </AdminNotice></div>
    ) : (
      <div data-claim-refund-deduction="skipped"><AdminNotice tone="warning">{deductionSkipped}</AdminNotice></div>
    )
  ) : null;
  if (stage === 'withdrawn' && claimType !== 'return') return <div className="flex flex-col gap-2"><h3 className="text-base font-medium">{panelTitle}</h3><p>요청 철회로 처리가 종료됐습니다. 주문과 결제는 유지됩니다.</p>{secondaryActions ? <div className="flex min-w-0 flex-wrap items-start gap-2 [&>section]:w-full">{secondaryActions}</div> : null}</div>;

  /* 환불(재고)은 확정됐는데 불량 재고 기록만 남은 반품(QNA-035). 종결된 요청은 단계가 모두 접히므로 단계 안이 아니라 맨 위 상태 칸에 둔다
     — 불량 재고 화면이 '반품 상세에서 [불량 기록 다시 시도]'를 안내한다(QA2 M1). */
  const defectiveRetry = claimType === 'return' && defectiveStock && defectiveStock.pending > 0 && defectiveStock.frozen ? (
    <form action={panelAction} className={FORM_CLASS} data-claim-defective-pending="">
      <PanelActionField kind="defectiveRetry" />
      <input name="claimId" type="hidden" value={claimId} />
      <input name="claimType" type="hidden" value={claimType} />
      <AdminNotice title="불량 기록 필요" tone="warning">{DEFECTIVE_STOCK_PENDING_NOTICE}</AdminNotice>
      <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">불량 기록 다시 시도</Button>
    </form>
  ) : null;

  /* 철회된 반품: 회수 처리는 끝났지만 자동 회수 접수가 있었으면 그 결과(수거 취소됨 · 요청 철회 등)를 남긴다(QA2 S-T13b-03). */
  const withdrawnPickups = stage === 'withdrawn' ? collections.flatMap((collection) => {
    const bundles = collection.bundles ?? [];
    return bundles.flatMap((bundle, index) => bundle.pickup ? [{ key: bundle.bundleId, label: bundles.length > 1
      ? `${collection.originName} · 반품지 ${index + 1}/${bundles.length}` : collection.originName, pickup: bundle.pickup }] : []);
  }) : [];

  const originCollection = <>
    {cancellationWithoutCollection ? <p className="text-muted-foreground">상품 회수가 필요하지 않은 취소입니다.</p> : collectionPolicy === 'origin' ? <section aria-label="출고지별 회수 확인" className="flex min-w-0 flex-col gap-3">
        <h4 className={SECTION_TITLE_CLASS}>출고지별 회수 확인</h4>
        <p>{collectionComplete && collections.length > 0
          ? '모든 출고지의 회수를 확인했습니다.'
          : claimType === 'exchange' && canApprove
            ? '승인하면 아래 출고지에서 수거를 시작합니다. 상품이 돌아오면 출고지별로 회수를 확인한 뒤 재출고합니다.'
            : '모든 출고지의 상품과 수량을 회수 확인한 뒤 환불·재출고를 진행합니다.'}</p>
        {collections.length ? collections.map((collection) => <ClaimOriginCollection
          key={collection.shipmentId} claimId={claimId} claimType={claimType}
          /* 회수 생략으로 결정한 출고지는 회수가 끝난 것으로 보지만, 요청이 열려 있는 동안 늦게 도착한 입고는 기록할 수 있다(재고 변화 없음). */
          collection={collection} canRecord={canRecordOrigin || (originCollectionOpen && collection.collectionWaived === true)} claimRevision={claimRevision} />)
          : <p className="text-muted-foreground">수거를 승인하면 출고지별 반품지 주소와 상품이 표시됩니다.</p>}
      </section> : collectionPolicy === null ? <p className="text-destructive" role="alert">회수 정보를 불러오지 못했습니다. 새로고침해주세요.</p> : null}
  </>;

  /* 교환 회수품 재고 처리(CLM-046). 출고지마다 한 양식이다 — 회수를 확인한 곳부터 재출고하므로 결정도 출고지 단위다.
     하자·오배송 교환에서 아직 정하지 않은 출고지는 품목마다 고르지 않으면 저장되지 않는다(기본값 없음). */
  const exchangeStock = claimType === 'exchange' && exchangeStockTargets.length > 0 ? (
    <section aria-label="회수품 재고 처리" className="flex min-w-0 flex-col gap-3" data-claim-exchange-stock="">
      <h4 className={SECTION_TITLE_CLASS}>회수품 재고 처리</h4>
      {exchangeStockTargets.some((target) => target.required && !target.decided) ? (
        <AdminNotice title="재출고 전에 회수 상품의 재고 처리를 정해주세요" tone="warning">
          {`${EXCHANGE_STOCK_DECISION_REQUIRED} 검수 결과대로 품목마다 '불량' 또는 '판매 재고 복원'을 골라 저장하면 그 출고지의 재출고 등록이 열립니다.`}
        </AdminNotice>
      ) : null}
      {exchangeStockTargets.map((target) => {
        const key = target.shipmentId ?? 'order';
        const undecided = target.required && !target.decided;
        return (
          <form action={panelAction} className={FORM_CLASS} data-claim-exchange-stock-target={key} key={key}>
            <PanelActionField kind="exchangeStockPlan" />
            <input name="claimId" type="hidden" value={claimId} />
            <input name="claimType" type="hidden" value={claimType} />
            <input name="shipmentId" type="hidden" value={target.shipmentId ?? ''} />
            <input name="originName" type="hidden" value={target.originName ?? ''} />
            <ClaimDefectiveStockChoice
              idPrefix={`claim-exchange-stock-${key}`}
              items={target.items}
              legend={`${target.originName ?? '주문 전체'} 회수 상품`}
              note={EXCHANGE_STOCK_FIELD_NOTE}
              requireChoice={undecided}
            />
            <Button className="w-fit" disabled={pending} size="sm" type="submit" variant={undecided ? 'default' : 'outline'}>재고 처리 저장</Button>
            <p className={HINT_CLASS}>
              {target.decided
                ? `${target.decidedByName ?? '담당자'}가 저장했습니다. 이 출고지를 재출고하기 전까지 바꿀 수 있습니다.`
                : target.required
                  ? '저장하기 전에는 이 출고지를 재출고할 수 없습니다. 모두 다시 팔 수 있으면 모두 판매 재고 복원으로 저장합니다.'
                  : '단순 변심 교환은 저장하지 않으면 회수 상품을 모두 판매 재고로 복원합니다. 불량이 있을 때만 저장하면 됩니다.'}
            </p>
          </form>
        );
      })}
    </section>
  ) : null;

  const decisionForm = <>
    {canReview || canApprove ? (
        <form action={ignoreUnconfirmedClaimSubmit} className={FORM_CLASS} onSubmit={submitDecision}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          {/* 누르기 전에 읽도록 버튼 위에 둔다. 돈이 바로 나가는 승인만 경고 상자를 쓴다. */}
          {approvalMovesMoney ? (
            <AdminNotice title="승인하면 되돌릴 수 없습니다" tone="warning">
              {`승인하면 바로 ${autoCancelLabel} 결제를 취소하고 결제사에 결과를 확인합니다. 취소가 확인되면 주문 취소·재고 복원까지 함께 끝납니다. 취소 금액은 버튼을 누르면 확인창에 나옵니다.`}
            </AdminNotice>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {approvalMovesMoney ? <MoneyAtStake amount={approvalPaidAmount === null ? null : krw(approvalPaidAmount)} label="결제 금액" /> : null}
            {canApprove ? (
              <Button
                /* 결제사 취소가 바로 나가는 승인은 속성이 아니라 submitDecision이 누르는 시점의 금액으로 확인창을 만든다. */
                {...confirmAttributes(approvalMovesMoney ? null
                  : claimType === 'cancel' ? claimCancelApprovalConfirm(paymentProvider, target)
                    : autoPickupOnApproval ? claimCollectionApprovalConfirm(claimType, target) : null)}
                disabled={pending}
                name="decision"
                type="submit"
                value="approve"
                variant={approvalMovesMoney ? 'danger' : 'default'}
              >
                {claimType !== 'cancel'
                  ? '승인하고 수거 시작'
                  : autoCancelLabel ? `승인하고 ${autoCancelLabel} 전액 취소`
                    : paymentProvider === null ? '승인하고 주문 취소' : '승인하고 환불 처리 시작'}
              </Button>
            ) : null}
            {canReview ? (
              <Button
                disabled={pending}
                name="decision"
                size="sm"
                type="submit"
                value="review"
                variant="outline"
              >
                검토중으로 표시
              </Button>
            ) : null}
          </div>
          {canApprove && claimType === 'cancel' && !approvalMovesMoney ? (
            <p className={HINT_CLASS}>
              {paymentProvider === 'korpay'
                ? `${PAYMENT_PROVIDER_LABELS.korpay} 결제는 승인 뒤 결제사 취소 접수 양식으로 접수하고 환불 완료를 확정합니다.`
                : paymentProvider === 'bank_transfer'
                  ? '무통장 입금 결제는 승인 뒤 환불계좌 송금 절차로 진행합니다.'
                  : '결제 전 주문은 승인하면 결제사 취소 없이 주문을 취소합니다.'}
            </p>
          ) : null}
        </form>
      ) : null}
  </>;

  const holdControl = <>
    {canHold || canResume ? <ClaimHoldControl key={claimId} claimId={claimId} claimType={claimType} held={canResume} /> : null}
  </>;

  const legacyCollection = <>
    {canCollect ? (
        <form action={panelAction} className={FORM_CLASS}>
          <PanelActionField kind="collection" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="stage" type="hidden" value="collected" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`claim-legacy-received-${claimId}`}>실제 입고일</Label>
            <Input className="w-full sm:w-44" defaultValue={today} disabled={pending} id={`claim-legacy-received-${claimId}`} max={today} name="receivedOn" required type="date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`claim-legacy-evidence-${claimId}`}>회수 확인 근거 (선택)</Label>
            <Textarea disabled={pending} id={`claim-legacy-evidence-${claimId}`} maxLength={500} name="evidence" placeholder="창고 회신 번호와 반송 상품·수량 대조 결과" rows={2} />
            <p className={HINT_CLASS}>적은 근거는 처리 이력(감사 기록)에 남습니다.</p>
          </div>
          <Button className="w-fit" disabled={pending} size="sm" type="submit">
            반송 {V.goods} 입고 확인
          </Button>
          <p className={HINT_CLASS}>
            환불 기한(영업일 3일)은 확인 버튼을 누른 때가 아니라 실제 입고일부터 셉니다.
          </p>
        </form>
      ) : null}
  </>;

  const refundControls = <>
    {deductionNotice}
    {cancellationForm && collectionReady ? (
        <section aria-labelledby="claim-cancellation-form-heading" className="flex min-w-0 flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASS} id="claim-cancellation-form-heading">
            결제사 취소 접수 양식
          </h4>
          <p className={HINT_CLASS}>
            {PAYMENT_PROVIDER_LABELS.korpay} 취소는 자동으로 요청되지 않고 이메일로 접수합니다. 아래 본문을 그대로 보낸 뒤
            [환불 접수 완료로 기록]을 눌러 환불 기록에 남겨주세요.
          </p>
          <Textarea
            aria-label="결제사 취소 접수 양식"
            className="font-mono text-xs [field-sizing:fixed]"
            readOnly
            rows={9}
            value={cancellationForm}
          />
          <Button
            className="w-fit"
            onClick={() => {
              void navigator.clipboard?.writeText(cancellationForm).then(
                () => setFormCopied(true),
                () => setFormCopied(false),
              );
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {formCopied ? '복사했습니다' : '양식 복사'}
          </Button>
        </section>
      ) : null}

      {stage !== 'withdrawn' && bankTransfer && actorId && claimType !== 'exchange' ? <BankTransferRefund actorId={actorId} orderId={orderId} claimId={claimId} /> : null}

      {(bankTransfer || partialReturn?.convertible) && claimType === 'return' && defectiveStock && !defectiveStock.frozen && stage !== 'completed' && stage !== 'withdrawn' && stage !== 'rejected'
        && defectiveStock.items.some((item) => item.state !== 'recorded') ? (
        <form action={panelAction} className={FORM_CLASS}>
          <PanelActionField kind="defectivePlan" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <ClaimDefectiveStockChoice idPrefix="claim-bank-stock-disposition" items={defectiveStock.items} />
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">품목별 재고 처리 저장</Button>
          <p className={HINT_CLASS}>{partialReturn?.convertible
            ? '계좌 송금 부분 환불로 전환하면 고른 상품의 재고를 바로 처리합니다(불량으로 고른 상품은 판매 재고에 넣지 않음). 불량 상품이 있으면 전환하기 전에 [품목별 재고 처리 저장]을 눌러주세요.'
            : '무통장 환불은 위 [취소 확정 · 재고 복원]을 누를 때 재고가 복원되고 불량 재고도 함께 기록됩니다. 불량 상품이 있으면 그 전에 [품목별 재고 처리 저장]을 눌러주세요.'}</p>
        </form>
      ) : null}


      {partialReturnUnavailable && claimType === 'return' && stage !== 'completed' && stage !== 'withdrawn' && stage !== 'rejected' ? (
        <AdminNotice tone="warning">부분 반품 정보를 읽지 못해 환불 단계를 열지 않았습니다. 고객이 일부 상품만 반품했을 수 있으니 화면을 새로고침한 뒤 진행해주세요.</AdminNotice>
      ) : null}

      {canFileRefund && !bankTransfer ? (
        /*
         * 부분 반품(ADR-0047)의 접수는 되돌릴 수 없다 — 금액이 고정되고, 무통장·0원은 접수와 함께 적용(재고 처리)된다. 결제 수단과 무관하게
         * 셸 확인창을 거치고, 품목별 재고 처리(불량 선택)를 이 양식에서 함께 저장한 뒤 접수한다(Codex 리뷰: 0원 반품이 선택 전에 재고를 복원).
         */
        <form
          action={filingConfirm ? ignoreUnconfirmedClaimSubmit : panelAction}
          className={FORM_CLASS}
          {...confirmAttributes(filingConfirm)}
          onSubmit={filingConfirm ? submitConfirmed : undefined}
        >
          <PanelActionField kind="refund" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="filed" />
          <RefundMethodField fixedMethod={fixedRefundMethod} id="claim-refund-method" autoCancelLabel={autoCancelLabel} cancelScope={cancelScope} />
          <SettlementNoteField id="claim-refund-note" placeholder="예: 이미 정산된 결제라 다음 정산에서 빼기로 결제사와 확인" />
          {partialReturn && claimType === 'return' && defectiveStock && !defectiveStock.frozen
            ? <ClaimDefectiveStockChoice idPrefix="claim-refund-file-stock" items={defectiveStock.items} /> : null}
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant={refundFiled ? 'outline' : 'default'}>
            {refundFiled ? '환불 접수 정보 갱신' : '환불 접수 완료로 기록'}
          </Button>
          {partialReturn?.bank ? (
            <p className={HINT_CLASS}>
              무통장 부분 반품은 [환불 접수 완료로 기록]을 누르면 고른 상품의 재고를 바로 처리하고(위에서 불량으로 고른 상품은 판매 재고에 넣지 않음) 환불 송금 대기에 올립니다. 되돌릴 수 없습니다.
            </p>
          ) : partialReturn?.refundAmount === 0 ? (
            <p className={HINT_CLASS}>
              돌려줄 결제 금액이 0원(적립금·할인으로 모두 채워짐)이라 [환불 접수 완료로 기록]을 누르면 고른 상품의 재고를 바로 처리하고(위에서 고른 대로) 요청을 완료합니다. 되돌릴 수 없습니다.
            </p>
          ) : autoCancelLabel ? (
            <p className={HINT_CLASS}>
              접수만 기록합니다. {autoCancelLabel} {cancelScope}는 아래 [환불 완료 확정]을 누를 때 요청됩니다.
            </p>
          ) : null}
        </form>
      ) : null}

      {/* 접수 전에는 확정을 누를 수 없다 — 다음 단계의 버튼을 잠근 채 보여 두 버튼의 순서가 드러나게 한다. */}
      {completionLockedUntilFiled ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-claim-refund-locked="">
          <Button className="h-auto min-h-7 w-fit max-w-full py-1 whitespace-normal" disabled size="sm" type="button" variant="outline">{completionLabel}</Button>
          <span className={HINT_CLASS}>환불 접수를 기록하면 누를 수 있습니다.</span>
        </div>
      ) : null}

      {canCompleteRefund && partialReturn?.bank && stage !== 'completed' ? (
        <AdminNotice tone="info">계좌 송금으로 돌려주는 부분 반품 환불은 송금 대기에 올라 있습니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 누르면 이 요청이 완료됩니다.</AdminNotice>
      ) : null}

      {canCompleteRefund && !bankTransfer && !partialReturn?.bank ? (
        <form
          action={ignoreUnconfirmedClaimSubmit}
          className={FORM_CLASS}
          {...confirmAttributes(claimRefundCompletionConfirm({
            finalizationPending: refundFinalizationPending, autoCancelLabel, amount: refundAmount, partialRefund, remainderAmount, partialReturn, target,
          }))}
          onSubmit={submitConfirmed}
        >
          <PanelActionField kind="refund" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="completed" />
          <RefundMethodField fixedMethod={fixedRefundMethod} id="claim-refund-complete-method" autoCancelLabel={autoCancelLabel} cancelScope={cancelScope} />
          <SettlementNoteField id="claim-refund-complete-note" />
          {refundFinalizationPending && claimType === 'return' && defectiveStock && !defectiveStock.frozen ? <ClaimDefectiveStockChoice idPrefix="claim-stock-disposition" items={defectiveStock.items} /> : null}
          {refundFinalizationPending ? (
            <AdminNotice title="확정하면 되돌릴 수 없습니다" tone="warning">
              {autoCancelLabel && partialReturn
                ? `누르면 ${autoCancelLabel} 결제에서 부분 반품한 상품 몫${partialReturn.refundAmount === null ? '' : ` ${krwAmountWords(partialReturn.refundAmount)}`}만 부분 취소하고, 결제사에 조회해 취소됐는지 확인합니다. 확인되면 고른 상품의 재고를 되돌립니다. 남은 상품과 주문은 그대로 둡니다. 결제사가 부분 취소를 받지 않으면 전액 환불로 돌리지 않고 확인 필요로 남습니다.`
                : partialReturn
                ? '무통장 부분 반품은 환불 접수 때 환불 송금 대기에 올라갑니다. 송금한 뒤 주문 상세의 부분 환불 기록에서 [송금 완료 기록]을 눌러주세요.'
                : autoCancelLabel && partialRefund
                ? `누르면 ${autoCancelLabel} 결제에서 반품배송비 ${krwAmountWords(partialRefund.deductionAmount)}을 뺀 ${krwAmountWords(partialRefund.refundAmount)}을 부분 취소하고, 결제사에 남은 결제 금액을 조회해 취소됐는지 확인합니다. 이미 취소된 금액이면 확인만 합니다. 결제사가 이 결제의 부분 취소를 받지 않으면 전액${typeof partialRefund.paymentAmount === 'number' ? ` ${krwAmountWords(partialRefund.paymentAmount)}` : ''}을 취소하고, 반품배송비는 배송비 청구로 따로 받아야 합니다. 그 밖에 확인되지 않으면 주문과 재고는 그대로 두고 결제확인필요로 남습니다.`
                : autoCancelLabel && remainderAmount !== null
                ? `누르면 ${autoCancelLabel} 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 ${krwAmountWords(remainderAmount)}을 취소하고 결제사에 결과를 확인합니다. 이미 취소된 금액이면 확인만 합니다. 확인되지 않으면 주문과 재고는 그대로 두고 결제확인필요로 남습니다.`
                : autoCancelLabel
                ? `누르면 ${autoCancelLabel} 결제 전액을 취소하고 결제사에 결과를 확인합니다. 이미 취소된 결제면 확인만 합니다. 확인되지 않으면 주문과 재고는 그대로 두고 결제확인필요로 남습니다.`
                : '결제사 관리자 화면(거래 내역)에서 전액 취소된 것을 확인한 뒤 눌러주세요. 확인되지 않으면 주문과 재고는 그대로 유지됩니다.'}
            </AdminNotice>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {refundFinalizationPending ? <MoneyAtStake amount={amountAtStake} label="환불 금액" /> : null}
            <Button className="h-auto min-h-7 w-fit max-w-full py-1 whitespace-normal" disabled={pending} size="sm" type="submit" variant={refundFinalizationPending ? 'danger' : 'default'}>
              {!refundFinalizationPending ? '환불 완료 기록만 남기기' : completionLabel}
            </Button>
          </div>
          {!refundFinalizationPending ? (
            <p className={HINT_CLASS}>
              {`이 ${V.claimRequest}은 이미 종결됐습니다. 주문 취소·재고 복원은 끝났고, 여기서는 환불 완료 기록만 남깁니다.`}
            </p>
          ) : null}
        </form>
      ) : null}

      {refundLedgerMissing && orderPanelRecheckLabel ? (
        <p className="text-muted-foreground">
          이 주문에는 환불 기록이 없어 [환불 완료 확정]을 쓸 수 없습니다. 결제 내역이
          없는 주문(결제창만 열렸거나 결제 결과가 정해지기 전)의 취소는{' '}
          <Link className="text-foreground underline underline-offset-4" href={adminOrderPanelHref(orderId, orderNumber)}>주문 통합검색에서 이 주문을 열어</Link>
          {' '}[{orderPanelRecheckLabel}]으로 닫습니다. {PAYMENT_PROVIDER_LABELS.korpay} 결제창 주문은 그 자리의
          [{ADMIN_CANCELLATION_RECHECK_LABELS.preparedKorpay}] 버튼으로 처리합니다.
        </p>
      ) : refundLedgerMissing ? (
        <p className="text-muted-foreground">
          이 주문에는 환불 기록이 없어 완료를 기록할 수 없습니다. 결제 내역을 먼저
          확인해주세요.
        </p>
      ) : null}
  </>;

  const rejectionForm = <>
    {canReject ? (
        <form action={ignoreUnconfirmedClaimSubmit} className={FORM_CLASS} onSubmit={submitRejection}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="reject" />
          <ClaimRejectionReasonField claimType={claimType} error={rejectError} id="claim-reject-note" onChange={() => setRejectError(null)} />
          {/* 승인이 이 칸의 주 행동이다. 거부까지 빨강이면 둘 다 위험 표시로 읽혀 멈칫한다. */}
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">
            거부
          </Button>
        </form>
      ) : null}
  </>;

  /* 지금 할 일이 아닌 거부는 펼쳐서 쓰는 다른 길로 둔다(반품·교환 공통). 입력은 접어도 DOM에 남는다. */
  const rejectionFold = canReject ? <details className="group/reject min-w-0" data-claim-reject-fold="">
    <summary className={`${buttonVariants({ size: 'sm', variant: 'outline' })} cursor-pointer list-none text-destructive [&::-webkit-details-marker]:hidden`} data-slot="button">거부하기<ChevronDown aria-hidden="true" className="transition-transform group-open/reject:rotate-180" /></summary>
    <div className="mt-2 rounded-lg border p-3">{rejectionForm}</div>
  </details> : null;

  if (claimType === 'return') return <>
    <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={feedback} /></div>
    <ReturnClaimWorkspace
    progress={{ stage, heldFrom, collectionPolicy, collectionComplete, collectedAt,
      collectionCount: collections.length, collectedCount: collections.filter(item => item.collectedAt !== null).length,
      refundLedgerOpen, refundFiled, refundCompleted,
      ...(returnDeduction?.applicable ? { refundDeductionAmount: returnDeduction.deductionAmount } : {}) }}
    review={<>
      <div className="flex flex-wrap gap-3"><a className="underline underline-offset-4" href="#claim-order">주문정보 보기</a><a className="underline underline-offset-4" href="#claim-request">요청·처리이력 보기</a></div>
      {stage === 'withdrawn' ? <p>요청 철회로 처리가 종료됐습니다. 주문과 결제는 유지됩니다.</p> : decisionForm}
      {/* 승인과 거부는 둘 중 하나를 고르는 일이다 — 취소·교환 처리 칸과 같이 승인 바로 아래에 둔다. */}
      {canApprove ? rejectionForm : null}
    </>}
    collection={<>{stage === 'withdrawn'
      ? <>
        <p className="text-muted-foreground">철회된 요청의 회수 처리는 종료됐습니다.</p>
        {withdrawnPickups.length ? <ul aria-label="자동 회수 접수 결과" className="flex flex-col gap-1.5 text-sm" data-claim-withdrawn-pickups="">
          {withdrawnPickups.map(({ key, label, pickup }) => <li className="flex flex-wrap items-center gap-x-2 gap-y-1" key={key}>
            <span className="font-medium">{label}</span>
            <AdminStatusBadge tone={statusTone('claimReturnPickup', pickup.state)}>{RETURN_PICKUP_STATE_LABELS[pickup.state]}</AdminStatusBadge>
            {pickup.state === 'canceled' && pickup.cancelReason ? <span>· {RETURN_PICKUP_CANCEL_REASON_LABELS[pickup.cancelReason] ?? '사유 확인 필요'}</span> : null}
            {pickup.trackingNumber ? <span className="text-muted-foreground tabular-nums">· {pickup.carrierLabel ?? pickup.carrier} 회수 운송장 {pickup.trackingNumber}</span> : null}
          </li>)}
        </ul> : null}
      </>
      : <>{originCollection}{legacyCollection}</>}{returnCollectionContact}</>}
    hold={<>{holdControl}{canHold || canResume ? null : <p className="text-muted-foreground">지금 단계에서는 보류할 수 없습니다.</p>}</>}
    refund={<>{stage !== 'withdrawn' ? refundControls : null}{returnRefundSummary}</>}
    exception={canReject && !canApprove ? rejectionFold : null}
    attention={defectiveRetry}
  /></>;

  /* 교환은 '지금 할 일'을 맨 위에 둔다. 승인 전에는 승인이 먼저라 회수 안내를 그 아래로 내리고, 거부는 승인과 나란한 선택이 아니라 펼쳐서 쓰는 다른 길로 둔다. 보류·유형 전환·사유 정정은 필요할 때만 쓰는 일이라 한 줄로 묶는다. */
  if (claimType === 'exchange') {
    return <div className="flex min-w-0 flex-col gap-4" data-claim-actions="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base leading-snug font-medium">{panelTitle}</h3>
        <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">{V.claimStatus} <AdminStatusBadge tone={statusTone('claim', stage)}>{adminClaimStageLabel(claimType, stage)}</AdminStatusBadge></p>
      </div>
      {exchangeSteps}
      <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={feedback} /></div>
      {requestSummary}
      {/* 보류 설정과 해제는 한 부품의 두 상태다. 보류 직후 다시 마운트되면 완료 문구와 포커스가 사라지므로 트리의 자리는 아래 묶음 하나로 두고, 보류 중일 때만 CSS order로 위로 올린다(보류 해제가 지금 할 일이다). */}
      <div className={`flex min-w-0 flex-col gap-4 ${canResume ? 'order-2' : 'order-1'}`}>
        {canApprove ? <>{decisionForm}{rejectionFold}{originCollection}{legacyCollection}{exchangeStock}{refundControls}{exchangeShipping}</> : <>{originCollection}{legacyCollection}{exchangeStock}{refundControls}{exchangeShipping}{rejectionFold}</>}
      </div>
      {canHold || canResume || secondaryActions ? <section aria-label={canResume ? '보류 해제와 그 밖의 처리' : '필요할 때만 쓰는 처리'} className={`flex min-w-0 flex-col gap-2 ${canResume ? 'order-1' : 'order-2 border-t pt-3'}`} data-claim-secondary-actions="">
        <h4 className="text-xs font-medium text-muted-foreground">{canResume ? '보류 중' : '필요할 때만'}</h4>
        <div className="flex min-w-0 flex-wrap items-start gap-2 [&>section]:w-full">{holdControl}{secondaryActions}</div>
      </section> : null}
    </div>;
  }

  return <div className="flex min-w-0 flex-col gap-4" data-claim-actions="">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="text-base leading-snug font-medium">{panelTitle}</h3>
      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">{V.claimStatus} <AdminStatusBadge tone={statusTone('claim', stage)}>{adminClaimStageLabel(claimType, stage)}</AdminStatusBadge></p>
    </div>
    <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={feedback} /></div>
    {requestSummary}
    {/* 승인할 수 있는 단계에서는 거부를 승인 바로 아래에 둔다 — 둘 중 하나를 고르는 것이 지금 할 일이다. */}
    {originCollection}{decisionForm}{canApprove ? rejectionForm : null}{holdControl}{legacyCollection}{refundControls}{canApprove ? null : rejectionForm}
  </div>;
}
