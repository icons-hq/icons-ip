'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { readShipmentDeliveryAction, recordShipmentDeliveryAction, selectShipmentDeliveryMethodAction } from '@/app/admin/shipment-delivery-actions';
import { DELIVERY_METHOD_LABELS, deliveryIsHandoff, deliveryStatusLabel, type AdminShipmentDelivery, type DeliveryMethod, type DeliveryOperation } from '@/lib/shipment-delivery';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';

const HISTORY_LABELS: Record<string, string> = { method_selected: '배송 방식 변경', quick_handoff: '퀵 인계', quick_receive: '퀵 수령 완료', pickup_receive: '방문수령 완료', direct_handoff: '직접배송 인계', direct_receive: '직접배송 수령 완료', freight_handoff: '화물배송 인계', freight_receive: '화물배송 수령 완료', none_receive: '직접전달 완료', digital_access: '디지털 파일 제공 시작' };
const EVIDENCE_LABELS: Record<string, string> = {
  customerRequestReference: '고객 요청 근거', feeConsentReference: '기존 배송비 유지 동의', operatorName: '실제 인계·확인 담당자',
  providerName: '배송 업체·담당', providerPhone: '배송 연락처', handoffReference: '인계 참조', receiptReference: '수령 확인 근거',
};
/* 배송 방식·인계 확인 카드(템플릿 룩, ADR-0028). 입력은 kit 부품이고 근거 입력 칸은 라벨 아래에 놓인다. */
const FORM_CLASS = 'flex flex-col items-start gap-2.5';
const FIELDSET_CLASS = 'm-0 flex w-full min-w-0 flex-col gap-2.5 border-0 p-0';
const FIELD_CLASS = 'flex w-full min-w-0 flex-col gap-1.5';
const LABEL_TEXT = 'text-sm font-medium';
const NOTE_CLASS = 'text-xs text-muted-foreground';
const SUMMARY_CLASS = 'cursor-pointer text-sm font-medium';

