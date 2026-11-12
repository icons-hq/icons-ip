'use client';

import { useActionState, useId, useState } from 'react';
import { recordOrderClaimOriginCollectionAction } from '@/app/admin/claim-actions';
import { retryClaimReturnPickupAction } from '@/app/admin/claim-return-actions';
import { RETURN_PICKUP_CANCEL_REASON_LABELS, RETURN_PICKUP_STATE_LABELS, returnPickupErrorLabel, returnPickupRetryable, type AdminReturnPickup } from '@/lib/admin/claim-return-pickup';
import type { AdminClaimCollection, AdminClaimCollectionBundle } from '@/lib/admin/claims.server';
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
 * 회수 묶음(S36-040): 한 배송 건 안에서 상품별 반품지가 갈리면 반품지마다 묶음이 나뉘고, 묶음마다 입고를 확인한다. 배송 건의
 * 모든 묶음이 입고돼야 그 배송 건이 회수 완료다. 묶음이 하나면 지금까지처럼 배송 건 하나로 확인한다.
 * 반품 자동 회수 접수(QNA-032): 스위치를 켠 뒤 접수 큐에 들어간 묶음에만 접수 상태·회수 송장이 보이고, 자동 수거 실패는 다시 접수한다.
 */
export function ClaimOriginCollection({ claimId, claimType, collection, canRecord }: {
  claimId: string;
  claimType: OrderClaimType;
  collection: AdminClaimCollection;
  canRecord: boolean;
}) {
  const waived = collection.collectionWaived === true;
  const bundles = collection.bundles ?? [];
  const split = bundles.length > 1;
  const single = bundles.length === 1 ? bundles[0] : null;
  const badge = collection.collectedAt
    ? <AdminStatusBadge tone="success">회수 확인 완료</AdminStatusBadge>
    : waived ? <AdminStatusBadge tone={statusTone('claimReshipment', 'waived')}>회수 생략</AdminStatusBadge>
      : split && bundles.some((bundle) => bundle.collectedAt) ? <AdminStatusBadge tone="warning">{`일부 입고 ${bundles.filter((bundle) => bundle.collectedAt).length}/${bundles.length}`}</AdminStatusBadge>
        : <AdminStatusBadge tone="warning">회수 대기</AdminStatusBadge>;
  /* 처리 칸 안의 또 다른 상자로 그리지 않는다 — 출고지 사이는 구분선과 여백으로 나눈다. */
  return <section className="flex min-w-0 flex-col gap-2 border-t pt-3 text-sm" aria-label={`${collection.originName} 회수 현황`} data-claim-origin-collection="" data-collection-waived={waived ? '' : undefined}>
    <h4 className="flex flex-wrap items-center gap-2 font-medium">{collection.originName} {badge}</h4>
    {split ? <>
      <p className="text-xs text-muted-foreground">상품마다 반품지가 달라 반품지 {bundles.length}곳으로 나눠 회수합니다. 반품지마다 도착한 입고를 확인해주세요.</p>
      {waived ? <AdminNotice tone="info">회수 생략으로 결정한 출고지입니다. 상품이 늦게 도착했을 때만 입고를 확인하세요. 재고는 바뀌지 않으니, 다시 팔 수 있으면 재고 조정에서 반영해주세요.</AdminNotice> : null}
      {bundles.map((bundle, index) => <div className="flex min-w-0 flex-col gap-2 border-l-2 pl-3" data-claim-collection-bundle="" key={bundle.bundleId}>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {`반품지 ${index + 1}/${bundles.length} · ${bundle.returnName || '출고지 반품 주소'}`}
          {bundle.collectedAt ? <AdminStatusBadge tone="success">입고 확인</AdminStatusBadge> : <AdminStatusBadge tone="warning">입고 대기</AdminStatusBadge>}
        </p>
        <ReturnDestination address={bundle.returnAddress} phone={bundle.returnPhone} />
        <ItemList items={bundle.items} />
        {bundle.pickup ? <ReturnPickupStatus bundleId={bundle.bundleId} canRetry={canRecord} claimId={claimId} pickup={bundle.pickup} /> : null}
        {bundle.collectedAt ? <CollectedRecord collectedAt={bundle.collectedAt} collectorName={bundle.collectorName} evidence={bundle.evidence} receivedOn={bundle.receivedOn} />
          : canRecord ? <CollectionRecordForm bundle={bundle} claimId={claimId} claimType={claimType} label={bundle.returnName || '출고지 반품 주소'} shipmentId={collection.shipmentId} waived={waived} /> : null}
      </div>)}
      {collection.collectedAt && waived ? <p className="text-xs text-muted-foreground">회수 생략으로 결정한 뒤 늦게 도착한 입고입니다. 재고는 바뀌지 않았습니다.</p> : null}
    </> : <>
      <ReturnDestination address={collection.returnAddress} name={single?.returnName} phone={single?.returnPhone} />
      <ItemList items={collection.items} />
      {single?.pickup ? <ReturnPickupStatus bundleId={single.bundleId} canRetry={canRecord} claimId={claimId} pickup={single.pickup} /> : null}
      {collection.collectedAt ? <>
        <CollectedRecord collectedAt={collection.collectedAt} collectorName={collection.collectorName} evidence={collection.evidence} receivedOn={collection.receivedOn} />
        {waived ? <p className="text-xs text-muted-foreground">회수 생략으로 결정한 뒤 늦게 도착한 입고입니다. 재고는 바뀌지 않았습니다.</p> : null}
      </> : canRecord ? <CollectionRecordForm claimId={claimId} claimType={claimType} label={collection.originName} shipmentId={collection.shipmentId} waived={waived} /> : null}
    </>}
  </section>;
}

