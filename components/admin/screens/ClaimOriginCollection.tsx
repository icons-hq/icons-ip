'use client';

import { useActionState, useId, useState } from 'react';
import { recordOrderClaimOriginCollectionAction } from '@/app/admin/claim-actions';
import { retryClaimReturnPickupAction } from '@/app/admin/claim-return-actions';
import { RETURN_PICKUP_CANCEL_REASON_LABELS, RETURN_PICKUP_STATE_LABELS, returnPickupErrorLabel, returnPickupRetryable, type AdminReturnPickup } from '@/lib/admin/claim-return-pickup';
import type { AdminClaimCollection, AdminClaimCollectionBundle } from '@/lib/admin/claims.server';
import { adminClaimReceivedOnLabel, adminClaimTodayKst } from '@/lib/admin/claims';
import { confirmAdminSubmit, type AdminConfirmRequest } from '@/lib/admin/confirm';
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
import { ClaimCarrierLossDecision } from './ClaimCarrierLossDecision';

/*
 * 출고지(배송 건) 하나의 회수 확인. 근거와 함께 실제 입고일(기본 오늘, 미래 불가)을 받는다 — 확인 버튼을 늦게 누른
 * 시각을 반환일로 대신하지 않고, 환불 기한은 모든 출고지 가운데 가장 늦은 입고일부터 센다(1027T-033).
 * 회수 생략을 결정한 배송 건(ADR-0041 — 진실원은 결정 표, 재출고 전 결정 포함)은 '회수 생략'으로 보인다. 요청이 열려 있는
 * 동안 늦게 도착한 입고를 확인할 수 있고, 재고는 바뀌지 않는다(재출고는 결정대로 회수품을 복원하지 않는다).
 * 회수 묶음(S36-040): 한 배송 건 안에서 상품별 반품지가 갈리면 반품지마다 묶음이 나뉘고, 묶음마다 입고를 확인한다. 배송 건의
 * 모든 묶음이 입고돼야 그 배송 건이 회수 완료다. 묶음이 하나면 지금까지처럼 배송 건 하나로 확인한다.
 * 반품 자동 회수 접수(QNA-032): 스위치를 켠 뒤 접수 큐에 들어간 묶음에만 접수 상태·회수 운송장이 보이고, 자동 수거 실패는 다시 접수한다.
 * 배송 분실(원장 #15): 반품의 발송된 배송 건은 택배사 사고 번호·메모·근거 사진으로 회수를 끝낼 수 있고, 기록하면 '배송 분실'로 보인다.
 * 이름(화면 규칙 4): 물건을 가져오는 일은 '회수', 창고에 도착한 것은 '입고', 돌아올 곳은 '반품지'다. 회수 확인은 되돌릴 수 없어
 * (환불 기한이 시작되고, 마지막 출고지면 고객에게 입고 알림이 간다) 대상 상품·입고일·결과를 확인창으로 한 번 보여 준다.
 */

/** 출고지의 반품 주소를 등록하는 화면(배송관리의 출고지 설정). 주소가 없는 출고지에서 바로 갈 수 있게 한다. */
const ORIGIN_SETTINGS_HREF = '/admin/settings/origins';

/**
 * 반품지 주소가 준비됐는지(DB 판정). 회수 묶음 조회가 주는 `returnAddressReady`를 상세 조회가 실어 줄 때만 값이 있다.
 * 주소 스냅샷이 비어 있어도 출고지에 반품 주소가 지금 등록돼 있으면 DB가 회수 확인 때 그 주소로 채우므로, 스냅샷이 비었다는
 * 것만으로는 잠그지 않는다 — 값을 모르면(undefined) 양식을 그대로 열고 DB가 판정한다.
 */
function returnAddressBlocked(bundle: AdminClaimCollectionBundle | null | undefined): boolean {
  return (bundle as (AdminClaimCollectionBundle & { returnAddressReady?: boolean }) | null | undefined)?.returnAddressReady === false;
}

