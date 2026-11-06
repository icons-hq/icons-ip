'use client';

import { useActionState } from 'react';
import { recordOrderClaimOriginCollectionAction } from '@/app/admin/claim-actions';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { formatOrderDateTime } from '@/lib/orders';
import type { OrderClaimType } from '@/lib/orders/claims';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

export function ClaimOriginCollection({ claimId, claimType, collection, canRecord }: {
  claimId: string;
  claimType: OrderClaimType;
  collection: AdminClaimCollection;
  canRecord: boolean;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOriginCollectionAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const restored = preservedFormValues(state, collection.shipmentId, { scopeKey: 'shipmentId' });
  const evidenceId = `claim-collection-${collection.shipmentId}`;
  return <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm" aria-label={`${collection.originName} 회수 현황`} data-claim-origin-collection="">
    <h4 className="font-medium">{collection.originName} · {collection.collectedAt ? '회수 확인 완료' : '회수 대기'}</h4>
    <div>
      <p className="text-xs text-muted-foreground">반송 주소</p>
      <p className="break-words whitespace-pre-wrap">{collection.returnAddress || '출고지 설정에서 반송 주소를 등록해주세요.'}</p>
    </div>
    <ul className="list-disc pl-5">
      {collection.items.map((item) => <li key={item.orderItemId}>{item.name} · {item.qty}개</li>)}
    </ul>
    {collection.collectedAt ? <>
      <p className="text-xs text-muted-foreground">{formatOrderDateTime(collection.collectedAt)}{collection.collectorName ? ` · ${collection.collectorName}` : ''}</p>
      <p className="break-words whitespace-pre-wrap">{collection.evidence}</p>
    </> : canRecord ? <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId, shipmentId: collection.shipmentId })}>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="claimType" value={claimType} />
      <input type="hidden" name="shipmentId" value={collection.shipmentId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={evidenceId}>회수 확인 근거</Label>
        <Textarea id={evidenceId} name="evidence" required maxLength={500} rows={3}
          defaultValue={restored?.claimId === claimId ? restored.evidence : ''}
          placeholder="창고 회신 번호와 반송 상품·수량 대조 결과" disabled={pending} />
      </div>
      <Button className="w-fit" size="sm" type="submit" disabled={pending}>{collection.originName} 회수 확인</Button>
      {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
      {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
    </form> : null}
  </section>;
}
