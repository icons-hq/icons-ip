'use client';

import { useActionState } from 'react';
import { recordOrderClaimReshipmentDeliveryAction } from '@/app/admin/claim-actions';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { formatOrderDateTime } from '@/lib/orders';

export function ClaimReshipmentDelivery({ claim }: { claim: AdminClaimDetail['claim'] }) {
  const [state, action, pending] = useActionState(recordOrderClaimReshipmentDeliveryAction, {});
  const restored = preservedFormValues(state, claim.id, { scopeKey: 'claimId' });
  if (claim.claimType !== 'exchange' || !claim.reshipTrackingNumber) return null;
  const canConfirm = claim.stage === 'completed' && Boolean(claim.reshipCarrier && claim.reshippedAt);
  return <section className="admin-claim-reship-delivery" aria-label="교환품 배송완료 확인" style={{ marginTop: 20 }}>
    <h3 style={{ fontSize: 15 }}>교환품 배송완료 확인</h3>
    {claim.reshipDeliveredAt ? <>
      <p><time dateTime={claim.reshipDeliveredAt}>{formatOrderDateTime(claim.reshipDeliveredAt)}</time>
        {claim.reshipDeliveredByName ? ` · ${claim.reshipDeliveredByName}` : ''}</p>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{claim.reshipDeliveryEvidence}</p>
    </> : canConfirm ? <form action={action} key={adminFormRemountKey(state, { claimId: claim.id })}>
      <p className="muted">모든 교환품이 실제로 도착했는지 확인해주세요. 확인 전에는 새 반품·교환 신청이 열리지 않습니다.</p>
      <input type="hidden" name="claimId" value={claim.id} />
      <label htmlFor="claim-reship-delivery-evidence">배송완료 확인 근거</label>
      <textarea id="claim-reship-delivery-evidence" name="evidence" required maxLength={500} rows={3}
        defaultValue={restored?.evidence ?? ''} disabled={pending}
        placeholder="택배사 배송 조회 또는 고객의 전체 수령 확인" />
      <button className="btn btn-sm" type="submit" disabled={pending}>교환품 배송완료 확인</button>
      {state.error ? <p role="alert">{adminClaimCopy(state.error)}</p> : null}
      {state.message ? <p role="status">{adminClaimCopy(state.message)}</p> : null}
    </form> : <p className="muted">재출고 이력을 확인한 뒤 배송완료를 기록해주세요.</p>}
  </section>;
}