/** 회수 확인 양식의 세 가지 쓰임: 돌아온 상품의 입고, 아직 발송 전인 배송 건의 창고 보관, 회수 생략 뒤 늦게 도착한 입고. */
export type ClaimCollectionConfirmKind = 'collect' | 'stored' | 'late';
const COLLECTION_ACTION_LABELS: Record<ClaimCollectionConfirmKind, string> = { collect: '회수 확인', stored: '창고 보관 확인', late: '늦은 입고 확인' };

/**
 * 회수 확인 확인창. 기록하면 고칠 수 없고(같은 근거의 재전송만 받는다) 환불 기한이 그 입고일부터 시작되므로,
 * 누르기 전에 대상 상품·수량·입고일과 다음에 일어나는 일을 한 번 보여 준다. 재고는 여기서 바뀌지 않는다(반품은 환불 확정, 교환은 재출고 때).
 */
export function originCollectionConfirmRequest({ label, kind, claimType, items, receivedOn }: {
  label: string; kind: ClaimCollectionConfirmKind; claimType: OrderClaimType;
  items: readonly { name: string; qty: number }[]; receivedOn: string;
}): AdminConfirmRequest {
  const goods = items.map((item) => `${item.name} ${item.qty}개`).join(', ');
  const day = receivedOn ? adminClaimReceivedOnLabel(receivedOn) : '오늘';
  const locked = '기록한 뒤에는 고치거나 되돌릴 수 없습니다.';
  if (kind === 'late') {
    return { title: `${label} 늦은 입고를 기록할까요?`, message: `${goods}를 ${day} 입고로 기록합니다.\n재고는 바뀌지 않습니다. 다시 팔 수 있으면 재고 조정에서 반영해 주세요.\n${locked}`, confirmLabel: COLLECTION_ACTION_LABELS.late, cancelLabel: '돌아가기' };
  }
  const first = kind === 'stored' ? `${goods}가 ${day}에 창고에 그대로 있는 것으로 기록합니다.` : `${goods}를 ${day} 입고로 기록합니다.`;
  const next = claimType === 'exchange'
    ? '회수를 확인한 출고지부터 재출고할 수 있습니다. 모든 출고지를 확인하면 고객에게 입고 알림이 갑니다. 재고는 재출고를 등록할 때 바뀝니다.'
    : '환불 기한은 모든 출고지 가운데 가장 늦은 입고일부터 셉니다. 모든 출고지를 확인하면 고객에게 입고 알림이 가고 환불을 처리할 수 있습니다. 재고는 환불을 확정할 때 바뀝니다.';
  return { title: `${label} ${kind === 'stored' ? '창고 보관을' : '회수를'} 확인할까요?`, message: `${first}\n${next}\n${locked}`, confirmLabel: COLLECTION_ACTION_LABELS[kind], cancelLabel: '돌아가기' };
}

