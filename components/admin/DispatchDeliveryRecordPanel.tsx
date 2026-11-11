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
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { formatOrderDateTime } from '@/lib/orders';
import { statusTone } from '@/lib/admin/status-tone';
import {
  DELIVERY_METHOD_LABELS, DELIVERY_OPERATIONS, deliveryIsHandoff, deliveryStatusLabel,
  type DeliveryHistory, type DeliveryMethod, type DeliveryOperation,
} from '@/lib/shipment-delivery';

/*
 * 발주(주문)확인/발송관리·배송현황 관리에서 택배 외 배송(퀵·방문수령·직접배송·화물·직접전달)의 실제 인계·수령을 기록하는 팝업(1014-084).
 * 주문 상세 없이 출고 전용 권한으로 연다. 배송 방식 변경(고객 요청·배송비 동의)은 주문 상세의 배송 방식·인계 확인에 남는다.
 * 템플릿 룩(ADR-0028) kit 부품만 쓴다.
 */
const OPERATION_LABELS: Record<DeliveryOperation, string> = {
  quick_handoff: '퀵 인계', quick_receive: '퀵 수령 완료', pickup_receive: '방문수령 완료', direct_handoff: '직접배송 인계',
  direct_receive: '직접배송 수령 완료', freight_handoff: '화물배송 인계', freight_receive: '화물배송 수령 완료', none_receive: '직접전달 완료',
};
const EVIDENCE_LABELS: Record<string, string> = {
  operatorName: '실제 인계·확인 담당자', providerName: '배송 업체·담당', providerPhone: '배송 연락처', handoffReference: '인계 참조', receiptReference: '수령 확인 근거',
};
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

