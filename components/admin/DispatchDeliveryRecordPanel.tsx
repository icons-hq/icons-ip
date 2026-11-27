'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { readDispatchShipmentDeliveryAction, recordDispatchShipmentDeliveryAction, type DispatchShipmentDelivery } from '@/app/admin/dispatch-delivery-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { adminConfirm } from '@/lib/admin/confirm';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { formatOrderDateTime } from '@/lib/orders';
import {
  DELIVERY_RECORD_FORM_COPY as RECORD_COPY, DELIVERY_RECORD_LABELS, deliveryHistoryRows, deliveryNowLocal, deliveryRecordBlockReason,
  deliveryRecordConfirmRequest, deliveryRecordFormCopy,
} from '@/lib/admin/shipment-delivery-panel';
import { adminDeliveryStatusLabel } from '@/lib/admin/shipment-status-labels';
import { statusTone } from '@/lib/admin/status-tone';
import {
  DELIVERY_METHOD_LABELS, DELIVERY_OPERATIONS, deliveryIsHandoff,
  type DeliveryHistory, type DeliveryMethod, type DeliveryOperation,
} from '@/lib/shipment-delivery';

/*
 * 발주(주문)확인/발송관리·배송현황 관리에서 택배 외 배송(퀵·방문수령·직접배송·화물·직접전달)의 실제 인계·수령을 기록하는 팝업(1014-084).
 * 주문 상세 없이 출고 전용 권한으로 연다 — 주문 상세를 열 수 없는 출고 전용 계정에게는 이 창이 유일한 길이다.
 * 하는 일은 주문 상세의 인계·수령 기록(ShipmentDeliveryPanel의 HandoffForm)과 같아(배송중·배송완료로 바뀌고 고객 앱 알림이 가며,
 * 배송완료는 청약철회·거래확정 기한이 시작된다) 칸 이름·시각의 처음 값·확인창·버튼 이름·상태 이름을 같은 곳(lib/admin/shipment-delivery-panel,
 * lib/admin/shipment-status-labels)에서 가져온다. 배송 방식 변경(고객 요청·배송비 동의)은 주문 상세의 배송 방식·인계 확인에 남는다.
 * 템플릿 룩(ADR-0028) kit 부품만 쓴다.
 */
const FIELDSET_CLASS = 'm-0 flex w-full min-w-0 flex-col gap-2.5 border-0 p-0';
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';
const LABEL_TEXT = 'text-sm font-medium';
const NOTE_CLASS = 'text-xs text-muted-foreground';

/** 지금 상태에서 남길 기록. 퀵·직접배송·화물은 인계 뒤 수령, 방문수령·직접전달은 수령 한 번이다. 택배·디지털은 이 팝업의 일이 아니다. */
export function dispatchDeliveryOperation(method: DeliveryMethod, status: DispatchShipmentDelivery['status']): DeliveryOperation | null {
  if (method === 'pickup' || method === 'none') return status === 'ready' ? `${method}_receive` : null;
  if (method === 'quick' || method === 'direct' || method === 'freight') {
    return status === 'ready' ? `${method}_handoff` : status === 'shipping' ? `${method}_receive` : null;
  }
  return null;
}

/** 출고 기록은 실제 인계·수령 이력만 보여 준다. 배송 방식 변경 이력(고객 요청·배송비 동의)은 주문 상세에서 본다. */
export function dispatchDeliveryHistory(history: readonly DeliveryHistory[]): DeliveryHistory[] {
  return history.filter((row) => (DELIVERY_OPERATIONS as readonly string[]).includes(row.kind));
}

