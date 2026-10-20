'use client';
import { useEffect, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readGoodsFulfillmentAction, saveGoodsFulfillmentAction, prepareDigitalAssetAction, verifyDigitalAssetAction } from '@/app/admin/goods-fulfillment-actions';
import { createClient } from '@/lib/supabase/client';
import { DIGITAL_BUCKET, DIGITAL_MIME_EXTENSIONS, FULFILLMENT_METHOD_LABELS, parseDigitalFile, type DigitalFile, type FulfillmentMethod, type GoodsFulfillmentSettings } from '@/lib/goods-fulfillment';
import { krw } from '@/lib/format';
import '@/app/styles/admin-goods-fulfillment.css';
const shippingMethods = ['parcel', 'quick', 'pickup', 'direct', 'freight'] as const;
const draftOf = (s: GoodsFulfillmentSettings) => ({ mode: s.mode, methods: shippingMethods.map(method => { const terms = s.methods.find(m => m.method === method); return { method, enabled: Boolean(terms), amount: terms?.feeAmount?.toString() ?? '0', basis: terms?.feeBasis ?? 'per_order', installation: terms?.installationFee.toString() ?? '0' }; }), files: s.files, publicNote: s.publicNote, evidence: '', confirmed: false });
type Draft = ReturnType<typeof draftOf>;
type Props = { goodId: string; accountId: string; disabledReason?: string };
export function GoodsFulfillmentPanel(props: Props) { return <ClaimContactSession actorId={props.accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel {...props} identity={identity} scope={scope} />}</ClaimContactSession>; }
function Panel({ goodId, disabledReason, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [settings, setSettings] = useState<GoodsFulfillmentSettings | null>(null), [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [pendingFile, setPendingFile] = useState<DigitalFile | null>(null);
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<{ values: unknown; revision: number; operation: string } | null>(null);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current || uncertain || pendingFile) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await readGoodsFulfillmentAction(goodId); if (!alive.current || !scope.canApply(ticket)) return;
   if ('settings' in result) { setSettings(result.settings); setDraft(draftOf(result.settings)); setMessage('현재 배송·제공 설정을 불러왔습니다.'); } else setMessage(result.error);
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function upload(file?: File) {
  if (busy.current || uncertain || disabledReason || !draft || !file || draft.files.length >= 10 || pendingFile) return;
  const candidate = parseDigitalFile({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size });
  if (!candidate) { setMessage('PDF·ZIP·PNG·JPG·MP3·MP4·TXT 파일을 50MB 이하로 선택해주세요.'); return; }
  const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  let prepared = false;
  try {
   const grant = await prepareDigitalAssetAction(candidate, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if (!grant.ok) { setMessage(grant.error); return; } prepared = true; setPendingFile(candidate);
   const sent = await createClient().storage.from(DIGITAL_BUCKET).upload(grant.path, file, { contentType: candidate.mimeType, upsert: false });
   if (!alive.current || !scope.canApply(ticket)) return;
   if (sent.error) { setMessage('전송 결과를 확인하지 못했습니다. 같은 파일의 업로드 결과를 확인해주세요.'); return; }
   const result = await verifyDigitalAssetAction(candidate.id, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if (result.ok) { setDraft(d => d ? { ...d, files: [...d.files.filter(f => f.id !== result.file.id), result.file] } : d); setPendingFile(null); setMessage('파일을 확인했습니다. 상품 설정을 저장하면 새 주문에 적용됩니다.'); }
   else { setMessage(result.error); if (!result.uncertain) setPendingFile(null); }
  } catch { if (alive.current && scope.canApply(ticket)) setMessage(prepared ? '전송 결과를 확인하지 못했습니다. 같은 파일의 업로드 결과를 확인해주세요.' : '업로드 준비에 실패했습니다. 다시 선택해주세요.'); }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function verify() {
  if (busy.current || !pendingFile) return; const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
  try { const result = await verifyDigitalAssetAction(pendingFile.id, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if (result.ok) { setDraft(d => d ? { ...d, files: [...d.files.filter(f => f.id !== result.file.id), result.file] } : d); setPendingFile(null); setMessage('같은 파일의 저장 결과를 확인했습니다. 상품 설정을 저장해주세요.'); }
   else { setMessage(result.error); if (!result.uncertain) setPendingFile(null); }
  } finally { busy.current = false; if (alive.current) setPending(false); }
 }
 async function save() {
  if (!draft || !settings || !draft.confirmed || disabledReason || pendingFile || busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  const selected = draft.methods.filter(m => m.enabled);
  if (draft.mode === 'shipping' && (!selected.length || selected.some(m => !/^\d+$/.test(m.amount) || !/^\d+$/.test(m.installation)))) { setMessage('받을 방식과 0 이상의 원 단위 비용을 입력해주세요.'); return; }
  const methods = draft.mode === 'shipping' ? selected.map(m => ({ method: m.method, feeAmount: m.method === 'parcel' ? null : m.method === 'pickup' ? 0 : Number(m.amount), feeBasis: m.method === 'parcel' ? 'per_order' : m.basis, installationFee: m.method === 'pickup' ? 0 : Number(m.installation) })) : [{ method: draft.mode === 'digital' ? 'digital' : 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }];
  const request = dispatched.current ?? { values: { mode: draft.mode, methods, files: draft.mode === 'digital' ? draft.files : [], publicNote: draft.publicNote, evidence: draft.evidence, confirmed: draft.confirmed }, revision: settings.revision, operation: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await saveGoodsFulfillmentAction(goodId, request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('settings' in result && result.settings) { setSettings(result.settings); setDraft(draftOf(result.settings)); dispatched.current = null; setUncertain(false); setMessage('배송·제공 설정을 저장했습니다. 기존 주문의 방식·금액·파일은 유지됩니다.'); }
   else { setMessage(result.error ?? '결과를 확인하지 못했습니다.'); setUncertain(uncertain || Boolean(result.uncertain)); if (!uncertain && !result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage('저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 function methodValue(method: FulfillmentMethod, patch: Partial<Draft['methods'][number]>) { setDraft(d => d ? { ...d, methods: d.methods.map(m => m.method === method ? { ...m, ...patch } : m) } : d); }
 return <div className="admin-goods-fulfillment"><p>고객이 주문서에서 선택할 수령 방식과 선결제 비용을 설정합니다. 택배 운임은 기존 배송비 정책을 사용하며 설치비는 별도로 선결제합니다.</p>
  <button type="button" className="wc-admin-kit__button" disabled={pending || uncertain || Boolean(pendingFile)} onClick={() => { void read(); }}>현재 배송·제공 설정 불러오기</button>
  {draft ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain || Boolean(pendingFile) || Boolean(disabledReason)}><legend>상품 제공 방식</legend>
   <label>제공 구분<select value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value as Draft['mode'] })}><option value="shipping">배송 또는 방문수령</option><option value="no_delivery">배송없음 · 직접전달</option><option value="digital">디지털 파일 다운로드</option></select></label>
   {draft.mode === 'shipping' ? <div className="admin-goods-fulfillment__methods">{draft.methods.map(m => <div className="admin-goods-fulfillment__method" key={m.method}>
    <label className="admin-goods-fulfillment__check"><input type="checkbox" checked={m.enabled} onChange={e => methodValue(m.method, { enabled: e.target.checked })} />{FULFILLMENT_METHOD_LABELS[m.method]}</label>
    {m.enabled && <>{m.method !== 'parcel' && m.method !== 'pickup' ? <><label>선결제 배송비 (원)<input inputMode="numeric" value={m.amount} onChange={e => methodValue(m.method, { amount: e.target.value })} required /></label><label>배송비 계산 단위<select value={m.basis} onChange={e => methodValue(m.method, { basis: e.target.value as 'per_order' | 'per_item' })}><option value="per_order">이 상품 주문당 1회</option><option value="per_item">수량 1개마다</option></select></label></> : <p>{m.method === 'parcel' ? '기존 택배 기본료·무료 기준·수량별·지역 추가료·선불/착불 조건을 적용합니다.' : '방문수령의 배송비는 0원입니다.'}</p>}
     {m.method !== 'pickup' ? <label>수량 1개당 선결제 설치비 (원)<input inputMode="numeric" value={m.installation} onChange={e => methodValue(m.method, { installation: e.target.value })} required /></label> : null}</>}
   </div>)}</div> : draft.mode === 'digital' ? <div><p>파일은 결제가 확인된 로그인 구매자에게 제공합니다. 환불 후 새 다운로드를 차단하며, 다운로드를 시작한 주문의 취소는 담당자가 검토합니다. 기존 주문은 구매 당시 파일을 유지합니다.</p>
    <label>제공 파일 · 최대 10개, 개당 50MB<input type="file" accept={Object.keys(DIGITAL_MIME_EXTENSIONS).join(',')} disabled={draft.files.length >= 10} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file); }} /></label>
    <ul>{draft.files.map(f => <li key={f.id}>{f.name} · {(f.size / 1024).toFixed(1)}KB <button type="button" onClick={() => setDraft({ ...draft, files: draft.files.filter(item => item.id !== f.id) })}>새 주문에서 제외</button></li>)}</ul>
    <p>PDF·ZIP·PNG·JPG·MP3·MP4·TXT 파일을 개당 50MB, 최대 10개까지 등록할 수 있습니다. 구매자에게 제공할 원본 파일을 선택해주세요.</p>
   </div> : <p>배송비 0원으로 주문하며 실제 직접전달 후 주문자의 일회 수령 확인값과 전달 근거를 기록합니다.</p>}
   {draft.mode !== 'digital' ? <p>택배 이외 수령 방식은 배송정보 관리에서 해당 출고지의 연락처·인계 장소·수령 절차를 먼저 활성화해야 주문할 수 있습니다. 추가 배송비는 설정한 금액으로 선결제하며 현장 추가 청구는 없습니다.</p> : null}
   <label>고객 안내<input maxLength={1000} value={draft.publicNote} onChange={e => setDraft({ ...draft, publicNote: e.target.value })} /></label>
   <label>설정 근거<input minLength={2} maxLength={1000} required value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></label>
   <label className="admin-goods-fulfillment__check"><input type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} required />수령 방식·금액·파일 제공 조건을 확인했습니다.</label>
  </fieldset><button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || !draft.confirmed || Boolean(pendingFile) || Boolean(disabledReason)}>{uncertain ? '같은 요청으로 저장 결과 확인' : '배송·제공 설정 저장'}</button></form> : null}
  {pendingFile ? <p role="status">{pendingFile.name}의 전송·검증 결과를 확인해주세요. <button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => { void verify(); }}>같은 업로드 결과 확인</button></p> : null}
  {settings ? <p>저장된 방식: {settings.methods.map(m => `${FULFILLMENT_METHOD_LABELS[m.method]}${m.feeAmount === null ? '' : ` ${krw(m.feeAmount)}`}`).join(', ')}</p> : null}
  {disabledReason ? <p role="status">{disabledReason}</p> : null}{message ? <p role="status">{message}</p> : null}
 </div>;
}
