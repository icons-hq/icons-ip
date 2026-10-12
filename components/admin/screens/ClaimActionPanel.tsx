'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ADMIN_CANCELLATION_RECHECK_LABELS, adminOrderSearchHref } from '@/lib/admin/orders';
import { ADMIN_VOCABULARY as V, adminClaimCopy } from '@/lib/admin/vocabulary';
import {
  decideOrderClaimAction,
  recordOrderClaimCollectionAction,
  recordOrderClaimRefundAction,
  recordOrderClaimReshipmentAction,
  type AdminClaimActionState,
} from '@/app/admin/claim-actions';
import {
  ORDER_CLAIM_REFUND_METHOD_LABELS,
  ORDER_CLAIM_REFUND_METHODS,
  ORDER_CLAIM_STAGE_LABELS,
  canRejectOrderClaim,
  orderClaimNextStages,
  orderClaimRefundMethodForProvider,
  type OrderClaimRefundMethod,
  type OrderClaimStage,
  type OrderClaimType,
} from '@/lib/orders/claims';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import type { AdminClaimCollection, AdminClaimReshipItem } from '@/lib/admin/claims.server';
import { ClaimOriginCollection } from './ClaimOriginCollection';

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
 * 토스 결제는 취소 승인과 [환불 완료 확정]이 토스 전액 취소를 직접 발행한다
 * (2026-10-12 점검 REF-2). 운영자가 결제사 원장에서 취소를 먼저 확인하는 순서가
 * 아니다. 환불 수단도 결제가 정한다 — 토스는 결제사 취소뿐이라 선택지를 그리지
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
 * 묻지 않고 [승인…]만 묻는다. 취소하면 양식 action이 실행되지 않는다.
 */
export function confirmClaimPanelSubmit(
  event: React.FormEvent<HTMLFormElement>,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
) {
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  const message = submitter?.getAttribute('data-confirm') ?? event.currentTarget.getAttribute('data-confirm');
  if (message && !confirm(message)) event.preventDefault();
}

/** 취소 승인 확인 문구. 결제마다 승인 뒤 일어나는 일이 다르다. */
export function claimCancelApprovalConfirmation(paymentProvider: string | null) {
  if (paymentProvider === 'toss') {
    return '취소를 승인하고 토스 전액 취소를 발행할까요? 되돌릴 수 없고, 확인되면 주문 취소·재고 복원·카드팩 회수와 환불 원장 기록이 함께 끝납니다.';
  }
  if (paymentProvider === 'korpay') return '취소를 승인할까요? 승인 뒤 Korpay 취소 접수와 환불 완료 확정으로 진행합니다.';
  if (paymentProvider === 'bank_transfer') return '취소를 승인할까요? 승인 뒤 환불계좌 송금 절차로 진행합니다.';
  return '취소를 승인할까요? 결제 전 주문은 바로 주문이 취소되고 되돌릴 수 없습니다.';
}

/** 환불 완료 기록 확인 문구. 아직 종결되지 않은 클레임은 정합화(토스면 전액 취소 발행)가 먼저 돈다. */
export function claimRefundCompletionConfirmation(finalizationPending: boolean, tossPayment: boolean) {
  if (!finalizationPending) return '환불 완료를 원장에 기록할까요?';
  return tossPayment
    ? '토스 전액 취소를 발행하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.'
    : '결제사 원장에서 전액 취소를 확인했나요? 확정하면 주문 취소·재고 복원·카드팩 회수가 진행되고 되돌릴 수 없습니다.';
}

function Feedback({ state }: { state: AdminClaimActionState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" style={{ fontSize: 12.5, margin: '6px 0 0' }}>{adminClaimCopy(state.error)}</p>
      ) : null}
      {state.message ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
          {adminClaimCopy(state.message)}
        </p>
      ) : null}
    </>
  );
}