export function ClaimOriginCollection({ claimId, claimType, collection, canRecord, claimRevision = null }: {
  claimId: string;
  claimType: OrderClaimType;
  collection: AdminClaimCollection;
  canRecord: boolean;
  /** 클레임 리비전. 없으면 배송 분실 기록 폼을 그리지 않는다. */
  claimRevision?: number | null;
}) {
  const waived = collection.collectionWaived === true;
  /* 효력 있는 분실 기록만 '배송 분실'로 그린다(교환 사유 정정 등으로 효력을 잃으면 DB도 싣지 않는다, 리뷰 P2). */
  const lost = waived ? collection.carrierLoss ?? null : null;
  /* 일부 발송 주문의 주문 전체 반품·교환: 아직 발송 전인 배송 건은 창고에 그대로 있는지 확인해 회수를 끝낸다(창고 보관 확인). */
  const unsent = collection.shipmentDispatched === false && !collection.collectedAt && !waived;
  const canRecordLoss = claimType === 'return' && canRecord && !collection.collectedAt && !waived && collection.shipmentDispatched === true && claimRevision !== null
    && !(collection.bundles ?? []).some((bundle) => bundle.collectedAt);
  const bundles = collection.bundles ?? [];
  const split = bundles.length > 1;
  const single = bundles.length === 1 ? bundles[0] : null;
  const singleBlocked = returnAddressBlocked(single);
  const badge = collection.collectedAt
    ? <AdminStatusBadge tone="success">입고 확인</AdminStatusBadge>
    : lost ? <AdminStatusBadge tone={statusTone('claimReshipment', 'waived')}>배송 분실</AdminStatusBadge>
    : waived ? <AdminStatusBadge tone={statusTone('claimReshipment', 'waived')}>회수 생략</AdminStatusBadge>
      : split && bundles.some((bundle) => bundle.collectedAt) ? <AdminStatusBadge tone="warning">{`일부 입고 ${bundles.filter((bundle) => bundle.collectedAt).length}/${bundles.length}`}</AdminStatusBadge>
        : <AdminStatusBadge tone="warning">입고 전</AdminStatusBadge>;
  /* 처리 칸 안의 또 다른 상자로 그리지 않는다 — 출고지 사이는 구분선과 여백으로 나눈다. */
  return <section className="flex min-w-0 flex-col gap-2 border-t pt-3 text-sm" aria-label={`${collection.originName} 회수 현황`} data-claim-origin-collection="" data-collection-waived={waived ? '' : undefined}>
    <h4 className="flex flex-wrap items-center gap-2 font-medium">{collection.originName} {badge}</h4>
    {lost ? <div className="flex flex-col gap-0.5" data-claim-carrier-loss-record="">
      <p className="text-xs text-muted-foreground">택배사 사고 번호 <span className="tabular-nums">{lost.accidentNumber}</span> · 기록 {formatOrderDateTime(lost.recordedAt)}{lost.recordedByName ? ` · ${lost.recordedByName}` : ''}</p>
      <p className="break-words whitespace-pre-wrap">{lost.reason}</p>
      <p className="text-xs text-muted-foreground">회수 없이 환불합니다. 분실 상품은 판매 재고로 되돌리지 않습니다.</p>
    </div> : null}
    {split ? <>
      <p className="text-xs text-muted-foreground">상품마다 반품지가 달라 반품지 {bundles.length}곳으로 나눠 회수합니다.</p>
      {waived ? <AdminNotice tone="info">회수 생략으로 결정한 출고지입니다. 상품이 늦게 도착했을 때만 입고를 확인하세요. 재고는 바뀌지 않으니, 다시 팔 수 있으면 재고 조정에서 반영해주세요.</AdminNotice> : null}
      {bundles.map((bundle, index) => {
        const blocked = returnAddressBlocked(bundle);
        return <div className="flex min-w-0 flex-col gap-2 border-l-2 pl-3" data-claim-collection-bundle="" key={bundle.bundleId}>
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {`반품지 ${index + 1}/${bundles.length} · ${bundle.returnName || '출고지 반품 주소'}`}
            {bundle.collectedAt ? <AdminStatusBadge tone="success">입고 확인</AdminStatusBadge> : <AdminStatusBadge tone="warning">입고 전</AdminStatusBadge>}
          </p>
          <ReturnDestination address={bundle.returnAddress} blocked={blocked} phone={bundle.returnPhone} />
          <ItemList items={bundle.items} />
          {bundle.pickup ? <ReturnPickupStatus bundleId={bundle.bundleId} canRetry={canRecord} claimId={claimId} pickup={bundle.pickup} /> : null}
          {bundle.collectedAt ? <CollectedRecord collectedAt={bundle.collectedAt} collectorName={bundle.collectorName} evidence={bundle.evidence} receivedOn={bundle.receivedOn} />
            : canRecord && !blocked ? <CollectionRecordForm bundle={bundle} claimId={claimId} claimType={claimType} items={bundle.items} label={bundle.returnName || '출고지 반품 주소'} shipmentId={collection.shipmentId} waived={waived} /> : null}
        </div>;
      })}
      {collection.collectedAt && waived ? <p className="text-xs text-muted-foreground">회수 생략으로 결정한 뒤 늦게 도착한 입고입니다. 재고는 바뀌지 않았습니다.</p> : null}
    </> : <>
      <ReturnDestination address={collection.returnAddress} blocked={singleBlocked} name={single?.returnName} phone={single?.returnPhone} />
      <ItemList items={collection.items} />
      {single?.pickup ? <ReturnPickupStatus bundleId={single.bundleId} canRetry={canRecord} claimId={claimId} pickup={single.pickup} /> : null}
      {collection.collectedAt ? <>
        <CollectedRecord collectedAt={collection.collectedAt} collectorName={collection.collectorName} evidence={collection.evidence} receivedOn={collection.receivedOn} />
        {waived ? <p className="text-xs text-muted-foreground">회수 생략으로 결정한 뒤 늦게 도착한 입고입니다. 재고는 바뀌지 않았습니다.</p> : null}
      </> : canRecord && !singleBlocked ? <>
        {unsent ? <AdminNotice tone="info">아직 발송 전인 배송 건입니다. 창고에 그대로 있는지 확인한 뒤 기록해 주세요.</AdminNotice> : null}
        <CollectionRecordForm claimId={claimId} claimType={claimType} items={collection.items} label={collection.originName} shipmentId={collection.shipmentId} unsent={unsent} waived={waived} />
      </> : null}
    </>}
    {canRecordLoss && claimRevision !== null ? <ClaimCarrierLossDecision claimId={claimId} claimRevision={claimRevision} originName={collection.originName} shipmentId={collection.shipmentId} /> : null}
  </section>;
}