function MethodSelection({ shipment, onSaved }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void }) {
  const [method, setMethod] = useState<DeliveryMethod>(shipment.summary.method);
  const [policyId, setPolicyId] = useState(shipment.summary.policy?.policyId ?? '');
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null); const busy = useRef(false); const fieldId = useId();
  const policies = shipment.policies.filter((policy) => policy.method === method && policy.state === 'active');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget); requestId.current ??= crypto.randomUUID();
    form.set('operationId', requestId.current); form.set('policyId', method === 'parcel' ? '' : policyId);
    busy.current = true; setError(null);
    startTransition(async () => {
      try { const result = await selectShipmentDeliveryMethodAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('방식 변경 결과를 확인하지 못했습니다. 같은 내용으로 재시도하거나 새로고침해주세요.'); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className={`${FORM_CLASS} mt-2.5`}>
    <input type="hidden" name="orderId" value={shipment.orderId} /><input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} />
    <fieldset disabled={pending} className={FIELDSET_CLASS}>
      <legend className="sr-only">고객 요청에 따른 배송 방식 선택</legend>
      <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-method`}>변경할 배송 방식</Label><NativeSelect className="w-full" id={`${fieldId}-method`} name="method" value={method} onChange={(event) => { setMethod(event.target.value as DeliveryMethod); setPolicyId(''); }}>
        <option value="parcel">택배</option><option value="quick">퀵</option><option value="pickup">방문수령</option><option value="direct">직접배송</option><option value="freight">화물배송</option></NativeSelect>
      </div>
      {method !== 'parcel' ? <div className={FIELD_CLASS}><Label htmlFor={`${fieldId}-policy`}>확인한 운영 조건</Label><NativeSelect className="w-full" id={`${fieldId}-policy`} value={policyId} onChange={(event) => setPolicyId(event.target.value)} required>
        <option value="">활성 운영 조건을 선택해주세요</option>
        {policies.map((policy) => <option key={policy.id} value={policy.id}>버전 {policy.revision} · {policy.contactName} · {policy.handoffLocation}</option>)}
      </NativeSelect></div> : null}
      {method !== 'parcel' && !policies.length ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" role="status">이 출고지의 활성 운영 조건이 없습니다. 실제 운영 조건을 등록한 뒤 선택할 수 있습니다.</p> : null}
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>고객의 방식 변경 요청 근거</span><Textarea name="customerRequestReference" rows={2} maxLength={2000} required /></label>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>기존 배송비 유지 동의 근거</span><Textarea name="feeConsentReference" rows={2} maxLength={2000} required /></label>
      <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" name="feeUnchanged" required /><span>고객과 확인한 기존 배송비 {krw(shipment.shippingFee)}를 유지합니다.</span></label>
    </fieldset>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button variant="outline" type="submit" disabled={pending || (method !== 'parcel' && !policies.some((policy) => policy.id === policyId))}>
      {pending ? '기록 중…' : '고객 요청과 배송 방식 기록'}
    </Button>
  </form>;
}

function HandoffForm({ shipment, onSaved }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void }) {
  const method = shipment.summary.method;
  const kind = (method === 'pickup' || method === 'none' ? `${method}_receive` : `${method}_${shipment.status === 'ready' ? 'handoff' : 'receive'}`) as DeliveryOperation;
  const [occurredAt, setOccurredAt] = useState(''); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null); const busy = useRef(false); const fieldId = useId();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget); requestId.current ??= crypto.randomUUID(); form.set('operationId', requestId.current);
    busy.current = true; setError(null);
    startTransition(async () => {
      try { const result = await recordShipmentDeliveryAction(form); if (result.ok) onSaved(result.message); else setError(result.error); }
      catch { setError('인계·수령 처리 결과를 확인하지 못했습니다. 같은 내용으로 재시도하거나 새로고침해주세요.'); }
      finally { busy.current = false; }
    });
  }
  return <form onSubmit={submit} className={`${FORM_CLASS} border-t pt-3`}>
    <h4 className="text-sm font-medium text-foreground">{HISTORY_LABELS[kind]} 기록</h4>
    <input type="hidden" name="orderId" value={shipment.orderId} /><input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} /><input type="hidden" name="kind" value={kind} />
    <fieldset disabled={pending || !shipment.preorderReady} className={FIELDSET_CLASS}>
      <legend className="sr-only">실제 인계·수령 증거</legend>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 인계·확인 담당자</span><Input name="operatorName" maxLength={100} required /></label>
      <label className={FIELD_CLASS}><span className={LABEL_TEXT}>실제 {deliveryIsHandoff(kind) ? '인계' : '수령'} 시각 (한국)</span><Input type="datetime-local" name="occurredAt" step="0.001" value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)} required /></label>
      <Button variant="outline" size="sm" type="button" onClick={() => setOccurredAt(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 23))}>현재 시각 입력</Button>
      {deliveryIsHandoff(kind) ? <>
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
    {!shipment.preorderReady ? <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm" role="status">예약 품목에 실제 입고 물량을 먼저 할당해주세요.</p> : null}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button type="submit" disabled={pending || !shipment.preorderReady}>{pending ? '확인 중…' : deliveryIsHandoff(kind) ? '배송 인계 확인' : '수령 완료 확인'}</Button>
  </form>;
}

/** Own read/CAS baselines keep receipt forms independent of the parent order form. */
export function ShipmentDeliveryPanel({ shipmentId, shipmentNumber, orderId, originName }: { shipmentId: string; shipmentNumber?: string; orderId: string; originName?: string }) {
  const [refresh, setRefresh] = useState(0); const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<{ shipmentId: string; text: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; shipment?: AdminShipmentDelivery; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readShipmentDeliveryAction(shipmentId, orderId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, shipment: result.shipment } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '배송 인계 정보를 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId, orderId]);
  const visible = loaded?.key === key ? loaded : null; const shipment = visible?.shipment;
  const reload = () => setRefresh((value) => value + 1); const saved = (text: string) => { setNotice({ shipmentId, text }); reload(); };
  return <section className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground" aria-labelledby={`shipment-delivery-${shipmentId}`}>
    <div className="flex flex-col gap-0.5">
      <h3 className="text-base font-medium text-foreground" id={`shipment-delivery-${shipmentId}`}>{originName ? `${originName} · ` : ''}배송 방식·인계 확인</h3>
      <small className={`${NOTE_CLASS} tabular-nums`}>배송 건 {commerceReferenceLabel(shipmentId, shipmentNumber)}</small>
    </div>
    {notice?.shipmentId === shipmentId && <p className="text-[var(--wc-success)]" role="status">{notice.text}</p>}
    {!visible ? <p className="text-muted-foreground" role="status">배송 인계 정보를 불러오는 중입니다…</p> : visible.error ? <p className="text-destructive" role="alert">{visible.error}</p> : shipment ? <>
      <p>{DELIVERY_METHOD_LABELS[shipment.summary.method]} · {deliveryStatusLabel(shipment.summary.method, shipment.status)} · 기존 배송비 {krw(shipment.shippingFee)}</p>
      {shipment.summary.policy ? <p className="whitespace-pre-wrap text-muted-foreground">저장된 인계 조건: {shipment.summary.policy.handoffLocation}<br />
        {shipment.summary.policy.handoffInstructions}<br />{shipment.summary.policy.completionInstructions}</p> : null}
      {shipment.canSelect ? <details className="w-full rounded-lg border px-3 py-2.5"><summary className={SUMMARY_CLASS}>고객 요청으로 방식 변경</summary><MethodSelection key={`select-${shipment.updatedAt}`} shipment={shipment} onSaved={saved} /></details>
        : <small className={NOTE_CLASS}>배송없음·디지털 상품은 구매 시 확정한 제공 방식을 유지합니다. 배송 상품은 결제 확인 후 출고지시 전달 전까지 변경할 수 있습니다.</small>}
      {shipment.canTransition ? <HandoffForm key={`handoff-${shipment.updatedAt}`} shipment={shipment} onSaved={saved} /> : null}
      {shipment.history.length ? <details className="w-full rounded-lg border px-3 py-2.5"><summary className={SUMMARY_CLASS}>방식·인계 변경 이력 {shipment.history.length}건</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5">{shipment.history.map((row) => <li key={row.id}>
          <strong className="font-medium">{HISTORY_LABELS[row.kind]}</strong> · {formatOrderDateTime(row.recordedAt)} · {row.actorName ?? '운영자'}
          <dl className="mt-2 grid gap-2">
            {Object.entries(EVIDENCE_LABELS).filter(([field]) => typeof row.evidence[field] === 'string').map(([field, label]) => <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]" key={field}><dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{String(row.evidence[field])}</dd></div>)}
            {typeof row.evidence.occurredAt === 'string' ? <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt className="text-muted-foreground">실제 인계·수령 시각</dt><dd className="min-w-0">{formatOrderDateTime(row.evidence.occurredAt)}</dd></div> : null}
          </dl>
        </li>)}</ol>
      </details> : <p className="text-muted-foreground">기록된 방식 변경·인계 이력이 없습니다.</p>}
    </> : null}
    <Button variant="outline" size="sm" type="button" onClick={reload}>배송 방식·인계 새로고침</Button>
  </section>;
}
