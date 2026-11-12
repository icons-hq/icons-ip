'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState, type ReactNode } from 'react';
import { ADMIN_CANCELLATION_RECHECK_LABELS, adminOrderSearchHref } from '@/lib/admin/orders';
import { adminClaimStageLabel, adminClaimTodayKst } from '@/lib/admin/claims';
import { krw } from '@/lib/format';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_VOCABULARY as V, adminClaimCopy } from '@/lib/admin/vocabulary';
import {
  automatedCancelProviderLabel,
  providerCancelsAutomatically,
} from '@/lib/payments/provider-capabilities';
import {
  decideOrderClaimAction,
  recordOrderClaimCollectionAction,
  planClaimDefectiveStockAction,
  recordOrderClaimRefundAction,
  recordOrderClaimReshipmentAction,
  retryClaimDefectiveStockAction,
  type AdminClaimActionState,
} from '@/app/admin/claim-actions';
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
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import type { AdminClaimCollection, AdminClaimReshipItem } from '@/lib/admin/claims.server';
import {
  returnFeeDeductionBasisLabel,
  returnFeeDeductionHeadline,
  returnFeeDeductionSkippedNotice,
  type ReturnFeeDeduction,
} from '@/lib/claims/return-fee-deduction';
import { krwAmountWords } from '@/lib/format';
import { DEFECTIVE_STOCK_PENDING_NOTICE, type ClaimDefectiveStock } from '@/lib/admin/defective-stock';
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
import { adminConfirm } from '@/lib/admin/confirm';

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
  reship: recordOrderClaimReshipmentAction,
  defectivePlan: planClaimDefectiveStockAction,
  defectiveRetry: retryClaimDefectiveStockAction,
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

/**
 * 되돌릴 수 없는 처리의 확인(2026-10-12 브라우저 QA QA-6).
 *
 * 취소 승인과 환불 완료 확정은 누르는 순간 결제사 전액 취소·주문 취소·재고 복원까지
 * 간다. 주문 콘솔의 청약철회 승인·운영자 전액 취소처럼 확인을 거친다. 문구는 누른 버튼의
 * data-confirm이 먼저고, 없으면 양식의 data-confirm이다 — 한 양식의 [검토중으로 표시]는
 * 묻지 않고 [승인…]만 묻는다.
 *
 * 양식의 기본 제출은 늘 막고, 보낼지만 돌려준다. 보내는 쪽은 transition으로 직접 보낸다 —
 * 양식 action 자리는 비워 둔다(ignoreUnconfirmedClaimSubmit).
 */
export async function confirmClaimPanelSubmit(
  event: React.FormEvent<HTMLFormElement>,
  confirm: (message: string) => boolean | Promise<boolean> = adminConfirm,
): Promise<boolean> {
  event.preventDefault();
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  const message = submitter?.getAttribute('data-confirm') ?? event.currentTarget.getAttribute('data-confirm');
  return !message || (await confirm(message));
}

/*
 * 확인이 필요한 양식의 React action 자리. 아무것도 보내지 않는다. 하이드레이션 전에 눌린
 * 제출은 React가 담아 두었다가 이 action으로 재생하는데, 그 경로는 확인 창을 거치지 않는다 —
 * 결제사 전액 취소가 확인 없이 나가지 않도록 버린다. 운영자는 화면이 준비된 뒤 다시 누른다.
 */
function ignoreUnconfirmedClaimSubmit() {}

/** 취소 승인 확인 문구. 결제마다 승인 뒤 일어나는 일이 다르다. */
export function claimCancelApprovalConfirmation(paymentProvider: string | null) {
  if (providerCancelsAutomatically(paymentProvider)) {
    return `취소를 승인하고 ${automatedCancelProviderLabel(paymentProvider)} 결제 전액을 취소할까요? 되돌릴 수 없고, 취소가 확인되면 주문 취소·재고 복원·카드팩 회수까지 함께 끝납니다.`;
  }
  if (paymentProvider === 'korpay') return '취소를 승인할까요? 승인 뒤 Korpay 취소 접수와 환불 완료 확정으로 진행합니다.';
  if (paymentProvider === 'bank_transfer') return '취소를 승인할까요? 승인 뒤 환불계좌 송금 절차로 진행합니다.';
  return '취소를 승인할까요? 결제 전 주문은 바로 주문이 취소되고 되돌릴 수 없습니다.';
}

