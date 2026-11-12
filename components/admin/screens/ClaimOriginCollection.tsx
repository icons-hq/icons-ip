'use client';

import { useActionState, useId, useState } from 'react';
import { recordOrderClaimOriginCollectionAction } from '@/app/admin/claim-actions';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';
import { adminClaimTodayKst } from '@/lib/admin/claims';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { formatOrderDateTime } from '@/lib/orders';
import { statusTone } from '@/lib/admin/status-tone';
import type { OrderClaimType } from '@/lib/orders/claims';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

/*
 * 출고지(배송 건) 하나의 회수 확인. 근거와 함께 실제 입고일(기본 오늘, 미래 불가)을 받는다 — 확인 버튼을 늦게 누른
 * 시각을 반환일로 대신하지 않고, 환급 기한은 모든 출고지 가운데 가장 늦은 입고일부터 센다(1027T-033).
 * 회수 생략을 결정한 배송 건(ADR-0041 — 진실원은 결정 표, 재출고 전 결정 포함)은 '회수 생략'으로 보인다. 요청이 열려 있는
 * 동안 늦게 도착한 입고를 확인할 수 있고, 재고는 바뀌지 않는다(재출고는 결정대로 회수품을 복원하지 않는다).
 */
export function ClaimOriginCollection({ claimId, claimType, collection, canRecord }: {
  claimId: string;
  claimType: OrderClaimType;
  collection: AdminClaimCollection;
  canRecord: boolean;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOriginCollectionAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  /* 입고일 상한은 처음 그린 때의 KST 오늘이다(자정을 넘겨도 서버가 다시 판정한다). */
  const [today] = useState(() => adminClaimTodayKst());
  const restored = preservedFormValues(state, collection.shipmentId, { scopeKey: 'shipmentId' });
  const evidenceId = `claim-collection-${collection.shipmentId}`;
  const receivedId = useId();
  const waived = collection.collectionWaived === true;
  const badge = collection.collectedAt
    ? <AdminStatusBadge tone="success">회수 확인 완료</AdminStatusBadge>
    : waived ? <AdminStatusBadge tone={statusTone('claimReshipment', 'waived')}>회수 생략</AdminStatusBadge>
      : <AdminStatusBadge tone="warning">회수 대기</AdminStatusBadge>;
  /* 처리 칸 안의 또 다른 상자로 그리지 않는다 — 출고지 사이는 구분선과 여백으로 나눈다. */
  return <section className="flex min-w-0 flex-col gap-2 border-t pt-3 text-sm" aria-label={`${collection.originName} 회수 현황`} data-claim-origin-collection="" data-collection-waived={waived ? '' : undefined}>
    <h4 className="flex flex-wrap items-center gap-2 font-medium">{collection.originName} {badge}</h4>
    <div>
      <p className="text-xs text-muted-foreground">반송 주소</p>
      <p className="break-words whitespace-pre-wrap">{collection.returnAddress || '출고지 설정에서 반송 주소를 등록해주세요.'}</p>
    </div>
    <ul className="list-disc pl-5">
      {collection.items.map((item) => <li key={item.orderItemId}>{item.name} · {item.qty}개</li>)}
    </ul>
    {collection.collectedAt ? <>
      <p className="text-xs text-muted-foreground">
        {collection.receivedOn ? <>실제 입고일 <span className="tabular-nums">{collection.receivedOn}</span> · </> : null}
        확인 {formatOrderDateTime(collection.collectedAt)}{collection.collectorName ? ` · ${collection.collectorName}` : ''}
      </p>
      <p className="break-words whitespace-pre-wrap">{collection.evidence}</p>
      {waived ? <p className="text-xs text-muted-foreground">회수 생략으로 결정한 뒤 늦게 도착한 입고입니다. 재고는 바뀌지 않았습니다.</p> : null}
    </> : canRecord ? <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId, shipmentId: collection.shipmentId })}>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="claimType" value={claimType} />
      <input type="hidden" name="shipmentId" value={collection.shipmentId} />
      {waived ? <AdminNotice tone="info">회수 생략으로 결정한 출고지입니다. 상품이 늦게 도착했을 때만 입고를 확인하세요. 재고는 바뀌지 않으니, 다시 팔 수 있으면 재고 조정에서 반영해주세요.</AdminNotice> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={receivedId}>실제 입고일</Label>
        <Input className="w-full sm:w-44" defaultValue={restored?.claimId === claimId && typeof restored.receivedOn === 'string' ? restored.receivedOn : today}
          disabled={pending} id={receivedId} max={today} name="receivedOn" required type="date" />
        <p className="text-xs text-muted-foreground">창고에 실제로 도착한 날입니다. 환급 기한은 이 날부터 셉니다.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={evidenceId}>회수 확인 근거</Label>
        <Textarea id={evidenceId} name="evidence" required maxLength={500} rows={3}
          defaultValue={restored?.claimId === claimId ? restored.evidence : ''}
          placeholder="창고 회신 번호와 반송 상품·수량 대조 결과" disabled={pending} />
      </div>
      <Button className="w-fit" size="sm" type="submit" disabled={pending}>{collection.originName} {waived ? '늦은 입고 확인' : '회수 확인'}</Button>
      {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
      {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
    </form> : null}
  </section>;
}