/** 인계·수령 기록 양식. 기록하면 배송 건 상태가 바뀌어(배송중·배송완료) 주문 상세의 같은 기록과 같은 확인창을 거친다. */
export function DispatchDeliveryRecordForm({ shipment, kind, reference, onSaved }: { shipment: DispatchShipmentDelivery; kind: DeliveryOperation; reference: string; onSaved: (message: string) => void }) {
  const handoff = deliveryIsHandoff(kind);
  const copy = deliveryRecordFormCopy(kind);
  /* 시각의 처음 값은 지금이다 — 대부분 넘긴 자리에서 바로 기록한다. */
  const [occurredAt, setOccurredAt] = useState(() => deliveryNowLocal()); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null); const busy = useRef(false); const fieldId = useId();
  const delegateAllowed = Boolean(shipment.summary.policy?.allowDelegate);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget);
    busy.current = true; setError(null);
    /* 확인창은 전환(startTransition) 밖에서 먼저 받는다. 띄우지 못하면 보내지 않고 양식을 다시 연다. */
    const confirmed = await adminConfirm(deliveryRecordConfirmRequest({ kind, reference, providerName: String(form.get('providerName') ?? '').trim() || undefined })).catch(() => false);
    if (!confirmed) { busy.current = false; return; }
    requestId.current ??= crypto.randomUUID(); form.set('operationId', requestId.current);
    startTransition(async () => {
      try { const result = await recordDispatchShipmentDeliveryAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError(RECORD_COPY.uncertain); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className="flex w-full flex-col items-start gap-2.5 border-t pt-3">
    <h3 className="text-sm font-medium text-foreground">{copy.heading}</h3>
    <input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} /><input type="hidden" name="kind" value={kind} />
    <fieldset disabled={pending || !shipment.preorderReady} className={FIELDSET_CLASS}>
      <legend className="sr-only">{copy.legend}</legend>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{copy.operator}</span><Input name="operatorName" maxLength={100} placeholder={copy.operatorPlaceholder} required /></label>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-occurred`}>{copy.occurredAt}</Label>
        <Input className="w-auto self-start" id={`${fieldId}-occurred`} type="datetime-local" name="occurredAt" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></div>
      {handoff ? <>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{RECORD_COPY.providerName}</span><Input name="providerName" maxLength={100} placeholder={RECORD_COPY.providerNamePlaceholder} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{RECORD_COPY.providerPhone}</span><Input name="providerPhone" type="tel" maxLength={40} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{RECORD_COPY.handoffReference}</span><Textarea name="handoffReference" rows={2} maxLength={2000} placeholder={RECORD_COPY.handoffReferencePlaceholder} required /></label>
      </> : <>
        <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-recipient`}>{RECORD_COPY.recipientKind}</Label>
          <NativeSelect className="w-full" id={`${fieldId}-recipient`} name="recipientKind" defaultValue={delegateAllowed ? '' : 'self'} required>
            {delegateAllowed ? <option value="" disabled>{RECORD_COPY.recipientUnchosen}</option> : null}
            <option value="self">{RECORD_COPY.recipientSelf}</option>{delegateAllowed ? <option value="delegate">{RECORD_COPY.recipientDelegate}</option> : null}
          </NativeSelect></div>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{RECORD_COPY.receiptReference}</span><Textarea name="receiptReference" rows={2} maxLength={2000} placeholder={RECORD_COPY.receiptReferencePlaceholder} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>{RECORD_COPY.receiptCode}</span><Input name="receiptCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} required />
          <span className={NOTE_CLASS}>{RECORD_COPY.receiptCodeNote}</span></label>
      </>}
    </fieldset>
    {!shipment.preorderReady ? <AdminNotice role="status" tone="warning">{RECORD_COPY.preorderBlocked}</AdminNotice> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button type="submit" disabled={pending || !shipment.preorderReady}>{pending ? RECORD_COPY.pending : copy.submit}</Button>
  </form>;
}