/**
 * 환불 완료 기록 확인 문구. 아직 종결되지 않은 클레임은 정합화(토스·나이스페이면 전액 취소
 * 발행)가 먼저 돈다. autoCancelLabel은 취소 API로 자동 취소되는 결제사 이름이고, 아니면 null이다.
 */
export function claimRefundCompletionConfirmation(
  finalizationPending: boolean,
  autoCancelLabel: string | null,
  /** 반품배송비를 뺀 부분 취소(ADR-0031). 없으면 지금 문구 그대로다. */
  partialRefund: { refundAmount: number; deductionAmount: number } | null = null,
) {
  if (!finalizationPending) return '환불 완료를 원장에 기록할까요?';
  if (autoCancelLabel && partialRefund) {
    return `${autoCancelLabel} 결제에서 반품배송비 ${krwAmountWords(partialRefund.deductionAmount)}을 뺀 ${krwAmountWords(partialRefund.refundAmount)}을 부분 취소하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.`;
  }
  return autoCancelLabel
    ? `${autoCancelLabel} 결제 전액을 취소하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.`
    : '결제사 원장에서 전액 취소를 확인했나요? 확정하면 주문 취소·재고 복원·카드팩 회수가 진행되고 되돌릴 수 없습니다.';
}

function Feedback({ state }: { state: AdminClaimActionState }) {
  return (
    <>
      {state.error ? (
        <AdminNotice role="alert" tone="danger">{adminClaimCopy(state.error)}</AdminNotice>
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
  cancelScope?: '전액 취소' | '부분 취소';
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

/** 상계·정산 메모. 환불 접수와 완료 확정 양식이 같은 칸을 쓴다. */
function SettlementNoteField({ id, placeholder }: { id: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>상계·정산 메모 (선택)</Label>
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
  carriers: ShippingCarrierRegistry;
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
  reshipItems?: AdminClaimReshipItem[];
  collectionPolicy: 'origin' | 'legacy' | null;
  collectionComplete: boolean;
  collectedAt?: string | null;
  returnCollectionContact?: ReactNode;
  returnRefundSummary?: ReactNode;
  collections: AdminClaimCollection[];
  /** 돈이 나가는 버튼 옆에 적는 금액. 환불 원장 금액, 없으면 차감 판정의 환불액, 그것도 없으면 주문 금액이다. 표시 전용이다. */
  refundAmount?: number | null;
  /** 반품배송비 차감 판정·결정(ADR-0031). 스위치가 꺼져 있고 결정이 없으면 null — 패널은 지금 그대로다. */
  refundDeduction?: ReturnFeeDeduction | null;
  /** 반품 품목별 재고 처리 선택(QNA-035). 반품이 아니거나 읽지 못하면 null — 선택 칸을 그리지 않고 지금처럼 전부 복원한다. */
  defectiveStock?: ClaimDefectiveStock | null;
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
  collectedAt = null,
  returnCollectionContact,
  returnRefundSummary,
  refundAmount = null,
  refundDeduction = null,
  defectiveStock = null,
  requestSummary = null,
  exchangeSteps = null,
  exchangeShipping = null,
  secondaryActions = null,
}: ClaimActionPanelProps) {
  const [result, panelAction, pending] = useActionState(runClaimPanelAction, EMPTY_STATE);
  /* 목록 위 팝업(R8)에서는 결제사 취소·환불 완료 확정을 기다리는 동안 팝업이 닫히지 않게 한다. */
  useClaimPreviewBusy(pending);
  const [formCopied, setFormCopied] = useState(false);
  /* 레거시 회수 확인의 실제 입고일 기본값·상한(KST 오늘). */
  const [today] = useState(() => adminClaimTodayKst());
  /* 확인을 통과한 제출만 보낸다. 누른 버튼의 name·value(결정)를 함께 싣는다. */
  const submitConfirmed = async (event: React.FormEvent<HTMLFormElement>) => {
    /* 확인창을 기다리는 사이 이벤트가 비워지므로 보낼 값은 누른 시점에 담아 둔다. */
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter ?? null);
    if (!(await confirmClaimPanelSubmit(event))) return;
    startTransition(() => panelAction(formData));
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
    && collectionReady
    && (stage === 'collected' || stage === 'processing');
  /* 완료를 적을 수 있는지는 단계가 아니라 원장이 정한다. 레거시 경로로 종결된
     클레임은 stage가 completed여도 refunds.completed_at이 비어 있고, 반대로 원장
     행이 아예 없는 주문에는 적을 대상이 없다(RPC가 claim_refund_ledger_missing으로
     막는다). 단계만 보면 "누르면 반드시 실패하는 버튼"이 생긴다. */
  const refundStageReached = stage === 'processing'
    || stage === 'needs_review'
    || stage === 'completed';
  const canCompleteRefund = claimType !== 'exchange'
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
  /* 수단은 원장 기록 → 결제 provider 순으로 정해진다. 정해지지 않은 결제(Korpay)만
     운영자가 고른다. 서버 액션이 같은 규칙으로 다시 검사한다. */
  const fixedRefundMethod = recordedRefundMethod ?? orderClaimRefundMethodForProvider(paymentProvider);
  const panelTitle = `${ORDER_CLAIM_TYPE_LABELS[claimType]} 처리`;
  const amountAtStake = refundAmount === null ? null : krw(refundAmount);
  /* 반품배송비를 빼고 결제사 부분 취소로 돌려주는 반품(ADR-0031). 판정·결정이 없으면 지금처럼 전액 취소다. */
  const returnDeduction = claimType === 'return' ? refundDeduction : null;
  const partialRefund = returnDeduction?.applicable && returnDeduction.refundAmount !== null && autoCancelLabel
    ? { refundAmount: returnDeduction.refundAmount, deductionAmount: returnDeduction.deductionAmount }
    : null;
  const cancelScope = partialRefund ? '부분 취소' : '전액 취소';
  const deductionHeadline = returnFeeDeductionHeadline(returnDeduction);
  const deductionSkipped = returnFeeDeductionSkippedNotice(returnDeduction);
  const deductionNotice = returnDeduction && (deductionHeadline || deductionSkipped) && stage !== 'completed' ? (
    deductionHeadline ? (
      <div data-claim-refund-deduction="deduct"><AdminNotice title={deductionHeadline} tone="info">
        {`단순 변심 반품이라 결제 금액 ${krwAmountWords(returnDeduction.paymentAmount ?? 0)}에서 반품배송비(${returnFeeDeductionBasisLabel(returnDeduction)})를 빼고 환불합니다.`}
        {returnDeduction.source === 'plan' ? ' 환불 접수를 기록할 때 이 금액으로 정해집니다.' : ''}
        {autoCancelLabel
          ? ` [환불 완료 확정]을 누르면 ${autoCancelLabel} 부분 취소로 환불액만 취소합니다. 결제사가 이 결제의 부분 취소를 받지 않으면 전액 환불하고, 반품배송비는 배송비 청구로 따로 받습니다.`
          : ''}
      </AdminNotice></div>
    ) : (
      <div data-claim-refund-deduction="skipped"><AdminNotice tone="warning">{deductionSkipped}</AdminNotice></div>
    )
  ) : null;
  if (stage === 'withdrawn' && claimType !== 'return') return <div className="flex flex-col gap-2"><h3 className="text-base font-medium">{panelTitle}</h3><p>요청 철회로 처리가 종료됐습니다. 주문과 결제는 유지됩니다.</p>{secondaryActions ? <div className="flex min-w-0 flex-wrap items-start gap-2 [&>section]:w-full">{secondaryActions}</div> : null}</div>;

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
          collection={collection} canRecord={canRecordOrigin || (originCollectionOpen && collection.collectionWaived === true)} />)
          : <p className="text-muted-foreground">수거를 승인하면 출고지별 반송 주소와 상품이 표시됩니다.</p>}
      </section> : collectionPolicy === null ? <p className="text-destructive" role="alert">회수 확인 기준을 불러오지 못했습니다. 새로고침한 뒤 다시 확인해주세요.</p> : null}
  </>;

  const decisionForm = <>
    {canReview || canApprove ? (
        <form action={ignoreUnconfirmedClaimSubmit} className={FORM_CLASS} onSubmit={submitConfirmed}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          {/* 누르기 전에 읽도록 버튼 위에 둔다. 돈이 바로 나가는 승인만 경고 상자를 쓴다. */}
          {approvalMovesMoney ? (
            <AdminNotice title="승인하면 되돌릴 수 없습니다" tone="warning">
              {`승인하면 바로 ${autoCancelLabel} 결제 전액을 취소하고 결제사에 결과를 확인합니다. 취소가 확인되면 주문 취소·재고 복원·카드팩 회수까지 함께 끝납니다.`}
            </AdminNotice>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {approvalMovesMoney ? <MoneyAtStake amount={amountAtStake} label="취소 금액" /> : null}
            {canApprove ? (
              <Button
                data-confirm={claimType === 'cancel' ? claimCancelApprovalConfirmation(paymentProvider) : undefined}
                disabled={pending}
                name="decision"
                type="submit"
                value="approve"
                variant={approvalMovesMoney ? 'danger' : 'default'}
              >
                {claimType !== 'cancel'
                  ? '승인하고 수거 시작'
                  : autoCancelLabel ? `승인하고 ${autoCancelLabel} 전액 취소` : '승인하고 환불 처리 시작'}
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
                ? 'Korpay 결제는 승인 뒤 결제사 취소 접수 양식으로 접수하고 환불 완료를 확정합니다.'
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
            환급 기한(영업일 3일)은 확인 버튼을 누른 때가 아니라 실제 입고일부터 셉니다.
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
            Korpay 취소는 API가 아니라 이메일 접수입니다. 아래 본문을 그대로 보낸 뒤
            [접수 완료]를 눌러 원장에 남겨주세요.
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

      {bankTransfer && claimType === 'return' && defectiveStock && !defectiveStock.frozen && stage !== 'completed' && stage !== 'withdrawn' && stage !== 'rejected'
        && defectiveStock.items.some((item) => item.state !== 'recorded') ? (
        <form action={panelAction} className={FORM_CLASS}>
          <PanelActionField kind="defectivePlan" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <ClaimDefectiveStockChoice idPrefix="claim-bank-stock-disposition" items={defectiveStock.items} />
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">품목별 재고 처리 저장</Button>
          <p className={HINT_CLASS}>무통장 환불은 위 [취소 확정]을 누를 때 재고가 복원되고 불량 재고도 함께 기록됩니다. 그 전에 저장해주세요.</p>
        </form>
      ) : null}

      {claimType === 'return' && defectiveStock && defectiveStock.pending > 0 && defectiveStock.frozen ? (
        <form action={panelAction} className={FORM_CLASS} data-claim-defective-pending="">
          <PanelActionField kind="defectiveRetry" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <AdminNotice title="불량 기록 필요" tone="warning">{DEFECTIVE_STOCK_PENDING_NOTICE}</AdminNotice>
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">불량 기록 다시 시도</Button>
        </form>
      ) : null}

      {canFileRefund && !bankTransfer ? (
        <form action={panelAction} className={FORM_CLASS}>
          <PanelActionField kind="refund" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="filed" />
          <RefundMethodField fixedMethod={fixedRefundMethod} id="claim-refund-method" autoCancelLabel={autoCancelLabel} cancelScope={cancelScope} />
          <SettlementNoteField id="claim-refund-note" placeholder="예: 정산 완료분이라 코페이 상계 처리" />
          <Button className="w-fit" disabled={pending} size="sm" type="submit" variant={refundFiled ? 'outline' : 'default'}>
            {refundFiled ? '환불 접수 정보 갱신' : '환불 접수 완료로 기록'}
          </Button>
          {autoCancelLabel ? (
            <p className={HINT_CLASS}>
              접수만 원장에 기록합니다. {autoCancelLabel} {cancelScope}는 아래 [환불 완료 확정]을 누를 때 발행됩니다.
            </p>
          ) : null}
        </form>
      ) : null}

      {canCompleteRefund && !bankTransfer ? (
        <form
          action={ignoreUnconfirmedClaimSubmit}
          className={FORM_CLASS}
          data-confirm={claimRefundCompletionConfirmation(refundFinalizationPending, autoCancelLabel, partialRefund)}
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
              {autoCancelLabel && partialRefund
                ? `누르면 ${autoCancelLabel} 결제에서 반품배송비 ${krwAmountWords(partialRefund.deductionAmount)}을 뺀 ${krwAmountWords(partialRefund.refundAmount)}만 부분 취소하고 결제사 잔액을 조회로 확인합니다. 이미 취소된 금액이면 확인만 합니다. 확인되지 않으면 주문과 재고는 그대로 두고 결제확인필요로 남습니다.`
                : autoCancelLabel
                ? `누르면 ${autoCancelLabel} 결제 전액을 취소하고 결제사에 결과를 확인합니다. 이미 취소된 결제면 확인만 합니다. 확인되지 않으면 주문과 재고는 그대로 두고 결제확인필요로 남습니다.`
                : '결제사 원장에서 전액 취소를 확인한 뒤 눌러주세요. 확인되지 않으면 주문과 재고는 그대로 유지됩니다.'}
            </AdminNotice>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {refundFinalizationPending ? <MoneyAtStake amount={amountAtStake} label="환불 금액" /> : null}
            <Button className="h-auto min-h-7 w-fit max-w-full py-1 whitespace-normal" disabled={pending} size="sm" type="submit" variant={refundFinalizationPending ? 'danger' : 'default'}>
              {!refundFinalizationPending
                ? '환불 완료를 원장에 기록'
                : autoCancelLabel
                  ? `환불 완료 확정 (${autoCancelLabel} ${cancelScope})`
                  : '환불 완료 확정 (재고 복원 · 카드팩 회수 포함)'}
            </Button>
          </div>
          {!refundFinalizationPending ? (
            <p className={HINT_CLASS}>
              {`이 ${V.claimRequest}은 이미 종결됐습니다. 주문 취소·재고 복원·카드팩 회수는 끝났고, 여기서는 환불 완료 기록만 남깁니다.`}
            </p>
          ) : null}
        </form>
      ) : null}

      {refundLedgerMissing && orderPanelRecheckLabel ? (
        <p className="text-muted-foreground">
          이 주문에는 환불 기록이 없어 [환불 완료 확정]을 쓸 수 없습니다. 결제 내역이
          없는 주문(결제창만 열렸거나 결제 결과가 정해지기 전)의 취소는{' '}
          <Link className="text-foreground underline underline-offset-4" href={adminOrderSearchHref(orderId)}>주문 통합검색에서 이 주문을 열어</Link>
          {' '}[{orderPanelRecheckLabel}]으로 닫습니다. Korpay 결제창 주문은 그 자리의
          Korpay 버튼으로 처리합니다.
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
        <form action={panelAction} className={FORM_CLASS}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="reject" />
          <ClaimRejectionReasonField claimType={claimType} id="claim-reject-note" label="거부 사유 (10~200자, 구매자에게 전달됩니다)" />
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
    <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={result} /></div>
    <ReturnClaimWorkspace
    progress={{ stage, heldFrom, collectionPolicy, collectionComplete, collectedAt,
      collectionCount: collections.length, collectedCount: collections.filter(item => item.collectedAt !== null).length,
      refundLedgerOpen, refundFiled, refundCompleted,
      ...(returnDeduction?.applicable ? { refundDeductionAmount: returnDeduction.deductionAmount } : {}) }}
    review={<>
      <p>주문 전체의 상품·금액과 반품 사유를 먼저 확인해주세요.</p>
      <div className="flex flex-wrap gap-3"><a className="underline underline-offset-4" href="#claim-order">주문정보 보기</a><a className="underline underline-offset-4" href="#claim-request">요청·처리이력 보기</a></div>
      {stage === 'withdrawn' ? <p>요청 철회로 처리가 종료됐습니다. 주문과 결제는 유지됩니다.</p> : decisionForm}
      {/* 승인과 거부는 둘 중 하나를 고르는 일이다 — 취소·교환 처리 칸과 같이 승인 바로 아래에 둔다. */}
      {canApprove ? rejectionForm : null}
    </>}
    collection={<>{stage === 'withdrawn'
      ? <p className="text-muted-foreground">철회된 요청의 회수 처리는 종료됐습니다.</p>
      : <>{originCollection}{legacyCollection}</>}{returnCollectionContact}</>}
    hold={<>{holdControl}<p className="text-muted-foreground">{stage === 'withdrawn' || stage === 'rejected' || stage === 'completed'
      ? '종결된 요청은 보류하거나 보류를 해제할 수 없습니다.' : canResume
      ? '보류를 해제한 뒤 돌아온 단계에서 회수·환불을 별도로 확인해주세요.'
      : '추가 확인이 필요한 경우에만 보류합니다. 보류할 사유가 없으면 다음 작업을 진행하세요.'}</p></>}
    refund={<>{stage !== 'withdrawn' ? refundControls : null}{returnRefundSummary}</>}
    exception={canReject && !canApprove ? rejectionFold : null}
  /></>;

  /* 교환은 '지금 할 일'을 맨 위에 둔다. 승인 전에는 승인이 먼저라 회수 안내를 그 아래로 내리고, 거부는 승인과 나란한 선택이 아니라 펼쳐서 쓰는 다른 길로 둔다. 보류·유형 전환·사유 정정은 필요할 때만 쓰는 일이라 한 줄로 묶는다. */
  if (claimType === 'exchange') {
    return <div className="flex min-w-0 flex-col gap-4" data-claim-actions="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base leading-snug font-medium">{panelTitle}</h3>
        <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">현재 단계 <AdminStatusBadge tone={statusTone('claim', stage)}>{adminClaimStageLabel(claimType, stage)}</AdminStatusBadge></p>
      </div>
      {exchangeSteps}
      <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={result} /></div>
      {requestSummary}
      {/* 보류 설정과 해제는 한 부품의 두 상태다. 보류 직후 다시 마운트되면 완료 문구와 포커스가 사라지므로 트리의 자리는 아래 묶음 하나로 두고, 보류 중일 때만 CSS order로 위로 올린다(보류 해제가 지금 할 일이다). */}
      <div className={`flex min-w-0 flex-col gap-4 ${canResume ? 'order-2' : 'order-1'}`}>
        {canApprove ? <>{decisionForm}{rejectionFold}{originCollection}{legacyCollection}{refundControls}{exchangeShipping}</> : <>{originCollection}{legacyCollection}{refundControls}{exchangeShipping}{rejectionFold}</>}
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
      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">현재 단계 <AdminStatusBadge tone={statusTone('claim', stage)}>{adminClaimStageLabel(claimType, stage)}</AdminStatusBadge></p>
    </div>
    <div aria-live="polite" className="flex flex-col gap-1" data-claim-action-result=""><Feedback state={result} /></div>
    {requestSummary}
    {/* 승인할 수 있는 단계에서는 거부를 승인 바로 아래에 둔다 — 둘 중 하나를 고르는 것이 지금 할 일이다. */}
    {originCollection}{decisionForm}{canApprove ? rejectionForm : null}{holdControl}{legacyCollection}{refundControls}{canApprove ? null : rejectionForm}
  </div>;
}
