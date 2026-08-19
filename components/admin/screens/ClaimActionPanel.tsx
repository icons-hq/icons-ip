'use client';

import { useActionState, useState } from 'react';
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
  type OrderClaimStage,
  type OrderClaimType,
} from '@/lib/orders/claims';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';

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
 * 일이 원장 기록뿐이고, 문구도 그렇게 말해야 한다. */

const EMPTY_STATE: AdminClaimActionState = {};

function Feedback({ state }: { state: AdminClaimActionState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" style={{ fontSize: 12.5, margin: '6px 0 0' }}>{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
          {state.message}
        </p>
      ) : null}
    </>
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
}: ClaimActionPanelProps) {
  const [decisionState, decisionAction, decisionPending] = useActionState(
    decideOrderClaimAction,
    EMPTY_STATE,
  );
  const [collectionState, collectionAction, collectionPending] = useActionState(
    recordOrderClaimCollectionAction,
    EMPTY_STATE,
  );
  const [refundState, refundAction, refundPending] = useActionState(
    recordOrderClaimRefundAction,
    EMPTY_STATE,
  );
  const [reshipState, reshipAction, reshipPending] = useActionState(
    recordOrderClaimReshipmentAction,
    EMPTY_STATE,
  );
  const [formCopied, setFormCopied] = useState(false);

  const next = orderClaimNextStages(claimType, stage);
  const canApprove = stage === 'requested' || stage === 'in_review';
  const canReview = stage === 'requested';
  const canHold = next.includes('on_hold');
  const canResume = stage === 'on_hold';
  const canReject = canRejectOrderClaim(stage, heldFrom);
  const canCollect = claimType !== 'cancel' && stage === 'collecting';
  const canFileRefund = claimType !== 'exchange'
    && (stage === 'collected' || stage === 'processing');
  /* 완료를 적을 수 있는지는 단계가 아니라 원장이 정한다. 레거시 경로로 종결된
     클레임은 stage가 completed여도 refunds.completed_at이 비어 있고, 반대로 원장
     행이 아예 없는 주문에는 적을 대상이 없다(RPC가 claim_refund_ledger_missing으로
     막는다). 단계만 보면 "누르면 반드시 실패하는 버튼"이 생긴다. */
  const refundStageReached = stage === 'processing'
    || stage === 'needs_review'
    || stage === 'completed';
  const canCompleteRefund = claimType !== 'exchange'
    && refundStageReached
    && refundLedgerOpen
    && !refundCompleted;
  const refundLedgerMissing = claimType !== 'exchange'
    && refundStageReached
    && !refundLedgerOpen;
  /* 이미 종결된 클레임에서는 정합화가 더 돌지 않는다. 남은 일은 원장 기록뿐이다. */
  const refundFinalizationPending = stage !== 'completed';
  const canReship = claimType === 'exchange' && stage === 'collected';

  return (
    <div className="admin-claim-actions">
      <h3 style={{ margin: 0 }}>처리</h3>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        현재 단계: {ORDER_CLAIM_STAGE_LABELS[stage]}
      </p>

      {canReview || canApprove ? (
        <form action={decisionAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <div className="row" style={{ gap: 8 }}>
            {canReview ? (
              <button
                className="btn btn-sm btn-ghost"
                disabled={decisionPending}
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
                disabled={decisionPending}
                name="decision"
                type="submit"
                value="approve"
              >
                {claimType === 'cancel' ? '승인하고 환불 처리 시작' : '승인하고 수거 시작'}
              </button>
            ) : null}
          </div>
          <Feedback state={decisionState} />
        </form>
      ) : null}

      {canResume ? (
        <form action={decisionAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="resume" />
          <button className="btn btn-sm" disabled={decisionPending} type="submit">
            보류 해제
          </button>
          <Feedback state={decisionState} />
        </form>
      ) : null}

      {canCollect ? (
        <form action={collectionAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="stage" type="hidden" value="collected" />
          <button className="btn btn-sm" disabled={collectionPending} type="submit">
            반송 굿즈 입고 확인
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            입고 확인 시점부터 환급 SLA(영업일 3일)가 시작됩니다.
          </p>
          <Feedback state={collectionState} />
        </form>
      ) : null}

      {cancellationForm ? (
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
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
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
        <form action={refundAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="filed" />
          <label htmlFor="claim-refund-method">
            <span>환불 수단</span>
            <select defaultValue="pg_cancel" id="claim-refund-method" name="method">
              {ORDER_CLAIM_REFUND_METHODS.map((method) => (
                <option key={method} value={method}>
                  {ORDER_CLAIM_REFUND_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </label>
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
          <button className="btn btn-sm" disabled={refundPending} type="submit">
            {refundFiled ? '환불 접수 정보 갱신' : '환불 접수 완료로 기록'}
          </button>
          <Feedback state={refundState} />
        </form>
      ) : null}

      {canCompleteRefund ? (
        <form action={refundAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="orderId" type="hidden" value={orderId} />
          <input name="stage" type="hidden" value="completed" />
          <label htmlFor="claim-refund-complete-method">
            <span>환불 수단</span>
            <select defaultValue="pg_cancel" id="claim-refund-complete-method" name="method">
              {ORDER_CLAIM_REFUND_METHODS.map((method) => (
                <option key={method} value={method}>
                  {ORDER_CLAIM_REFUND_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="claim-refund-complete-note">
            <span>상계·정산 메모 (선택)</span>
            <input id="claim-refund-complete-note" maxLength={300} name="note" type="text" />
          </label>
          <button className="btn btn-sm" disabled={refundPending} type="submit">
            {refundFinalizationPending
              ? '환불 완료 확정 (재고 복원 · 카드팩 회수 포함)'
              : '환불 완료를 원장에 기록'}
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {refundFinalizationPending
              ? '결제사 원장에서 전액 취소를 확인한 뒤 눌러주세요. 확인되지 않으면 주문과 재고는 그대로 유지됩니다.'
              : '이 클레임은 이미 종결됐습니다. 주문 취소·재고 복원·카드팩 회수는 끝났고, 여기서는 환불 원장에 완료 기록만 남깁니다.'}
          </p>
          <Feedback state={refundState} />
        </form>
      ) : null}

      {refundLedgerMissing ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          이 주문에는 환불 원장이 없어 완료를 기록할 수 없습니다. 결제 내역을 먼저
          확인해주세요.
        </p>
      ) : null}

      {canReship ? (
        <form action={reshipAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value="exchange" />
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
          <button className="btn btn-sm" disabled={reshipPending} type="submit">
            재출고 등록하고 교환 종결
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            교환은 환불이 아닙니다. 재고를 복원하지 않고 카드팩도 회수하지 않습니다.
          </p>
          <Feedback state={reshipState} />
        </form>
      ) : null}

      {canHold ? (
        <form action={decisionAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="hold" />
          <label htmlFor="claim-hold-note">
            <span>보류 사유 (10~200자, 구매자에게 전달됩니다)</span>
            <input id="claim-hold-note" maxLength={200} name="note" type="text" />
          </label>
          <button className="btn btn-sm btn-ghost" disabled={decisionPending} type="submit">
            보류
          </button>
        </form>
      ) : null}

      {canReject ? (
        <form action={decisionAction}>
          <input name="claimId" type="hidden" value={claimId} />
          <input name="claimType" type="hidden" value={claimType} />
          <input name="decision" type="hidden" value="reject" />
          <label htmlFor="claim-reject-note">
            <span>거부 사유 (10~200자, 구매자에게 전달됩니다)</span>
            <input id="claim-reject-note" maxLength={200} name="note" type="text" />
          </label>
          <button className="btn btn-sm btn-ghost" disabled={decisionPending} type="submit">
            거부
          </button>
        </form>
      ) : null}
    </div>
  );
}