function ReturnDestination({ address, name, phone }: { address: string; name?: string; phone?: string }) {
  return <div>
    <p className="text-xs text-muted-foreground">반송 주소</p>
    <p className="break-words whitespace-pre-wrap">{address
      ? [name, address, phone].filter(Boolean).join(' · ')
      : '상품의 반품/교환지를 고르거나 출고지 설정에서 반품 주소를 등록해주세요.'}</p>
  </div>;
}

/* 회수 묶음 하나의 자동 회수 접수. 접수되면 회수 송장, 실패하면 이유·자동 재시도와 [다시 접수], 취소되면 그 이유를 보인다. */
function ReturnPickupStatus({ bundleId, canRetry, claimId, pickup }: { bundleId: string; canRetry: boolean; claimId: string; pickup: AdminReturnPickup }) {
  const [state, action, pending] = useActionState(retryClaimReturnPickupAction, {});
  useClaimPreviewBusy(pending);
  const failed = pickup.state === 'failed' || pickup.state === 'cancel_failed';
  return <div className="flex min-w-0 flex-col gap-1" data-claim-return-pickup={pickup.state}>
    <p className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">자동 회수 접수</span>
      <AdminStatusBadge tone={statusTone('claimReturnPickup', pickup.state)}>{RETURN_PICKUP_STATE_LABELS[pickup.state]}</AdminStatusBadge>
      {pickup.trackingNumber ? <span className="tabular-nums">{pickup.carrierLabel ?? pickup.carrier} · 회수 송장 {pickup.trackingNumber}</span> : null}
    </p>
    {pickup.requestedAt ? <p className="text-xs text-muted-foreground">접수 {formatOrderDateTime(pickup.requestedAt)}</p> : null}
    {failed ? <p className="text-xs text-destructive">
      {returnPickupErrorLabel(pickup.lastErrorCode) ?? '택배사가 받지 않았습니다'} · 자동 시도 {pickup.autoAttempts}/{pickup.maxAttempts}회
      {pickup.nextAttemptAt ? ` · 다음 자동 시도 ${formatOrderDateTime(pickup.nextAttemptAt)}` : ' · 자동 재시도 끝'}
    </p> : null}
    {pickup.state === 'canceled' && pickup.cancelReason ? <p className="text-xs text-muted-foreground">수거 취소 · {RETURN_PICKUP_CANCEL_REASON_LABELS[pickup.cancelReason] ?? pickup.cancelReason}</p> : null}
    {pickup.inProgress ? <p className="text-xs text-muted-foreground">택배사에 보내는 중입니다.</p> : null}
    {canRetry && returnPickupRetryable(pickup) ? <form action={action}>
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="bundleId" value={bundleId} />
      <Button className="w-fit" disabled={pending} size="sm" type="submit" variant="outline">{pickup.state === 'cancel_failed' ? '수거 취소 다시 요청' : '회수 다시 접수'}</Button>
    </form> : null}
    {state.error ? <p className="text-destructive" role="alert">{state.error}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{state.message}</p> : null}
  </div>;
}

function ItemList({ items }: { items: AdminClaimCollection['items'] }) {
  return <ul className="list-disc pl-5">
    {items.map((item) => <li key={item.orderItemId}>{item.name} · {item.qty}개</li>)}
  </ul>;
}

function CollectedRecord({ collectedAt, collectorName, evidence, receivedOn }: { collectedAt: string; collectorName: string | null; evidence: string | null; receivedOn?: string | null }) {
  return <>
    <p className="text-xs text-muted-foreground">
      {receivedOn ? <>실제 입고일 <span className="tabular-nums">{receivedOn}</span> · </> : null}
      확인 {formatOrderDateTime(collectedAt)}{collectorName ? ` · ${collectorName}` : ''}
    </p>
    <p className="break-words whitespace-pre-wrap">{evidence}</p>
  </>;
}

/* 회수 확인 폼. 묶음이 갈린 배송 건은 묶음 키(bundleId)로, 아니면 배송 건 키로 보낸다. */
function CollectionRecordForm({ bundle, claimId, claimType, label, shipmentId, waived }: {
  bundle?: AdminClaimCollectionBundle; claimId: string; claimType: OrderClaimType; label: string; shipmentId: string; waived: boolean;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOriginCollectionAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  /* 입고일 상한은 처음 그린 때의 KST 오늘이다(자정을 넘겨도 서버가 다시 판정한다). */
  const [today] = useState(() => adminClaimTodayKst());
  const scope = bundle?.bundleId ?? shipmentId;
  const restored = preservedFormValues(state, scope, { scopeKey: bundle ? 'bundleId' : 'shipmentId' });
  const evidenceId = `claim-collection-${scope}`;
  const receivedId = useId();
  return <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId, shipmentId, ...(bundle ? { bundleId: bundle.bundleId } : {}) })}>
    <input type="hidden" name="claimId" value={claimId} />
    <input type="hidden" name="claimType" value={claimType} />
    <input type="hidden" name="shipmentId" value={shipmentId} />
    {bundle ? <input type="hidden" name="bundleId" value={bundle.bundleId} /> : null}
    {waived && !bundle ? <AdminNotice tone="info">회수 생략으로 결정한 출고지입니다. 상품이 늦게 도착했을 때만 입고를 확인하세요. 재고는 바뀌지 않으니, 다시 팔 수 있으면 재고 조정에서 반영해주세요.</AdminNotice> : null}
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
    <Button className="w-fit" size="sm" type="submit" disabled={pending}>{label} {waived ? '늦은 입고 확인' : '회수 확인'}</Button>
    {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
  </form>;
}