/** 환불 수단 입력. 결제가 정한 수단이 있으면 고르지 않고 그 값을 그대로 보낸다. */
function RefundMethodField({
  fixedMethod,
  id,
  tossPayment,
}: {
  fixedMethod: OrderClaimRefundMethod | null;
  id: string;
  tossPayment: boolean;
}) {
  if (fixedMethod) {
    return (
      <p style={{ fontSize: 13, margin: 0 }}>
        <input name="method" type="hidden" value={fixedMethod} />
        <span className="muted">환불 수단 · </span>
        {fixedMethod === 'pg_cancel' && tossPayment
          ? '결제사 취소 (토스 전액 취소)'
          : ORDER_CLAIM_REFUND_METHOD_LABELS[fixedMethod]}
      </p>
    );
  }
  return (
    <label htmlFor={id}>
      <span>환불 수단</span>
      <select defaultValue="pg_cancel" id={id} name="method">
        {ORDER_CLAIM_REFUND_METHODS.map((method) => (
          <option key={method} value={method}>
            {ORDER_CLAIM_REFUND_METHOD_LABELS[method]}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface ClaimActionPanelProps {
  claimId: string;
  claimType: OrderClaimType;
  orderId: string;
  stage: OrderClaimStage;
  carriers: ShippingCarrierRegistry;
  /** 보류 해제 시 돌아갈 단계. 거부 가능 여부가 여기서 갈린다. */
  heldFrom: OrderClaimStage | null;
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
  collections: AdminClaimCollection[];
}

export function ClaimActionPanel({
  cancellationForm,
  carriers,
  claimId,
  claimType,
  heldFrom,
  orderId,
  refundCompleted,
  refundFiled,
  refundLedgerOpen,
  stage,
  paymentProvider,
  recordedRefundMethod,
  reshipItems = [],
  collectionPolicy,
  collectionComplete,
  collections,
}: ClaimActionPanelProps) {
  const [result, panelAction, pending] = useActionState(runClaimPanelAction, EMPTY_STATE);
  const [formCopied, setFormCopied] = useState(false);

  const next = orderClaimNextStages(claimType, stage);
  const canApprove = stage === 'requested' || stage === 'in_review';
  const canReview = stage === 'requested';
  const canHold = next.includes('on_hold');
  const canResume = stage === 'on_hold';
  const canReject = canRejectOrderClaim(stage, heldFrom);
  const collectionReady = collectionPolicy !== null && collectionComplete;
  const canRecordOrigin = collectionPolicy === 'origin'
    && !collectionComplete && ['collecting', 'collected', 'processing', 'needs_review'].includes(stage);
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
  const tossPayment = paymentProvider === 'toss';
  /* 수단은 원장 기록 → 결제 provider 순으로 정해진다. 정해지지 않은 결제(Korpay)만
     운영자가 고른다. 서버 액션이 같은 규칙으로 다시 검사한다. */
  const fixedRefundMethod = recordedRefundMethod ?? orderClaimRefundMethodForProvider(paymentProvider);
  const canReship = claimType === 'exchange' && stage === 'collected' && collectionReady;

  return (
    <div className="admin-claim-actions">
      <h3 style={{ margin: 0 }}>처리</h3>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        현재 단계: {ORDER_CLAIM_STAGE_LABELS[stage]}
      </p>
      <div aria-live="polite" className="admin-claim-action-result">
        <Feedback state={result} />
      </div>

      {/* 회수가 없는 취소에는 회수 안내를 그리지 않는다(QA-9). 승인 버튼 옆의 "수거를
          승인하면…"은 사실이 아니다 — 취소 승인은 결제 취소로 간다. 회수 대상이 기록된
          예전 취소(발주확인 뒤 접수된 레거시 건)만 그린다. */}
      {collectionPolicy === 'origin' && (claimType !== 'cancel' || collections.length > 0) ? <section aria-label="출고지별 회수 확인">
        <h4 style={{ margin: '8px 0' }}>출고지별 회수 확인</h4>
        <p style={{ fontSize: 13 }}>{collectionComplete
          ? '모든 출고지의 회수를 확인했습니다.'
          : '모든 출고지의 상품과 수량을 회수 확인한 뒤 환불·재출고를 진행합니다.'}</p>
        {collections.length ? collections.map((collection) => <ClaimOriginCollection
          key={collection.shipmentId} claimId={claimId} claimType={claimType}
          collection={collection} canRecord={canRecordOrigin} />)
          : <p className="muted">수거를 승인하면 출고지별 반송 주소와 상품이 표시됩니다.</p>}
      </section> : collectionPolicy === null ? <p role="alert">회수 확인 기준을 불러오지 못했습니다. 새로고침한 뒤 다시 확인해주세요.</p> : null}

      {canReview || canApprove ? (
        <form action={panelAction} onSubmit={(event) => confirmClaimPanelSubmit(event)}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <div className="row" style={{ gap: 8 }}>
            {canReview ? (
              <button
                className="btn btn-sm btn-ghost"
                disabled={pending}
                name="decision"
                type="submit"
                value="review"
              >
                검토중으로 표시
              </button>
            ) : null}
            {canApprove ? (
              <button
                className="btn btn-sm"
                data-confirm={claimType === 'cancel' ? claimCancelApprovalConfirmation(paymentProvider) : undefined}
                disabled={pending}
                name="decision"
                type="submit"
                value="approve"
              >
                {claimType !== 'cancel'
                  ? '승인하고 수거 시작'
                  : tossPayment ? '승인하고 토스 전액 취소' : '승인하고 환불 처리 시작'}
              </button>
            ) : null}
          </div>
          {canApprove && claimType === 'cancel' ? (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              {tossPayment
                ? '승인하면 바로 토스 전액 취소를 발행하고 결제사 조회로 결과를 확인합니다. 확인되면 주문 취소·재고 복원·카드팩 회수와 환불 원장 기록이 함께 끝납니다.'
                : paymentProvider === 'korpay'
                  ? 'Korpay 결제는 승인 뒤 결제사 취소 접수 양식으로 접수하고 환불 완료를 확정합니다.'
                  : paymentProvider === 'bank_transfer'
                    ? '무통장 입금 결제는 승인 뒤 환불계좌 송금 절차로 진행합니다.'
                    : '결제 전 주문은 승인하면 결제사 취소 없이 주문을 취소합니다.'}
            </p>
          ) : null}
        </form>
      ) : null}

      {canResume ? (
        <form action={panelAction}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="resume" />
          <button className="btn btn-sm" disabled={pending} type="submit">
            보류 해제
          </button>
        </form>
      ) : null}

      {canCollect ? (
        <form action={panelAction}>
          <PanelActionField kind="collection" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="stage" type="hidden" value="collected" />
          <button className="btn btn-sm" disabled={pending} type="submit">
            반송 {V.goods} 입고 확인
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            입고 확인 시점부터 환급 SLA(영업일 3일)가 시작됩니다.
          </p>
        </form>
      ) : null}

      {cancellationForm && collectionReady ? (
        <section aria-labelledby="claim-cancellation-form-heading">
          <h4 id="claim-cancellation-form-heading" style={{ margin: '0 0 6px' }}>
            결제사 취소 접수 양식
          </h4>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
            Korpay 취소는 API가 아니라 이메일 접수입니다. 아래 본문을 그대로 보낸 뒤
            [접수 완료]를 눌러 원장에 남겨주세요.
          </p>
          <textarea
            aria-label="결제사 취소 접수 양식"
            readOnly
            rows={9}
            style={{ width: '100%' }}
            value={cancellationForm}
          />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(cancellationForm).then(
                () => setFormCopied(true),
                () => setFormCopied(false),
              );
            }}
            type="button"
          >
            {formCopied ? '복사했습니다' : '양식 복사'}
          </button>
        </section>
      ) : null}

      {canFileRefund ? (
        <form action={panelAction}>
          <PanelActionField kind="refund" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="filed" />
          <RefundMethodField fixedMethod={fixedRefundMethod} id="claim-refund-method" tossPayment={tossPayment} />
          <label htmlFor="claim-refund-note">
            <span>상계·정산 메모 (선택)</span>
            <input
              id="claim-refund-note"
              maxLength={300}
              name="note"
              placeholder="예: 정산 완료분이라 코페이 상계 처리"
              type="text"
            />
          </label>
          <button className="btn btn-sm" disabled={pending} type="submit">
            {refundFiled ? '환불 접수 정보 갱신' : '환불 접수 완료로 기록'}
          </button>
          {tossPayment ? (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              접수만 원장에 기록합니다. 토스 전액 취소는 아래 [환불 완료 확정]을 누를 때 발행됩니다.
            </p>
          ) : null}
        </form>
      ) : null}

      {canCompleteRefund ? (
        <form
          action={panelAction}
          data-confirm={claimRefundCompletionConfirmation(refundFinalizationPending, tossPayment)}
          onSubmit={(event) => confirmClaimPanelSubmit(event)}
        >
          <PanelActionField kind="refund" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="completed" />
          <RefundMethodField fixedMethod={fixedRefundMethod} id="claim-refund-complete-method" tossPayment={tossPayment} />
          <label htmlFor="claim-refund-complete-note">
            <span>상계·정산 메모 (선택)</span>
            <input id="claim-refund-complete-note" maxLength={300} name="note" type="text" />
          </label>
          <button className="btn btn-sm" disabled={pending} type="submit">
            {!refundFinalizationPending
              ? '환불 완료를 원장에 기록'
              : tossPayment
                ? '환불 완료 확정 (토스 전액 취소 발행 · 재고 복원 · 카드팩 회수)'
                : '환불 완료 확정 (재고 복원 · 카드팩 회수 포함)'}
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {!refundFinalizationPending
              ? `이 ${V.claimRequest}은 이미 종결됐습니다. 주문 취소·재고 복원·카드팩 회수는 끝났고, 여기서는 환불 원장에 완료 기록만 남깁니다.`
              : tossPayment
                ? '누르면 토스 전액 취소를 발행하고 결제사 조회로 결과를 확인합니다. 이미 취소된 결제면 확인만 합니다. 확인되지 않으면 주문과 재고는 그대로 유지되고 정합화 오류가 남습니다.'
                : '결제사 원장에서 전액 취소를 확인한 뒤 눌러주세요. 확인되지 않으면 주문과 재고는 그대로 유지됩니다.'}
          </p>
        </form>
      ) : null}

      {refundLedgerMissing && orderPanelRecheckLabel ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          이 주문에는 환불 원장이 없어 [환불 완료 확정]을 쓸 수 없습니다. 결제 내역이
          없는 주문(결제창만 열렸거나 결제 결과가 정해지기 전)의 취소는{' '}
          <Link href={adminOrderSearchHref(orderId)}>주문 통합검색에서 이 주문을 열어</Link>
          {' '}[{orderPanelRecheckLabel}]으로 닫습니다. Korpay 결제창 주문은 그 자리의
          Korpay 버튼으로 처리합니다.
        </p>
      ) : refundLedgerMissing ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          이 주문에는 환불 원장이 없어 완료를 기록할 수 없습니다. 결제 내역을 먼저
          확인해주세요.
        </p>
      ) : null}

      {canReship ? (
        <form action={panelAction}>
          <PanelActionField kind="reship" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value="exchange" />
          {reshipItems.map((item) => <label key={item.id} htmlFor={`claim-variant-${item.id}`}>
            <span>{item.name} · {item.qty}개 재출고 옵션</span>
            <select id={`claim-variant-${item.id}`} name={`variant:${item.id}`} defaultValue={item.currentVariantId} disabled={pending} required>
              {item.options.map((option) => <option key={option.id} value={option.id}>
                {option.name} · {option.code} · 재고 {option.stockQty}개
              </option>)}
            </select>
          </label>)}
          <label htmlFor="claim-reship-carrier">
            <span>택배사</span>
            <select id="claim-reship-carrier" name="carrier">
              {carriers.filter((carrier) => carrier.active).map((carrier) => (
                <option key={carrier.code} value={carrier.code}>{carrier.label}</option>
              ))}
            </select>
          </label>
          <label htmlFor="claim-reship-tracking">
            <span>재출고 운송장번호</span>
            <input
              id="claim-reship-tracking"
              maxLength={30}
              name="trackingNumber"
              placeholder="영문 대문자와 숫자 8~30자"
              type="text"
            />
          </label>
          <button className="btn btn-sm" disabled={pending} type="submit">
            재출고 등록하고 교환 종결
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            회수한 옵션 재고를 되돌리고 선택한 옵션으로 주문 수량 전체를 재출고합니다. 결제 금액과 카드팩은 유지합니다.
          </p>
        </form>
      ) : null}

      {canHold ? (
        <form action={panelAction}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="hold" />
          <label htmlFor="claim-hold-note">
            <span>보류 사유 (10~200자, 구매자에게 전달됩니다)</span>
            <input id="claim-hold-note" maxLength={200} name="note" type="text" />
          </label>
          <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
            보류
          </button>
        </form>
      ) : null}

      {canReject ? (
        <form action={panelAction}>
          <PanelActionField kind="decision" />
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="reject" />
          <label htmlFor="claim-reject-note">
            <span>거부 사유 (10~200자, 구매자에게 전달됩니다)</span>
            <input id="claim-reject-note" maxLength={200} name="note" type="text" />
          </label>
          <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">
            거부
          </button>
        </form>
      ) : null}
    </div>
  );
}
