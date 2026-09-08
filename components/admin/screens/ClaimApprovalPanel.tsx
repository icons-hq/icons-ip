'use client';

import { useActionState } from 'react';
import {
  approveClaimRefundAction,
  recordClaimInspectionAction,
  type AdminClaimActionState,
} from '@/app/admin/claim-actions';
import type { AdminClaimRefundAssessment, AdminClaimRestoration } from '@/lib/admin/claims.server';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import type { OrderClaimStage, OrderClaimType } from '@/lib/orders/claims';

/*
 * 환불 승인과 반품 검수 (D-3).
 *
 * 두 가지를 한 칸에 둔 이유: 둘 다 「돈이나 물건이 실제로 움직이기 직전」의 판정이고,
 * 둘 다 되돌리기 어렵다. 그래서 무엇을 근거로 판정하는지(금액·한도·수량)를
 * 버튼 옆에 그대로 적는다 — 근거를 다른 화면에서 찾아야 하면 사람은 찾지 않는다.
 */

const EMPTY_STATE: AdminClaimActionState = {};

const OUTCOME_LABELS: Record<string, string> = {
  restock: '다시 팔 수 있음',
  discard: '폐기',
};

function Message({ state }: { state: AdminClaimActionState }) {
  if (state.error) return <p className="admin-form-error" role="alert">{state.error}</p>;
  if (state.message) return <p className="muted" style={{ fontSize: 12, margin: 0 }}>{state.message}</p>;
  return null;
}

function ApprovalForm({ claimId, claimType }: { claimId: string; claimType: OrderClaimType }) {
  const [state, action, pending] = useActionState(approveClaimRefundAction, EMPTY_STATE);
  return (
    <form action={action} className="col" style={{ gap: 8 }}>
      <input name="claimId" type="hidden" value={claimId} />
      <input name="claimType" type="hidden" value={claimType} />
      <input aria-label="승인 메모" name="note" placeholder="승인 근거 (선택)" />
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-holo" disabled={pending} type="submit">환불 승인</button>
        <Message state={state} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        승인은 관리자만 할 수 있고, 이 건을 처리한 사람은 스스로 승인할 수 없습니다.
      </p>
    </form>
  );
}

function InspectionForm({ claimId, claimType }: { claimId: string; claimType: OrderClaimType }) {
  const [state, action, pending] = useActionState(recordClaimInspectionAction, EMPTY_STATE);
  return (
    <form action={action} className="col" style={{ gap: 8 }}>
      <input name="claimId" type="hidden" value={claimId} />
      <input name="claimType" type="hidden" value={claimType} />
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <input aria-label="검수 수량" min={1} name="qty" placeholder="수량" style={{ width: 80 }} type="number" />
        <button className="btn btn-sm btn-holo" disabled={pending} name="outcome" type="submit" value="restock">
          다시 팔 수 있음
        </button>
        <button className="btn btn-sm btn-ghost" disabled={pending} name="outcome" type="submit" value="discard">
          폐기
        </button>
      </div>
      <Message state={state} />
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        「다시 팔 수 있음」만 재고로 돌아갑니다. 검수는 한 번만 기록되니 물건을 보고 누르세요.
      </p>
    </form>
  );
}

export function ClaimApprovalPanel({
  assessment,
  claimId,
  claimType,
  inspection,
  approvedAt,
  approvedByName,
  restorations,
  stage,
}: {
  assessment: AdminClaimRefundAssessment | null;
  claimId: string;
  claimType: OrderClaimType;
  inspection: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  restorations: AdminClaimRestoration[];
  stage: OrderClaimStage;
}) {
  const needsInspection = claimType !== 'cancel' && stage === 'collected' && inspection === null;

  return (
    <>
      {assessment ? (
        <div className="col" style={{ gap: 6, marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>환불 금액과 한도</h3>
          <p style={{ fontSize: 13, margin: 0 }}>
            환불 {krw(assessment.amount)} / 주문 {krw(assessment.orderTotal)}
          </p>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {assessment.maxAmountNoApproval === null
              ? '이 사유에는 한도가 정해져 있지 않습니다 — 승인이 필요합니다.'
              : `승인 없이 처리 가능 ${krw(assessment.maxAmountNoApproval)}`}
            {assessment.maxRatio !== null && assessment.maxRatio < 1
              ? ` · 주문 금액의 ${Math.round(assessment.maxRatio * 100)}%까지`
              : ''}
            {assessment.alwaysRequiresApproval ? ' · 이 사유는 금액과 무관하게 승인이 필요합니다' : ''}
          </p>
          {approvedAt ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              승인 {approvedByName ?? '(알 수 없음)'} · {formatOrderDateTime(approvedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === 'approval_pending' ? (
        <div className="col" style={{ gap: 8, marginBottom: 14 }}>
          <ApprovalForm claimId={claimId} claimType={claimType} />
        </div>
      ) : null}

      {needsInspection ? (
        <div className="col" style={{ gap: 8, marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>반품 검수</h3>
          <InspectionForm claimId={claimId} claimType={claimType} />
        </div>
      ) : null}

      {restorations.length > 0 ? (
        <div className="col" style={{ gap: 6, marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>재고 복원 기록</h3>
          <ul className="admin-order-refs">
            {restorations.map((row) => (
              <li key={row.id} style={{ fontSize: 12 }}>
                <strong>{OUTCOME_LABELS[row.outcome] ?? row.outcome}</strong>{' '}
                {row.goodName ?? '(품목 없음)'} {row.qty}개
                <span className="faint"> · {row.actorName} · {formatOrderDateTime(row.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
