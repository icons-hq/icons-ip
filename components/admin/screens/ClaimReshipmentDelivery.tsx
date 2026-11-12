'use client';

import { useActionState } from 'react';
import { recordOrderClaimReshipmentDeliveryAction } from '@/app/admin/claim-actions';
import type { AdminClaimDetail, AdminClaimReshipment, AdminClaimReshipmentTarget } from '@/lib/admin/claims.server';
import { claimEvidenceUrl } from '@/lib/admin/claim-evidence';
import { adminClaimReshipmentProgress, adminClaimShipmentPartiallyReceived, adminClaimWaiverDecisions } from '@/lib/admin/claim-reshipments';
import { ClaimCollectionWaiverDecision } from './ClaimCollectionWaiverDecision';
import { adminFormRemountKey, preservedFormValues } from '@/lib/admin/form-state';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { formatOrderDateTime } from '@/lib/orders';
import { orderShipment, type ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { useClaimPreviewBusy } from './ClaimPreviewDialog';

/* 교환 재출고·교환품 배송완료 확인(TKT-166·QNA-039).
 *
 * 재출고는 배송 건(출고지)마다 기록하고, 배송완료도 송장마다 확인한다. 배송 건 기록이 없는 교환은 이 기능
 * 전의 클레임 단위 기록(택배사·운송장 한 쌍)이라 예전 모양 그대로 확인한다. 재출고 등록 자체는 최종 주소
 * 확인(회수·재배송 연락처 처리)에서 한다 — 여기서는 기록과 도착 확인만 다룬다. */

type Claim = AdminClaimDetail['claim'];

function DeliveryForm({ claimId, shipmentKey, label }: { claimId: string; shipmentKey: string | null; label: string }) {
  const [state, action, pending] = useActionState(recordOrderClaimReshipmentDeliveryAction, {});
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const restored = preservedFormValues(state, claimId, { scopeKey: 'claimId' });
  const fieldId = `claim-reship-delivery-evidence-${shipmentKey ?? 'claim'}`;
  return <form action={action} className="flex min-w-0 flex-col gap-3" key={adminFormRemountKey(state, { claimId, shipmentKey })}>
    <input type="hidden" name="claimId" value={claimId} />
    {shipmentKey !== null ? <input type="hidden" name="reshipmentShipment" value={shipmentKey} /> : null}
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea id={fieldId} name="evidence" required maxLength={500} rows={3}
        defaultValue={restored?.evidence ?? ''} disabled={pending}
        placeholder="택배사 배송 조회 또는 고객의 전체 수령 확인" />
    </div>
    <Button className="w-fit" size="sm" type="submit" disabled={pending}>교환품 배송완료 확인</Button>
    {state.error ? <p className="text-destructive" role="alert">{adminClaimCopy(state.error)}</p> : null}
    {state.message ? <p className="text-muted-foreground" role="status">{adminClaimCopy(state.message)}</p> : null}
  </form>;
}

function Tracking({ row, carriers }: { row: AdminClaimReshipment; carriers?: ShippingCarrierRegistry }) {
  const tracking = carriers ? orderShipment(carriers, row.carrier, row.trackingNumber) : null;
  const text = `${row.carrierLabel ?? row.carrier} ${row.trackingNumber}`;
  return tracking ? <a className="tabular-nums underline underline-offset-4" href={tracking.trackingUrl} rel="noreferrer" target="_blank">{text}</a>
    : <span className="tabular-nums">{text}</span>;
}

/** 회수 생략 사유·근거 사진(운영자만 본다). 재출고한 배송 건과, 재출고 전에 회수 생략을 결정한 배송 건이 같은 모양이다. */
function WaiverRecord({ caption, reason, evidence }: { caption: string; reason: string | null; evidence: readonly { id: string }[] }) {
  return <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/50 px-3 py-2" data-claim-collection-waiver-record="">
    <p className="text-xs font-medium text-muted-foreground">{caption}</p>
    <p className="break-words whitespace-pre-wrap">{reason}</p>
    {evidence.length ? <p className="flex flex-wrap gap-x-3 gap-y-1">{evidence.map((file, index) => <a className="underline underline-offset-4"
      href={claimEvidenceUrl(file.id)} key={file.id} rel="noreferrer" target="_blank">근거 사진 {index + 1}</a>)}</p> : null}
  </div>;
}

const PARTIAL_RECEIPT = '이 출고지의 일부 반품지에서 이미 입고가 확인되어 회수 생략을 할 수 없습니다. 남은 반품지의 입고를 확인하고, 도착하지 않으면 고객에게 확인한 뒤 판단하세요.';
const PRODUCTION_WAIT = '주문제작 상품의 교환품 제작이 끝나면 재출고할 수 있습니다. 제작 시작·완료는 주문 상세의 주문제작 처리에서 기록합니다.';

/** 아직 재출고하지 않은 배송 건: 회수 확인·회수 생략 결정·교환품 제작 대기 중 지금 무엇을 기다리는지 보인다. */
function PendingTarget({ claim, target, name, decide }: { claim: Claim; target: AdminClaimReshipmentTarget; name: string; decide: boolean }) {
  const collected = target.collectionTracked ? target.collectedAt !== null : claim.stage === 'collected';
  const waiting = target.productionPending && (collected || target.waiver !== null);
  const guide = waiting ? PRODUCTION_WAIT
    : target.waiver ? '회수·재배송 연락처 처리에서 회수 없이 재출고를 등록합니다.'
      : !target.collectionTracked ? '입고 확인 뒤 회수·재배송 연락처 처리에서 재출고를 등록합니다.'
        : target.collectedAt ? `회수 확인 ${formatOrderDateTime(target.collectedAt)} · 회수·재배송 연락처 처리에서 재출고를 등록합니다.`
          : claim.collectionWaiverAllowed && adminClaimShipmentPartiallyReceived(claim, target.shipmentId) ? PARTIAL_RECEIPT
          : !claim.collectionWaiverAllowed ? '회수 확인 전입니다. 회수를 확인한 뒤 재출고합니다.'
            : target.productionRequired ? '회수 확인 전입니다. 주문제작 상품은 교환품을 새로 만들어야 해서, 회수 없이 보내려면 아래에서 회수 생략을 먼저 기록해 제작을 시작합니다.'
              : '회수 확인 전입니다. 하자·오배송 교환이라 회수 없이 재출고할 수도 있습니다.';
  return <>
    {target.waiver ? <WaiverRecord caption={`회수 생략 결정 · ${formatOrderDateTime(target.waiver.waivedAt)}${target.waiver.waivedByName ? ` · ${target.waiver.waivedByName}` : ''} · 회수 상품 재고는 복원하지 않습니다`}
      evidence={target.waiver.evidence} reason={target.waiver.reason} /> : null}
    <p className="text-muted-foreground">{guide}</p>
    {decide && target.shipmentId ? <ClaimCollectionWaiverDecision claimId={claim.id} originName={name} shipmentId={target.shipmentId} /> : null}
  </>;
}

function ShipmentReshipments({ claim, carriers }: { claim: Claim; carriers?: ShippingCarrierRegistry }) {
  const rows = claim.reshipments ?? [];
  const targets = claim.reshipmentTargets ?? [];
  const progress = adminClaimReshipmentProgress(claim);
  const decisions = new Set(adminClaimWaiverDecisions(claim).map(target => target.shipmentId));
  const keyOf = (shipmentId: string | null) => shipmentId ?? 'order';
  /* 대상 배송 건 순서대로 그리고, 대상 목록에 없는 기록(있어서는 안 되지만)은 뒤에 붙인다. */
  const entries = [
    ...targets.map(target => ({ key: keyOf(target.shipmentId), target, row: rows.find(row => row.shipmentId === target.shipmentId) ?? null })),
    ...rows.filter(row => !targets.some(target => target.shipmentId === row.shipmentId)).map(row => ({ key: keyOf(row.shipmentId), target: null, row })),
  ];
  return <section className="flex min-w-0 flex-col gap-3 border-t pt-4 text-sm" aria-label="출고지별 재출고" data-claim-reshipments="">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-base leading-snug font-medium">출고지별 재출고</h3>
      <p className="text-muted-foreground tabular-nums">재출고 {progress.reshipped}/{progress.total} · 배송완료 확인 {progress.delivered}/{progress.total}</p>
    </div>
    <ul className="flex min-w-0 flex-col gap-3">
      {entries.map(({ key, target, row }) => {
        const name = row?.originName ?? target?.originName ?? '주문 전체';
        const collected = target ? (target.collectionTracked ? target.collectedAt !== null : claim.stage === 'collected') : false;
        const productionWait = !row && target !== null && target.productionPending && (collected || target.waiver !== null);
        const state = row ? (row.deliveredAt ? 'delivered' : 'reshipped') : productionWait ? 'production' : 'pending';
        return <li className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-claim-reshipment={key} key={key}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="font-medium">{name}</strong>
            <AdminStatusBadge tone={statusTone('claimReshipment', state)}>
              {{ delivered: '배송완료 확인', reshipped: '재출고됨', production: '제작 대기', pending: '재출고 대기' }[state]}</AdminStatusBadge>
            {row?.collectionWaived || (!row && target?.waiver) ? <AdminStatusBadge tone={statusTone('claimReshipment', 'waived')}>회수 생략</AdminStatusBadge> : null}
          </div>
          {row ? <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="text-muted-foreground">재출고 운송장</span><Tracking row={row} carriers={carriers} />
              <span className="text-muted-foreground">· <time dateTime={row.reshippedAt}>{formatOrderDateTime(row.reshippedAt)}</time>{row.reshippedByName ? ` · ${row.reshippedByName}` : ''}</span></p>
            {row.items.length ? <ul className="flex flex-col gap-0.5 text-muted-foreground">{row.items.map(item => <li className="break-words" key={item.orderItemId}>
              {item.name} · {item.variantName} · {item.variantCode} · {item.qty}개</li>)}</ul> : null}
            {row.collectionWaived ? <WaiverRecord caption="회수 생략 사유 · 회수 상품 재고는 복원하지 않았습니다" evidence={row.waiverEvidence} reason={row.waiverReason} /> : null}
            {row.deliveredAt ? <p className="text-muted-foreground"><time dateTime={row.deliveredAt}>{formatOrderDateTime(row.deliveredAt)}</time>
              {row.deliveredByName ? ` · ${row.deliveredByName}` : ''} · <span className="break-words whitespace-pre-wrap text-foreground">{row.deliveryEvidence}</span></p>
              : <DeliveryForm claimId={claim.id} label={`${name} 배송완료 확인 근거`} shipmentKey={key} />}
          </> : target ? <PendingTarget claim={claim} decide={decisions.has(target.shipmentId)} name={name} target={target} /> : null}
        </li>;
      })}
    </ul>
    {progress.total > 1 && progress.reshipped < progress.total && progress.reshipped > 0 ? <p className="text-muted-foreground">모든 출고지를 재출고하면 교환이 종결됩니다. 먼저 보낸 송장은 고객 주문 상세에 바로 보입니다.</p> : null}
  </section>;
}

function LegacyReshipmentDelivery({ claim }: { claim: Claim }) {
  const canConfirm = claim.stage === 'completed' && Boolean(claim.reshipCarrier && claim.reshippedAt);
  return <section className="flex min-w-0 flex-col gap-3 border-t pt-4 text-sm" aria-label="교환품 배송완료 확인" data-claim-reship-delivery="">
    <h3 className="text-base leading-snug font-medium">교환품 배송완료 확인</h3>
    {claim.reshipDeliveredAt ? <>
      <p><time dateTime={claim.reshipDeliveredAt}>{formatOrderDateTime(claim.reshipDeliveredAt)}</time>
        {claim.reshipDeliveredByName ? ` · ${claim.reshipDeliveredByName}` : ''}</p>
      <p className="break-words whitespace-pre-wrap">{claim.reshipDeliveryEvidence}</p>
    </> : canConfirm ? <>
      <p className="text-muted-foreground">모든 교환품이 실제로 도착했는지 확인해주세요. 확인 전에는 새 반품·교환 신청이 열리지 않습니다.</p>
      <DeliveryForm claimId={claim.id} label="배송완료 확인 근거" shipmentKey={null} />
    </> : <p className="text-muted-foreground">재출고 이력을 확인한 뒤 배송완료를 기록해주세요.</p>}
  </section>;
}

export function ClaimReshipmentDelivery({ claim, carriers }: { claim: Claim; carriers?: ShippingCarrierRegistry }) {
  if (claim.claimType !== 'exchange') return null;
  /* 배송 건 기록이 있거나(새 모델), 승인 뒤 재출고 대상 배송 건이 정해진 교환은 출고지별로 그린다. */
  if ((claim.reshipments ?? []).length > 0) return <ShipmentReshipments claim={claim} carriers={carriers} />;
  if (claim.reshipTrackingNumber) return <LegacyReshipmentDelivery claim={claim} />;
  if ((claim.reshipmentTargets ?? []).length > 0 && (claim.stage === 'collecting' || claim.stage === 'collected')) return <ShipmentReshipments claim={claim} carriers={carriers} />;
  return null;
}