/* 반품지 주소. 비어 있으면 고칠 곳(출고지의 반품 주소)으로 바로 가는 링크를 보인다. DB가 주소가 없다고 판정한 묶음은 회수 확인 양식을 열지 않는다. */
function ReturnDestination({ address, blocked = false, name, phone }: { address: string; blocked?: boolean; name?: string; phone?: string }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <p className="text-xs text-muted-foreground">반품지 주소</p>
    {address ? <p className="break-words whitespace-pre-wrap">{[name, address, phone].filter(Boolean).join(' · ')}</p>
      : <AdminNotice tone="warning">
        {blocked ? '반품지 주소가 없어 회수를 확인할 수 없습니다. ' : '반품지 주소가 비어 있습니다. 출고지에 반품 주소가 등록돼 있으면 회수를 확인할 때 그 주소로 기록합니다. '}
        <a className="underline underline-offset-4" data-claim-return-address-link="" href={ORIGIN_SETTINGS_HREF} rel="noreferrer" target="_blank">출고지 반품 주소 등록하러 가기</a>
      </AdminNotice>}
  </div>;
}

/* 회수 묶음 하나의 자동 회수 접수. 접수되면 회수 운송장, 실패하면 이유·자동 재시도와 [다시 접수], 취소되면 그 이유를 보인다. */
function ReturnPickupStatus({ bundleId, canRetry, claimId, pickup }: { bundleId: string; canRetry: boolean; claimId: string; pickup: AdminReturnPickup }) {
  const [state, action, pending] = useActionState(retryClaimReturnPickupAction, {});
  useClaimPreviewBusy(pending);
  const failed = pickup.state === 'failed' || pickup.state === 'cancel_failed';
  return <div className="flex min-w-0 flex-col gap-1" data-claim-return-pickup={pickup.state}>
    <p className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">자동 회수 접수</span>
      <AdminStatusBadge tone={statusTone('claimReturnPickup', pickup.state)}>{RETURN_PICKUP_STATE_LABELS[pickup.state]}</AdminStatusBadge>
      {pickup.trackingNumber ? <span className="tabular-nums">{pickup.carrierLabel ?? pickup.carrier} · 회수 운송장 {pickup.trackingNumber}</span> : null}
    </p>
    {pickup.requestedAt ? <p className="text-xs text-muted-foreground">접수 {formatOrderDateTime(pickup.requestedAt)}</p> : null}
    {failed ? <p className="text-xs text-destructive">
      {returnPickupErrorLabel(pickup.lastErrorCode) ?? '택배사가 받지 않았습니다'} · 자동 시도 {pickup.autoAttempts}/{pickup.maxAttempts}회
      {pickup.nextAttemptAt ? ` · 다음 자동 시도 ${formatOrderDateTime(pickup.nextAttemptAt)}` : ' · 자동 재시도 끝'}
    </p> : null}
    {/* 이름표에 없는 취소 사유는 내부 값 그대로 내보이지 않는다(화면 규칙 8). */}
    {pickup.state === 'canceled' && pickup.cancelReason ? <p className="text-xs text-muted-foreground">수거 취소 · {RETURN_PICKUP_CANCEL_REASON_LABELS[pickup.cancelReason] ?? '사유 확인 필요'}</p> : null}
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
      {receivedOn ? <>실제 입고일 <span className="tabular-nums">{adminClaimReceivedOnLabel(receivedOn)}</span> · </> : null}
      확인 {formatOrderDateTime(collectedAt)}{collectorName ? ` · ${collectorName}` : ''}
    </p>
    <p className="break-words whitespace-pre-wrap">{evidence}</p>
  </>;
}