function RecordForm({ shipment, kind, onSaved }: { shipment: DispatchShipmentDelivery; kind: DeliveryOperation; onSaved: (message: string) => void }) {
  const [occurredAt, setOccurredAt] = useState(''); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null); const busy = useRef(false); const fieldId = useId();
  const handoff = deliveryIsHandoff(kind);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget); requestId.current ??= crypto.randomUUID(); form.set('operationId', requestId.current);
    busy.current = true; setError(null);
    startTransition(async () => {
      try { const result = await recordDispatchShipmentDeliveryAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('인계·수령 처리 결과를 확인하지 못했습니다. 같은 내용으로 재시도하거나 새로고침해주세요.'); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className="flex w-full flex-col items-start gap-2.5 border-t pt-3">
    <h3 className="text-sm font-medium text-foreground">{OPERATION_LABELS[kind]} 기록</h3>
    <input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} /><input type="hidden" name="kind" value={kind} />
    <fieldset disabled={pending || !shipment.preorderReady} className={FIELDSET_CLASS}>
      <legend className="sr-only">실제 인계·수령 증거</legend>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 인계·확인 담당자</span><Input name="operatorName" maxLength={100} required /></label>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 {handoff ? '인계' : '수령'} 시각 (한국)</span><Input type="datetime-local" name="occurredAt" step="0.001" value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)} required /></label>
      <Button variant="outline" size="sm" type="button" onClick={() => setOccurredAt(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 23))}>현재 시각 입력</Button>
      {handoff ? <>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 배송 업체·담당</span><Input name="providerName" maxLength={100} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>배송 담당 연락처</span><Input name="providerPhone" type="tel" maxLength={40} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 인계 참조·근거</span><Textarea name="handoffReference" rows={2} maxLength={2000} required /></label>
      </> : <>
        <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-recipient`}>수령인 구분</Label><NativeSelect className="w-full" id={`${fieldId}-recipient`} name="recipientKind" defaultValue="" required><option value="" disabled>수령인을 확인해주세요</option>
          <option value="self">주문자 본인</option>{shipment.summary.policy?.allowDelegate ? <option value="delegate">허용된 대리수령인</option> : null}</NativeSelect></div>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>수령 확인 기록·근거</span><Textarea name="receiptReference" rows={2} maxLength={2000} required /></label>
        <label className={FIELD_CLASS}><span className={LABEL_TEXT}>주문자가 제시한 일회 수령 확인값</span><Input name="receiptCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} required /></label>
        <small className={NOTE_CLASS}>주문자는 주문 화면에서 10분 동안 유효한 확인값을 발급합니다. 5회 틀리거나 재발급하면 이전 값은 사용할 수 없습니다.</small>
      </>}
    </fieldset>
    {!shipment.preorderReady ? <AdminNotice role="status" tone="warning">예약 품목에 실제 입고 물량이 할당된 뒤 기록할 수 있습니다.</AdminNotice> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <Button type="submit" disabled={pending || !shipment.preorderReady}>{pending ? '확인 중…' : handoff ? '배송 인계 확인' : '수령 완료 확인'}</Button>
  </form>;
}

function RecordPanel({ shipmentId }: { shipmentId: string }) {
  const [refresh, setRefresh] = useState(0); const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; shipment?: DispatchShipmentDelivery; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readDispatchShipmentDeliveryAction(shipmentId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, shipment: result.shipment } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '배송 인계 정보를 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId]);
  const visible = loaded?.key === key ? loaded : null; const shipment = visible?.shipment;
  const kind = shipment ? dispatchDeliveryOperation(shipment.summary.method, shipment.status) : null;
  const history = shipment ? dispatchDeliveryHistory(shipment.history) : [];
  const saved = (text: string) => { setNotice(text); setRefresh((value) => value + 1); };
  return <div className="flex min-w-0 flex-col items-start gap-3 text-sm leading-relaxed">
    {notice ? <AdminNotice role="status" tone="success">{notice}</AdminNotice> : null}
    {!visible ? <p className="text-muted-foreground" role="status">배송 인계 정보를 불러오는 중입니다…</p> : visible.error ? <p className="text-destructive" role="alert">{visible.error}</p> : shipment ? <>
      <p className="flex flex-wrap items-center gap-2">{DELIVERY_METHOD_LABELS[shipment.summary.method]} <AdminStatusBadge tone={statusTone('shipment', shipment.status)}>{deliveryStatusLabel(shipment.summary.method, shipment.status)}</AdminStatusBadge></p>
      {shipment.summary.policy ? <p className="whitespace-pre-wrap text-muted-foreground">저장된 인계 조건: {shipment.summary.policy.handoffLocation}<br />
        {shipment.summary.policy.handoffInstructions}<br />{shipment.summary.policy.completionInstructions}</p> : null}
      {shipment.canTransition && kind ? <RecordForm key={`record-${shipment.updatedAt}`} shipment={shipment} kind={kind} onSaved={saved} />
        : <AdminNotice role="status" tone="neutral">지금 기록할 인계·수령이 없습니다. 발주확인 전이거나 취소 요청이 열려 있으면 기록할 수 없고, 택배는 운송장으로 발송합니다.</AdminNotice>}
      {history.length ? <details className="w-full rounded-lg border px-3 py-2.5"><summary className="cursor-pointer text-sm font-medium">인계·수령 이력 {history.length}건</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5">{history.map((row) => <li key={row.id}>
          <strong className="font-medium">{OPERATION_LABELS[row.kind as DeliveryOperation]}</strong> · {formatOrderDateTime(row.recordedAt)} · {row.actorName ?? '운영자'}
          <dl className="mt-2 grid gap-2">
            {Object.entries(EVIDENCE_LABELS).filter(([field]) => typeof row.evidence[field] === 'string').map(([field, label]) => <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3" key={field}><dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{String(row.evidence[field])}</dd></div>)}
            {typeof row.evidence.occurredAt === 'string' ? <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3"><dt className="text-muted-foreground">실제 인계·수령 시각</dt><dd className="min-w-0">{formatOrderDateTime(row.evidence.occurredAt)}</dd></div> : null}
          </dl>
        </li>)}</ol>
      </details> : null}
    </> : null}
    <Button variant="outline" size="sm" type="button" onClick={() => setRefresh((value) => value + 1)}>인계 정보 새로고침</Button>
  </div>;
}

/**
 * 목록 칸에 놓는 입구. 누르면 그 배송 건의 인계·수령 기록 팝업이 열린다.
 * 붙일 자리: 발주·발송과 배송현황 목록의 택배 외 행 '…인계·수령 확인' 칸(components/admin/screens/ShipmentConsoleScreen.tsx).
 */
export function DispatchDeliveryRecordButton({ shipmentId, shipmentNumber, label }: { shipmentId: string; shipmentNumber?: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button className="h-auto p-0" size="sm" type="button" variant="link" aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</Button>
    {open ? <CustomerServiceDialog title={`택배 외 인계·수령 기록 · 배송 건 ${commerceReferenceLabel(shipmentId, shipmentNumber ?? undefined)}`} onClose={() => setOpen(false)}>
      <div className="overflow-y-auto px-4 py-3"><RecordPanel shipmentId={shipmentId} /></div>
    </CustomerServiceDialog> : null}
  </>;
}
