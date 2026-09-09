'use client';

import { useActionState } from 'react';
import { recordOrderClaimOriginCollectionAction } from '@/app/admin/claim-actions';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { formatOrderDateTime } from '@/lib/orders';
import type { OrderClaimType } from '@/lib/orders/claims';

export function ClaimOriginCollection({ claimId, claimType, collection, canRecord }: {
  claimId: string;
  claimType: OrderClaimType;
  collection: AdminClaimCollection;
  canRecord: boolean;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOriginCollectionAction, {});
  const restored = preservedFormValues(state, collection.shipmentId, { scopeKey: 'shipmentId' });
  const evidenceId = `claim-collection-${collection.shipmentId}`;
  return <section className="card admin-claim-origin-collection" aria-label={`${collection.originName} 회수 현황`}>
    <h4 style={{ margin: '0 0 8px' }}>{collection.originName} · {collection.collectedAt ? '회수 확인 완료' : '회수 대기'}</h4>
    <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>반송 주소</p>
    <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{collection.returnAddress || '출고지 설정에서 반송 주소를 등록해주세요.'}</p>
    <ul style={{ fontSize: 13, paddingLeft: 18 }}>
      {collection.items.map((item) => <li key={item.orderItemId}>{item.name} · {item.qty}개</li>)}
    </ul>
    {collection.collectedAt ? <>
      <p style={{ fontSize: 12 }}>{formatOrderDateTime(collection.collectedAt)}{collection.collectorName ? ` · ${collection.collectorName}` : ''}</p>
      <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{collection.evidence}</p>
    </> : canRecord ? <form action={action} key={adminFormRemountKey(state, { claimId, shipmentId: collection.shipmentId })}>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="claimType" value={claimType} />
      <input type="hidden" name="shipmentId" value={collection.shipmentId} />
      <label htmlFor={evidenceId}><span>회수 확인 근거</span>
        <textarea id={evidenceId} name="evidence" required maxLength={500} rows={3}
          defaultValue={restored?.claimId === claimId ? restored.evidence : ''}
          placeholder="창고 회신 번호와 반송 상품·수량 대조 결과" disabled={pending} />
      </label>
      <button className="btn btn-sm" type="submit" disabled={pending}>{collection.originName} 회수 확인</button>
      {state.error ? <p role="alert">{adminClaimCopy(state.error)}</p> : null}
      {state.message ? <p role="status">{adminClaimCopy(state.message)}</p> : null}
    </form> : null}
  </section>;
}
