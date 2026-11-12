'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readClaimCollectionAction, saveClaimCollectionAction } from '@/app/orders/claim-collection-actions';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { COLLECTION_METHODS, normalizeClaimCollectionValues, type ClaimCollectionDocument, type ClaimCollectionRow, type ClaimCollectionValues, type CollectionMethod } from '@/lib/orders/claim-collection';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { formatOrderDateTime } from '@/lib/orders';
import { claimCollectionRowLabel } from '@/lib/fulfillment';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
type Props = {
  actorId: string; claimId: string; operator?: boolean; carriers?: ShippingCarrierRegistry;
  /** 고객 화면: 같은 화면 배송 건 머리의 이름표(shipmentId → '한진택배 배송' 등, `customerShipmentGroupLabels`). 없으면 '배송 묶음 N'. */
  shipmentLabels?: Readonly<Record<string, string>>;
};
type Request = { shipmentId: string; revision: number; claimRevision: number; values: ClaimCollectionValues; operationId: string };
/*
 * 회수 주소(S36-040·QNA-031): 승인 뒤 배송 묶음마다 승인 때 고정한 회수 주소. 한 배송 묶음 안에서 굿즈마다 반품지가 다르면
 * 반품지별로 나눠 보이고, 고객은 나눠 보낸다. 회수 생략 배송 건(하자·오배송 교환, ADR-0041)은 고객에게 주소 대신 반송이
 * 필요 없다고 말한다. 선물 주문은 받는 분만 이 문서를 읽는다(read_my_claim_collection_plan).
 * 반품 자동 회수 접수(QNA-032)로 택배사에 접수된 묶음은 방문 회수와 회수 송장을 함께 보인다(접수되지 않은 묶음은 지금과 같다).
 */
