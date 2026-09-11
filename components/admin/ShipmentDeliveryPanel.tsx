'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { readShipmentDeliveryAction, recordShipmentDeliveryAction, selectShipmentDeliveryMethodAction } from '@/app/admin/shipment-delivery-actions';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel, type AdminShipmentDelivery, type DeliveryMethod, type DeliveryOperation } from '@/lib/shipment-delivery';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';

const HISTORY_LABELS: Record<string, string> = { method_selected: '배송 방식 변경', quick_handoff: '퀵 인계', quick_receive: '퀵 수령 완료', pickup_receive: '방문수령 완료' };
const EVIDENCE_LABELS: Record<string, string> = {
  customerRequestReference: '고객 요청 근거', feeConsentReference: '기존 배송비 유지 동의', operatorName: '실제 인계·확인 담당자',
  providerName: '퀵 업체', providerPhone: '퀵 연락처', handoffReference: '인계 참조', receiptReference: '수령 확인 근거',
};

function MethodSelection({ shipment, onSaved }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void }) {
  const [method, setMethod] = useState<DeliveryMethod>(shipment.summary.method);
  const [policyId, setPolicyId] = useState(shipment.summary.policy?.policyId ?? '');
  const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null); const busy = useRef(false);
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
  return <form onSubmit={submit} className="col" style={{ gap: 10 }}>
    <input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} />
    <fieldset disabled={pending} className="col" style={{ gap: 10, border: 0, margin: 0, padding: 0 }}>
      <legend className="sr-only">고객 요청에 따른 배송 방식 선택</legend>
      <label>변경할 배송 방식<select name="method" value={method} onChange={(event) => { setMethod(event.target.value as DeliveryMethod); setPolicyId(''); }}>
        <option value="parcel">택배</option><option value="quick">퀵</option><option value="pickup">방문수령</option></select>
      </label>
      {method !== 'parcel' ? <label>확인한 운영 조건<select value={policyId} onChange={(event) => setPolicyId(event.target.value)} required>
        <option value="">활성 운영 조건을 선택해주세요</option>
        {policies.map((policy) => <option key={policy.id} value={policy.id}>버전 {policy.revision} · {policy.contactName} · {policy.handoffLocation}</option>)}
      </select></label> : null}
      {method !== 'parcel' && !policies.length ? <p role="status">이 출고지의 활성 운영 조건이 없습니다. 실제 운영 조건을 등록한 뒤 선택할 수 있습니다.</p> : null}
      <label>고객의 방식 변경 요청 근거<textarea name="customerRequestReference" rows={2} maxLength={2000} required /></label>
      <label>기존 배송비 유지 동의 근거<textarea name="feeConsentReference" rows={2} maxLength={2000} required /></label>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" name="feeUnchanged" required />고객과 확인한 기존 배송비 {krw(shipment.shippingFee)}를 유지합니다.</label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-ghost" type="submit" disabled={pending || (method !== 'parcel' && !policies.some((policy) => policy.id === policyId))}>
      {pending ? '기록 중…' : '고객 요청과 배송 방식 기록'}
    </button>
  </form>;
}

function HandoffForm({ shipment, onSaved }: { shipment: AdminShipmentDelivery; onSaved: (message: string) => void }) {
  const kind: DeliveryOperation = shipment.summary.method === 'pickup' ? 'pickup_receive' : shipment.status === 'ready' ? 'quick_handoff' : 'quick_receive';
  const [occurredAt, setOccurredAt] = useState(''); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null); const busy = useRef(false);
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
  return <form onSubmit={submit} className="col" style={{ gap: 10 }}>
    <h4 style={{ margin: 0 }}>{HISTORY_LABELS[kind]} 기록</h4>
    <input type="hidden" name="shipmentId" value={shipment.shipmentId} /><input type="hidden" name="updatedAt" value={shipment.updatedAt} /><input type="hidden" name="kind" value={kind} />
    <fieldset disabled={pending || !shipment.preorderReady} className="col" style={{ gap: 10, border: 0, margin: 0, padding: 0 }}>
      <legend className="sr-only">실제 인계·수령 증거</legend>
      <label>실제 인계·확인 담당자<input name="operatorName" maxLength={100} required /></label>
      <label>실제 {kind === 'quick_handoff' ? '인계' : '수령'} 시각 (한국)<input type="datetime-local" name="occurredAt" step="0.001" value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)} required /></label>
      <button className="btn btn-ghost" type="button" onClick={() => setOccurredAt(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 23))}>현재 시각 입력</button>
      {kind === 'quick_handoff' ? <>
        <label>실제 퀵 업체<input name="providerName" maxLength={100} required /></label>
        <label>퀵 담당 연락처<input name="providerPhone" type="tel" maxLength={40} required /></label>
        <label>실제 인계 참조·근거<textarea name="handoffReference" rows={2} maxLength={2000} required /></label>
      </> : <>
        <label>수령인 구분<select name="recipientKind" defaultValue="" required><option value="" disabled>수령인을 확인해주세요</option>
          <option value="self">주문자 본인</option>{shipment.summary.policy?.allowDelegate ? <option value="delegate">허용된 대리수령인</option> : null}</select></label>
        <label>수령 확인 기록·근거<textarea name="receiptReference" rows={2} maxLength={2000} required /></label>
        <label>주문자가 제시한 일회 수령 확인값<input name="receiptCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} required /></label>
        <small className="muted">주문자는 주문 화면에서 10분 동안 유효한 확인값을 발급합니다. 5회 틀리거나 재발급하면 이전 값은 사용할 수 없습니다.</small>
      </>}
    </fieldset>
    {!shipment.preorderReady ? <p role="status">예약 품목에 실제 입고 물량을 먼저 할당해주세요.</p> : null}
    {error && <p role="alert">{error}</p>}
    <button className="btn" type="submit" disabled={pending || !shipment.preorderReady}>{pending ? '확인 중…' : kind === 'quick_handoff' ? '퀵 인계 확인' : '수령 완료 확인'}</button>
  </form>;
}

