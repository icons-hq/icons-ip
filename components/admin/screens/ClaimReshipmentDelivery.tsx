'use client';

import { useActionState } from 'react';
import { recordOrderClaimReshipmentDeliveryAction } from '@/app/admin/claim-actions';
import type { AdminClaimDetail } from '@/lib/admin/claims.server';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { formatOrderDateTime } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

export function ClaimReshipmentDelivery({ claim }: { claim: AdminClaimDetail['claim'] }) {
  const [state, action, pending] = useActionState(recordOrderClaimReshipmentDeliveryAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const restored = preservedFormValues(state, claim.id, { scopeKey: 'claimId' });
  if (claim.claimType !== 'exchange' || !claim.reshipTrackingNumber) return null;
  const canConfirm = claim.stage === 'completed' && Boolean(claim.reshipCarrier && claim.reshippedAt);
  return <section className="flex min-w-0 flex-col gap-3 border-t pt-4 text-sm" aria-label="교환품 배송완료 확인" data-claim-reship-delivery="">
    <h3 className="text-base leading-snug font-medium">교환품 배송완료 확인</h3>
    {claim.reshipDeliveredAt ? <>
      <p><time dateTime={claim.reshipDeliveredAt}>{formatOrderDateTime(claim.reshipDeliveredAt)}</time>
        {claim.reshipDeliveredByName ? ` · ${claim.reshipDeliveredByName}` : ''}</p>
      <p className="break-words whitespace-pre-wrap">{claim.reshipDeliveryEvidence}</p>
    </> : canConfirm ? <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId: claim.id })}>
      <p className="text-muted-foreground">모든 교환품이 실제로 도착했는지 확인해주세요. 확인 전에는 새 반품·교환 신청이 열리지 않습니다.</p>
      <input type="hidden" name="claimId" value={claim.id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="claim-reship-delivery-evidence">배송완료 확인 근거</Label>
        <Textarea id="claim-reship-delivery-evidence" name="evidence" required maxLength={500} rows={3}
          defaultValue={restored?.evidence ?? ''} disabled={pending}
          placeholder="택배사 배송 조회 또는 고객의 전체 수령 확인" />
      </div>
      <Button className="w-fit" size="sm" type="submit" disabled={pending}>교환품 배송완료 확인</Button>
      {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
      {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
    </form> : <p className="text-muted-foreground">재출고 이력을 확인한 뒤 배송완료를 기록해주세요.</p>}
  </section>;
}