export function ClaimReturnBundles({ row, operator }: { row: ClaimCollectionRow; operator: boolean }) {
  if (row.collectionWaived && !operator) return <p data-claim-collection-waived="">회수 없이 다시 보내드려요. 이 배송 묶음의 굿즈는 반송하지 않아도 됩니다.</p>;
  const bundles = row.returnBundles ?? [];
  return <>
    {row.collectionWaived ? <p data-claim-collection-waived="">회수 생략으로 결정한 배송 건입니다.</p> : null}
    {bundles.length > 1 ? <p>굿즈마다 보내는 곳이 달라 {bundles.length}곳으로 나눠 보내주세요.</p> : null}
    {bundles.length ? <ul className="claim-collection-plan__bundles" aria-label="회수 주소">{bundles.map((bundle, index) => <li key={bundle.bundleId} data-claim-return-bundle="">
      <small>{bundles.length > 1 ? `회수 주소 ${index + 1}/${bundles.length}` : '회수 주소'}{bundle.collectedAt ? ` · 입고 확인 ${formatOrderDateTime(bundle.collectedAt)}` : ''}</small>
      <span>{bundle.returnName ? `${bundle.returnName} · ` : ''}{bundle.returnAddress || '판매자가 회수 주소를 따로 안내합니다.'}{bundle.returnPhone ? ` · ${bundle.returnPhone}` : ''}</span>
      <small>{bundle.items.map(item => `${item.name} ${item.qty}개`).join(', ')}</small>
      {bundle.pickup ? <small data-claim-return-pickup="">방문 회수 접수 · {bundle.pickup.carrierLabel ?? bundle.pickup.carrier} 회수 송장 {bundle.pickup.trackingNumber}</small> : null}
    </li>)}</ul> : null}
  </>;
}
/** 행 상태 문구. 자동 회수 접수(QNA-032)로 방문 회수가 접수된 묶음이 있으면 '접수 후 수거 협의' 대신 '방문 회수 접수됨'이다. */
export function collectionRowMethodLabel(row: ClaimCollectionRow): string {
  return row.method === 'not_requested' && row.returnBundles?.some(bundle => bundle.pickup) ? '방문 회수 접수됨' : COLLECTION_METHODS[row.method];
}
export function ClaimCollectionPlan(props: Props) {
  return <ClaimContactSession actorId={props.actorId}>{(identity, scope) => <CollectionPanel key={`${props.claimId}:${identity.sessionId}`} {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
function CollectionPanel({ claimId, operator = false, carriers = [], shipmentLabels, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
  const router = useRouter();
  const [document, setDocument] = useState<ClaimCollectionDocument | null>(null), [selected, setSelected] = useState<ClaimCollectionRow | null>(null);
  const [method, setMethod] = useState<CollectionMethod>('not_requested'), [carrier, setCarrier] = useState(''), [tracking, setTracking] = useState(''), [evidence, setEvidence] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function read() {
    if (busy.current) return; const ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setError('');
    try { const result = await readClaimCollectionAction(claimId, identity, operator);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) setError(result.error ?? '회수 정보를 읽지 못했습니다.');
      else { setDocument(result.document ?? null); if (!dispatched.current) setSelected(null); }
    } catch { if (alive.current && scope.canApply(ticket)) setError('회수 정보를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function edit(row: ClaimCollectionRow) {
    if (busy.current || uncertain) return;
    setSelected(row); setMethod(row.method); setCarrier(row.carrier ?? ''); setTracking(row.trackingNumber ?? ''); setEvidence(''); setConfirmed(false); setMessage(''); setError('');
  }
  async function save() {
    if (busy.current || !document || !selected) return;
    const values = normalizeClaimCollectionValues({ method, carrier: carrier || null, trackingNumber: tracking || null, evidence, confirmed });
    const request = dispatched.current ?? (values ? { shipmentId: selected.shipmentId, revision: selected.revision, claimRevision: document.claimRevision, values, operationId: crypto.randomUUID() } : null);
    if (!request) { setError('회수 정보·정정 근거·확인 항목을 입력해주세요.'); return; }
    const ticket = scope.capture(); if (!ticket) return;
    busy.current = true; dispatched.current = request; setPending(true); setError(''); setMessage('');
    try { const result = await saveClaimCollectionAction(claimId, request.shipmentId, request.revision, request.claimRevision, request.values, request.operationId, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error ?? '처리 결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
      else { setDocument(result.document); setSelected(null); dispatched.current = null; setUncertain(false); setMessage('회수 정보 정정을 저장했습니다. 최초 접수 기록과 실제 입고 확인은 유지됩니다.'); router.refresh(); }
    } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setError('저장 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.'); } }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return <section className="claim-collection-plan" aria-label="회수 방법과 송장">
    <h3>회수 방법·택배사·송장</h3>
    <p>{operator ? '택배사에 별도로 접수한 회수 정보와 정정 근거를 기록합니다. 이 저장만으로 수거 요청이나 입고 처리가 실행되지는 않습니다.' : '판매자가 안내한 회수 방법과 송장 정보를 확인할 수 있습니다. 요청이 승인되면 배송 묶음별 회수 주소도 함께 보입니다.'}</p>
    <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => { void read(); }}>회수 정보 확인</button>
    {/* 고객에게는 출고지 이름 대신 같은 화면 배송 건 머리의 이름(택배사·R26)으로 부른다(10/14 회의 S7 · m27 CUST-2).
        회수 문서에는 출고 택배사가 없어 주문 상세가 이름표를 넘긴다. 이름표가 없으면 '배송 묶음 N'이다. */}
    {document?.rows.map((row, index, rows) => <div className="claim-collection-plan__row" key={row.shipmentId}>
      <strong>{operator ? row.originName : claimCollectionRowLabel(row.shipmentId, index, rows.length, shipmentLabels)}</strong><p>{collectionRowMethodLabel(row)} · {row.collectedAt ? `회수 확인 ${formatOrderDateTime(row.collectedAt)}` : '회수 확인 전'}</p>
      {row.carrier ? <p>{row.carrierLabel ?? carriers.find(c => c.code === row.carrier)?.label ?? row.carrier} · {row.trackingNumber}</p> : null}
      <ClaimReturnBundles row={row} operator={operator} />
      {operator && row.evidence ? <p>{row.evidence}</p> : null}
      {operator && document.editable && !row.reshipped ? <button className="btn btn-sm btn-ghost" disabled={pending || uncertain} type="button" onClick={() => edit(row)}>회수 정보 정정 · {row.originName}</button>
        : operator && row.reshipped ? <p>이 출고지는 재출고해 회수 정보를 정정할 수 없습니다.</p> : null}
    </div>)}
    {operator && selected ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={pending || uncertain}>
        <legend>{selected.originName} 회수 정보 정정</legend>
        <label>수거 방법<select value={method} onChange={event => { const next = event.target.value as CollectionMethod; setMethod(next); if (next === 'not_requested') { setCarrier(''); setTracking(''); } }}>
          {Object.entries(COLLECTION_METHODS).map(([key, label]) => <option key={key} value={key} disabled={key === 'not_requested' && selected.requestedOnce}>{label}</option>)}</select></label>
        {method !== 'not_requested' ? <><label>수거 택배사<select value={carrier} onChange={event => setCarrier(event.target.value)}><option value="">선택 안 함</option>{carriers.filter(c => c.active).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
          <label>수거 송장번호<input maxLength={40} value={tracking} onChange={event => setTracking(event.target.value)} placeholder="영문·숫자 8~40자" /></label></> : null}
        <label>정정 근거<textarea required minLength={2} maxLength={500} rows={2} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="택배사 확인 내용·상담 참조번호. 개인정보는 입력하지 마세요." /></label>
        <label className="claim-collection-plan__check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />실제 회수 정보를 확인했습니다.</label>
      </fieldset>
      <button className="btn btn-sm" disabled={pending} type="submit">{uncertain ? '같은 요청으로 저장 결과 확인' : '회수 정보 정정 저장'}</button>
    </form> : null}
    {operator && document?.history.length ? <details><summary>최근 정정 이력 {document.history.length}건</summary><ol>{document.history.map(item => <li key={item.id}>{formatOrderDateTime(item.createdAt)} · {COLLECTION_METHODS[item.method]} · {item.carrier} {item.trackingNumber}<br />{item.evidence}</li>)}</ol></details> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}