/** Own read/CAS baselines keep receipt forms independent of the parent order form. */
export function ShipmentDeliveryPanel({ shipmentId, originName }: { shipmentId: string; originName?: string }) {
  const [refresh, setRefresh] = useState(0); const key = `${shipmentId}:${refresh}`;
  const [notice, setNotice] = useState<{ shipmentId: string; text: string } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; shipment?: AdminShipmentDelivery; error?: string } | null>(null);
  useEffect(() => {
    let canceled = false;
    void readShipmentDeliveryAction(shipmentId).then((result) => { if (!canceled) setLoaded(result.ok ? { key, shipment: result.shipment } : { key, error: result.error }); })
      .catch(() => { if (!canceled) setLoaded({ key, error: '배송 인계 정보를 불러오지 못했습니다.' }); });
    return () => { canceled = true; };
  }, [key, shipmentId]);
  const visible = loaded?.key === key ? loaded : null; const shipment = visible?.shipment;
  const reload = () => setRefresh((value) => value + 1); const saved = (text: string) => { setNotice({ shipmentId, text }); reload(); };
  return <section className="card col wc-admin-kit" style={{ padding: 16, gap: 12 }} aria-labelledby={`shipment-delivery-${shipmentId}`}>
    <h3 id={`shipment-delivery-${shipmentId}`} style={{ margin: 0, fontSize: 16 }}>{originName ? `${originName} · ` : ''}배송 방식·인계 확인</h3>
    <small className="mono">배송 건 {shipmentId.slice(-8).toUpperCase()}</small>
    {notice?.shipmentId === shipmentId && <p role="status">{notice.text}</p>}
    {!visible ? <p role="status">배송 인계 정보를 불러오는 중입니다…</p> : visible.error ? <p role="alert">{visible.error}</p> : shipment ? <>
      <p style={{ margin: 0 }}>{DELIVERY_METHOD_LABELS[shipment.summary.method]} · {deliveryStatusLabel(shipment.summary.method, shipment.status)} · 기존 배송비 {krw(shipment.shippingFee)}</p>
      {shipment.summary.policy ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>저장된 인계 조건: {shipment.summary.policy.handoffLocation}<br />
        {shipment.summary.policy.handoffInstructions}<br />{shipment.summary.policy.completionInstructions}</p> : null}
      {shipment.canSelect ? <details><summary>고객 요청으로 방식 변경</summary><MethodSelection key={`select-${shipment.updatedAt}`} shipment={shipment} onSaved={saved} /></details>
        : <small className="muted">결제가 확인되고 출고지시를 전달하기 전인 배송 준비 건만 방식을 변경할 수 있습니다.</small>}
      {shipment.canTransition ? <HandoffForm key={`handoff-${shipment.updatedAt}`} shipment={shipment} onSaved={saved} /> : null}
      {shipment.history.length ? <details><summary>방식·인계 변경 이력 {shipment.history.length}건</summary>
        <ol className="col" style={{ gap: 12, paddingLeft: 20 }}>{shipment.history.map((row) => <li key={row.id}>
          <strong>{HISTORY_LABELS[row.kind]}</strong> · {formatOrderDateTime(row.recordedAt)} · {row.actorName ?? '운영자'}
          <dl className="admin-order-detail__facts">
            {Object.entries(EVIDENCE_LABELS).filter(([field]) => typeof row.evidence[field] === 'string').map(([field, label]) => <div key={field}><dt>{label}</dt>
              <dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(row.evidence[field])}</dd></div>)}
            {typeof row.evidence.occurredAt === 'string' ? <div><dt>실제 인계·수령 시각</dt><dd>{formatOrderDateTime(row.evidence.occurredAt)}</dd></div> : null}
          </dl>
        </li>)}</ol>
      </details> : <p className="muted">기록된 방식 변경·인계 이력이 없습니다.</p>}
    </> : null}
    <button className="btn btn-ghost" type="button" onClick={reload}>배송 방식·인계 새로고침</button>
  </section>;
}