function RecordPanel({ shipmentId, reference }: { shipmentId: string; reference: string }) {
  const [refresh, setRefresh] = useState(0); const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; shipment?: DispatchShipmentDelivery; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readDispatchShipmentDeliveryAction(shipmentId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, shipment: result.shipment } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '인계·수령 정보를 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId]);
  const visible = loaded?.key === key ? loaded : null; const shipment = visible?.shipment;
  const kind = shipment ? dispatchDeliveryOperation(shipment.summary.method, shipment.status) : null;
  const history = shipment ? dispatchDeliveryHistory(shipment.history) : [];
  const saved = (text: string) => { setNotice(text); setRefresh((value) => value + 1); };
  /* 퀵·직접배송·화물배송의 상태 이름은 '퀵 배송중'처럼 방식 이름으로 시작한다 — 방식 이름을 따로 한 번 더 적지 않는다(주문 상세와 같다). */
  const methodPrefixed = shipment ? ['quick', 'direct', 'freight'].includes(shipment.summary.method) : false;
  return <div className="flex min-w-0 flex-col items-start gap-3 text-sm leading-relaxed">
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    {!visible ? <p className="text-muted-foreground" role="status">인계·수령 정보를 불러오는 중입니다…</p> : visible.error ? <p className="text-destructive" role="alert">{visible.error}</p> : shipment ? <>
      <p className="flex flex-wrap items-center gap-2">{methodPrefixed ? null : <>{DELIVERY_METHOD_LABELS[shipment.summary.method]} </>}
        <AdminStatusBadge tone={statusTone('shipment', shipment.status)}>{adminDeliveryStatusLabel(shipment.summary.method, shipment.status)}</AdminStatusBadge></p>
      {shipment.summary.policy ? <p className="whitespace-pre-wrap text-muted-foreground">저장된 인계 조건: {shipment.summary.policy.handoffLocation}<br />
        {shipment.summary.policy.handoffInstructions}<br />{shipment.summary.policy.completionInstructions}</p> : null}
      {shipment.canTransition && kind ? <DispatchDeliveryRecordForm key={`record-${shipment.updatedAt}`} shipment={shipment} kind={kind} reference={reference} onSaved={saved} />
        : <AdminNotice role="status" tone="neutral">{deliveryRecordBlockReason(shipment) ?? '지금 기록할 인계·수령이 없습니다. 이미 기록이 끝났거나 이 창에서 기록하지 않는 배송 방식입니다.'}</AdminNotice>}
      {history.length ? <details className="w-full rounded-lg border px-3 py-2.5"><summary className="cursor-pointer text-sm font-medium">인계·수령 이력 {history.length}건</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5">{history.map((row) => <li key={row.id}>
          <strong className="font-medium">{DELIVERY_RECORD_LABELS[row.kind]}</strong> · {formatOrderDateTime(row.recordedAt)} · {row.actorName ?? '운영자'}
          <dl className="mt-2 grid gap-2">
            {deliveryHistoryRows(row.kind, row.evidence).map((item) => <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3" key={item.label}><dt className="text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{item.time ? formatOrderDateTime(item.value) : item.value}</dd></div>)}
          </dl>
        </li>)}</ol>
      </details> : null}
    </> : null}
    <Button variant="outline" size="sm" type="button" onClick={() => setRefresh((value) => value + 1)}>새로고침</Button>
  </div>;
}

/**
 * 목록 칸에 놓는 입구. 누르면 그 배송 건의 인계·수령 기록 팝업이 열린다.
 * 붙일 자리: 발주·발송과 배송현황 목록의 택배 외 행 '…인계·수령 확인' 칸(components/admin/screens/ShipmentConsoleScreen.tsx).
 */
export function DispatchDeliveryRecordButton({ shipmentId, shipmentNumber, label }: { shipmentId: string; shipmentNumber?: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  const reference = commerceReferenceLabel(shipmentId, shipmentNumber ?? undefined);
  return <>
    <Button className="h-auto p-0" size="sm" type="button" variant="link" aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</Button>
    {open ? <CustomerServiceDialog title={`택배 외 인계·수령 기록 · 배송 건 ${reference}`} onClose={() => setOpen(false)}>
      <div className="overflow-y-auto px-4 py-3"><RecordPanel shipmentId={shipmentId} reference={reference} /></div>
    </CustomerServiceDialog> : null}
  </>;
}
