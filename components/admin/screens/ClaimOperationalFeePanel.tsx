'use client';

import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { useActionState } from 'react';
import {
  recordOrderClaimOperationalFeeAction,
  type AdminClaimActionState,
} from '@/app/admin/claim-actions';
import {
  ADMIN_CLAIM_OPERATIONAL_FEE_KINDS,
  type AdminClaimOperationalFee,
} from '@/lib/admin/claims';
import type { OrderClaimType } from '@/lib/orders/claims';

const EMPTY_STATE: AdminClaimActionState = {};
const KIND_LABELS: Record<(typeof ADMIN_CLAIM_OPERATIONAL_FEE_KINDS)[number], string> = {
  return_shipping: '반품 배송비',
  exchange_shipping: '교환 배송비',
  other: '기타 운영 비용',
};

export function ClaimOperationalFeePanel({
  claimId,
  claimType,
  fee,
}: {
  claimId: string;
  claimType: OrderClaimType;
  fee: AdminClaimOperationalFee;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOperationalFeeAction, EMPTY_STATE);
  const values = preservedFormValues(state, claimId, { scopeKey: 'claimId' });
  return <section aria-label="운영 확인액 기록" className="admin-claim-operational-fee">
    <h3 style={{ marginTop: 0 }}>운영 확인액</h3>
    <p className="muted" style={{ fontSize: 12.5 }}>
      CS가 실제로 확인한 금액과 근거만 기록합니다. 이 기록은 고객에게 추가 청구하거나 환불액에서 차감하지 않으며, 클레임 접수를 막지 않습니다.
      금액을 모르면 비워 두고 저장하세요. 0원은 확인된 무료 비용으로 구분됩니다.
    </p>
    <form action={action} key={adminFormRemountKey(state, fee)}>
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
      <input name="claimId" type="hidden" value={claimId} />
      <input name="claimType" type="hidden" value={claimType} />
      <input name="expectedUpdatedAt" type="hidden" value={values?.expectedUpdatedAt ?? fee.updatedAt} />
      <label htmlFor="claim-operational-fee-kind">
        <span>비용 유형</span>
        <select defaultValue={values?.feeKind ?? fee.kind ?? ''} id="claim-operational-fee-kind" name="feeKind" disabled={pending}>
          <option value="">선택 안 함</option>
          {ADMIN_CLAIM_OPERATIONAL_FEE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label htmlFor="claim-operational-fee-amount">
        <span>확인 금액 (원)</span>
        <input defaultValue={values?.amount ?? (fee.amount === null ? '' : String(fee.amount))} id="claim-operational-fee-amount" inputMode="numeric" max={1000000} min={0} name="amount" type="number" />
      </label>
      <label htmlFor="claim-operational-fee-note">
        <span>금액 의미·메모</span>
        <input defaultValue={values?.note ?? fee.note ?? ''} id="claim-operational-fee-note" maxLength={500} name="note" placeholder="예: 고객 귀책 왕복 배송비 확인" type="text" />
      </label>
      <label htmlFor="claim-operational-fee-evidence">
        <span>확인 근거</span>
        <textarea defaultValue={values?.evidence ?? fee.evidence ?? ''} id="claim-operational-fee-evidence" maxLength={1000} name="evidence" rows={3} placeholder="CS 상담 기록·택배 회신 등 실제 근거" />
      </label>
      <button className="btn btn-sm" disabled={pending} type="submit">{pending ? '저장 중…' : fee.amount === null ? '운영 확인액 기록' : '운영 확인액 갱신'}</button>
      {state.error ? <p role="alert" style={{ fontSize: 12.5 }}>{state.error}</p> : null}
      {state.message ? <p className="muted" role="status" style={{ fontSize: 12.5 }}>{state.message}</p> : null}
      </fieldset>
    </form>
  </section>;
}