/* 회수 확인 폼. 묶음이 갈린 배송 건은 묶음 키(bundleId)로, 아니면 배송 건 키로 보낸다. 근거 글은 DB가 요구해 필수로 남긴다(회수 기록에 남고 이 칸에 다시 보인다). */
function CollectionRecordForm({ bundle, claimId, claimType, items, label, shipmentId, unsent = false, waived }: {
  bundle?: AdminClaimCollectionBundle; claimId: string; claimType: OrderClaimType; items: AdminClaimCollection['items']; label: string; shipmentId: string; unsent?: boolean; waived: boolean;
}) {
  const [state, action, pending] = useActionState(recordOrderClaimOriginCollectionAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  /* 입고일 상한은 처음 그린 때의 KST 오늘이다(자정을 넘겨도 서버가 다시 판정한다). */
  const [today] = useState(() => adminClaimTodayKst());
  const scope = bundle?.bundleId ?? shipmentId;
  const restored = preservedFormValues(state, scope, { scopeKey: bundle ? 'bundleId' : 'shipmentId' });
  const evidenceId = `claim-collection-${scope}`;
  const receivedId = useId();
  const kind: ClaimCollectionConfirmKind = waived ? 'late' : unsent ? 'stored' : 'collect';
  const actionLabel = COLLECTION_ACTION_LABELS[kind];
  return <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId, shipmentId, ...(bundle ? { bundleId: bundle.bundleId } : {}) })}
    onSubmit={(event) => { confirmAdminSubmit(event, originCollectionConfirmRequest({ label, kind, claimType, items, receivedOn: String(new FormData(event.currentTarget).get('receivedOn') ?? '') })); }}>
    <input type="hidden" name="claimId" value={claimId} />
    <input type="hidden" name="claimType" value={claimType} />
    <input type="hidden" name="shipmentId" value={shipmentId} />
    {bundle ? <input type="hidden" name="bundleId" value={bundle.bundleId} /> : null}
    {waived && !bundle ? <AdminNotice tone="info">회수 생략으로 결정한 출고지입니다. 상품이 늦게 도착했을 때만 입고를 확인하세요. 재고는 바뀌지 않으니, 다시 팔 수 있으면 재고 조정에서 반영해주세요.</AdminNotice> : null}
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={receivedId}>{kind === 'stored' ? '창고 보관을 확인한 날' : '실제 입고일'}</Label>
      <Input className="w-full sm:w-44" defaultValue={restored?.claimId === claimId && typeof restored.receivedOn === 'string' ? restored.receivedOn : today}
        disabled={pending} id={receivedId} max={today} name="receivedOn" required type="date" />
      {claimType !== 'exchange' && kind !== 'late' ? <p className="text-xs text-muted-foreground">환불 기한은 가장 늦은 입고일부터 셉니다.</p> : null}
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={evidenceId}>{actionLabel} 근거 (필수)</Label>
      <Textarea id={evidenceId} name="evidence" required maxLength={500} rows={3}
        defaultValue={restored?.claimId === claimId ? restored.evidence : ''}
        placeholder={unsent ? '예: 창고 회신 — 출고 전 보관 중, 수량 2개 맞음' : '예: 창고 회신 G-001, 돌아온 상품과 수량 2개 맞음'} disabled={pending} />
      <p className="text-xs text-muted-foreground">이 출고지의 회수 기록에 남습니다. 고객에게는 보이지 않습니다.</p>
    </div>
    <Button className="w-fit" size="sm" type="submit" disabled={pending}>{label} {actionLabel}</Button>
    {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
  </form>;
}
