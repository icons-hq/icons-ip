'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { readGoodsFulfillmentAction, saveGoodsFulfillmentAction, prepareDigitalAssetAction, verifyDigitalAssetAction } from '@/app/admin/goods-fulfillment-actions';
import { createClient } from '@/lib/supabase/client';
import { DIGITAL_BUCKET, DIGITAL_MIME_EXTENSIONS, FULFILLMENT_METHOD_LABELS, parseDigitalFile, type DigitalFile, type FulfillmentMethod, type GoodsFulfillmentSettings } from '@/lib/goods-fulfillment';
import { krw, krwAmountWords } from '@/lib/format';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GoodChoiceCard, GoodChoiceCards, GoodReadback } from './GoodEditorParts';
import { AdminField } from './console/AdminKit';
import { GOOD_FIELDS_B_HELP } from '@/lib/admin/help/good-fields-b';
import { FULFILLMENT_AMOUNT_INVALID, FULFILLMENT_METHOD_REQUIRED, GOODS_FULFILLMENT_SAVE_UNCERTAIN } from '@/lib/admin/goods-fulfillment-messages';
import { adminConfirm } from '@/lib/admin/confirm';
import { RELOAD_SAVED_CONFIRM } from '@/lib/admin/goods-template-save';
const FIELD_LABEL_CLASS = 'flex min-w-0 flex-col gap-2 text-sm font-medium text-foreground';
const CHECK_LABEL_CLASS = 'flex cursor-pointer items-start gap-2 text-sm [&>input]:mt-0.5';
const shippingMethods = ['parcel', 'quick', 'pickup', 'direct', 'freight'] as const;
const draftOf = (s: GoodsFulfillmentSettings) => ({ mode: s.mode, methods: shippingMethods.map(method => { const terms = s.methods.find(m => m.method === method); return { method, enabled: Boolean(terms), amount: terms?.feeAmount?.toString() ?? '0', basis: terms?.feeBasis ?? 'per_order', installation: terms?.installationFee.toString() ?? '0' }; }), files: s.files, publicNote: s.publicNote });
type Draft = ReturnType<typeof draftOf>;
/**
 * 고른 받을 방식을 한 줄로 되읽는다('글보다 화면' 3단계). 택배만 고른 기본 모양과 배송없음·디지털(선택 카드가 이미 말한다)에는 덧붙이지 않고,
 * 금액이 숫자가 아니면 틀린 문장을 말하지 않는다.
 */
function fulfillmentReadback(draft: Draft): string | null {
 if (draft.mode !== 'shipping') return null;
 const selected = draft.methods.filter(m => m.enabled);
 if (!selected.length || selected.some(m => !/^\d+$/.test(m.amount) || !/^\d+$/.test(m.installation))) return null;
 const items = selected.map(m => {
  const fee = m.method === 'parcel' || m.method === 'pickup' ? 0 : Number(m.amount), installation = m.method === 'pickup' ? 0 : Number(m.installation);
  const costs = [fee > 0 ? `배송비 ${m.basis === 'per_item' ? '수량 1개마다 ' : ''}${krwAmountWords(fee)}` : '', installation > 0 ? `설치비 개당 ${krwAmountWords(installation)}` : ''].filter(Boolean);
  return `${FULFILLMENT_METHOD_LABELS[m.method]}${costs.length ? `(${costs.join(' · ')})` : ''}`;
 });
 if (items.length === 1) return items[0] === FULFILLMENT_METHOD_LABELS.parcel ? null : `받을 방식은 ${items[0]} 하나입니다.`;
 return `고객은 주문서에서 ${items.join(', ')} 중 하나를 고릅니다.`;
}
/**
 * 수령 방식·제공 파일 입력(저장된 상품 패널과 등록 화면의 '상품과 함께 저장'이 같이 쓴다 — T15b). 파일 전송·검증과 저장은 부르는 쪽이 한다.
 * 전달 방식을 고르면 그에 필요한 입력만 열리고('글보다 화면' 2단계), 고른 받을 방식은 한 줄로 되읽는다(3단계).
 * 설정 근거·확인 체크는 없다(2026-11-25 결정 — 저장 = 적용). 누가 언제 바꿨는지는 감사 기록이 남긴다.
 */
export function GoodsFulfillmentDraftFields({ draft, onChange, onUpload, fieldId }: {
  draft: Draft; onChange: (draft: Draft) => void; onUpload: (file?: File) => void; fieldId: string;
}) {
 const methodValue = (method: FulfillmentMethod, patch: Partial<Draft['methods'][number]>) => onChange({ ...draft, methods: draft.methods.map(m => m.method === method ? { ...m, ...patch } : m) });
 /* 택배 외 방식과 직접 전달은 출고지에서 연락처·인계 장소·수령 절차를 켜 둬야 주문할 수 있다. */
 const needsOriginSetup = draft.mode === 'no_delivery' || draft.mode === 'shipping' && draft.methods.some(m => m.enabled && m.method !== 'parcel');
 const readback = fulfillmentReadback(draft);
 /* 뺀 파일을 다시 넣으려면 다시 올려야 한다. 무엇이 빠지는지 말하고 확인받는다(화면 규칙 7). */
 const excludeFile = async (file: DigitalFile) => {
  if (await adminConfirm({ title: `‘${file.name}’ 파일을 새 주문에서 뺄까요?`, message: '저장하면 새 주문부터 이 파일을 받을 수 없습니다. 이미 받은 주문은 그대로입니다. 다시 넣으려면 파일을 다시 올려야 합니다.', confirmLabel: '새 주문에서 제외' })) onChange({ ...draft, files: draft.files.filter(item => item.id !== file.id) });
 };
 const modeCard = (mode: Draft['mode'], title: string, description: string) => <GoodChoiceCard name={`${fieldId}-mode`} value={mode} checked={draft.mode === mode} onChange={() => onChange({ ...draft, mode })} title={title} description={description} />;
 return <>
   <GoodChoiceCards legend="상품 제공 방식">
     {modeCard('shipping', '배송 또는 방문수령', '고객이 주문서에서 받는 방법을 고릅니다.')}
     {modeCard('no_delivery', '배송없음 · 직접전달', '배송비 없이 주문받고, 직접 전달한 뒤 전달 근거를 기록합니다.')}
     {modeCard('digital', '디지털 파일 다운로드', '결제가 확인되면 고객이 파일을 내려받습니다.')}
   </GoodChoiceCards>
   {draft.mode === 'shipping' ? <div className="grid min-w-0 gap-4 sm:grid-cols-2">{draft.methods.map(m => <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-fulfillment-method={m.method} key={m.method}>
    <label className={`${CHECK_LABEL_CLASS} font-medium`}><input type="checkbox" checked={m.enabled} onChange={e => methodValue(m.method, { enabled: e.target.checked })} />{FULFILLMENT_METHOD_LABELS[m.method]}</label>
    {m.enabled && <>{m.method !== 'parcel' && m.method !== 'pickup' ? <><label className={FIELD_LABEL_CLASS}>선결제 배송비 (원)<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" inputMode="numeric" value={m.amount} onChange={e => methodValue(m.method, { amount: e.target.value })} required /></label><div className="flex min-w-0 flex-col gap-2"><label className="text-sm font-medium text-foreground" htmlFor={`${fieldId}-${m.method}-basis`}>배송비 계산 단위</label><NativeSelect className="w-full" id={`${fieldId}-${m.method}-basis`} value={m.basis} onChange={e => methodValue(m.method, { basis: e.target.value as 'per_order' | 'per_item' })}><option value="per_order">이 상품 주문당 1회</option><option value="per_item">수량 1개마다</option></NativeSelect></div></> : <p className="text-sm text-muted-foreground">{m.method === 'parcel' ? '배송비는 상품의 기존 배송비 규칙(기본료·무료 기준·수량별·지역 추가료·착불)을 따릅니다.' : '방문수령은 배송비 0원입니다.'}</p>}
     {m.method !== 'pickup' ? <label className={FIELD_LABEL_CLASS}>수량 1개당 선결제 설치비 (원)<input className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" inputMode="numeric" value={m.installation} onChange={e => methodValue(m.method, { installation: e.target.value })} required /></label> : null}</>}
   </div>)}</div> : null}
   {draft.mode === 'digital' ? <div className="flex min-w-0 flex-col gap-3">
    <AdminField label="제공 파일" inputId={`${fieldId}-file`} help={GOOD_FIELDS_B_HELP.digitalFiles} hint="PDF·ZIP·PNG·JPG·MP3·MP4·TXT 파일, 최대 10개, 개당 50MB까지 올릴 수 있습니다.">
      <input className={`${GOOD_INPUT_CLASS} file:mr-3 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground`} data-slot="input" id={`${fieldId}-file`} type="file" accept={Object.keys(DIGITAL_MIME_EXTENSIONS).join(',')} disabled={draft.files.length >= 10} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; onUpload(file); }} />
    </AdminField>
    <ul className="flex min-w-0 flex-col gap-1.5 text-sm">{draft.files.map(f => <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 wrap-anywhere" key={f.id}>{f.name} · <span className="tabular-nums">{(f.size / 1024).toFixed(1)}KB</span> <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" onClick={() => { void excludeFile(f); }}>새 주문에서 제외</button></li>)}</ul>
   </div> : null}
   {needsOriginSetup ? <p className="text-sm text-muted-foreground" data-good-fulfillment-origin-note="">택배 외 방식은 <a className="text-foreground underline underline-offset-4" href="/admin/settings/origins" target="_blank" rel="noreferrer">배송정보 관리</a>에서 출고지의 연락처·인계 장소·수령 절차를 먼저 켜 둬야 주문할 수 있습니다. 추가 배송비는 선결제로만 받고, 현장에서 따로 받지 않습니다.</p> : null}
   <AdminField label="고객 안내 (선택)" inputId={`${fieldId}-note`} hint="상품 상세의 제공 방식과 주문서의 받을 방식 아래에 보입니다.">
     <input className={GOOD_INPUT_CLASS} data-slot="input" id={`${fieldId}-note`} maxLength={1000} placeholder="예: 설치 기사가 방문해 설치합니다" value={draft.publicNote} onChange={e => onChange({ ...draft, publicNote: e.target.value })} />
   </AdminField>
   {readback ? <GoodReadback>{readback}</GoodReadback> : null}
 </>;
}
/** showDisabledReason=false면 잠금 이유 문장을 본문에 그리지 않는다(상품 편집기가 패널 위에 공통 잠금 안내를 보일 때). 잠금은 disabledReason이 맡는다. */
type Props = { goodId: string; accountId: string; disabledReason?: string; showDisabledReason?: boolean };
export function GoodsFulfillmentPanel(props: Props) { return <ClaimContactSession actorId={props.accountId} pendingMessage="로그인 상태를 확인하고 있습니다.">{(identity, scope) => <Panel {...props} identity={identity} scope={scope} />}</ClaimContactSession>; }
function Panel({ goodId, disabledReason, showDisabledReason = true, identity, scope }: Props & { identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [settings, setSettings] = useState<GoodsFulfillmentSettings | null>(null), [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [pendingFile, setPendingFile] = useState<DigitalFile | null>(null);
 const alive = useRef(true), busy = useRef(false), dispatched = useRef<{ values: unknown; revision: number; operation: string } | null>(null);
 const fieldId = useId();
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current || uncertain || pendingFile) return;
  /* 적은 내용이 저장된 설정과 다르면 사라진다고 먼저 묻는다(화면 규칙 7). */
  if (draft && settings && JSON.stringify(draft) !== JSON.stringify(draftOf(settings)) && !await adminConfirm(RELOAD_SAVED_CONFIRM)) return;
  if (busy.current) return;
  const ticket = scope.capture(); if (!ticket) return; busy.current = true; setPending(true);
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
   if (sent.error) { setMessage('파일이 올라갔는지 확인하지 못했습니다. 아래 같은 업로드 결과 확인을 눌러주세요.'); return; }
   const result = await verifyDigitalAssetAction(candidate.id, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if (result.ok) { setDraft(d => d ? { ...d, files: [...d.files.filter(f => f.id !== result.file.id), result.file] } : d); setPendingFile(null); setMessage('파일을 확인했습니다. 상품 설정을 저장하면 새 주문에 적용됩니다.'); }
   else { setMessage(result.error); if (!result.uncertain) setPendingFile(null); }
  } catch { if (alive.current && scope.canApply(ticket)) setMessage(prepared ? '파일이 올라갔는지 확인하지 못했습니다. 아래 같은 업로드 결과 확인을 눌러주세요.' : '업로드 준비에 실패했습니다. 다시 선택해주세요.'); }
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
  if (!draft || !settings || disabledReason || pendingFile || busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  const selected = draft.methods.filter(m => m.enabled);
  if (draft.mode === 'shipping' && !selected.length) { setMessage(FULFILLMENT_METHOD_REQUIRED); return; }
  if (draft.mode === 'shipping' && selected.some(m => !/^\d+$/.test(m.amount) || !/^\d+$/.test(m.installation))) { setMessage(FULFILLMENT_AMOUNT_INVALID); return; }
  const methods = draft.mode === 'shipping' ? selected.map(m => ({ method: m.method, feeAmount: m.method === 'parcel' ? null : m.method === 'pickup' ? 0 : Number(m.amount), feeBasis: m.method === 'parcel' ? 'per_order' : m.basis, installationFee: m.method === 'pickup' ? 0 : Number(m.installation) })) : [{ method: draft.mode === 'digital' ? 'digital' : 'none', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }];
  const request = dispatched.current ?? { values: { mode: draft.mode, methods, files: draft.mode === 'digital' ? draft.files : [], publicNote: draft.publicNote }, revision: settings.revision, operation: crypto.randomUUID() };
  dispatched.current = request; busy.current = true; setPending(true);
  try { const result = await saveGoodsFulfillmentAction(goodId, request.values, request.revision, request.operation, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('settings' in result && result.settings) { setSettings(result.settings); setDraft(draftOf(result.settings)); dispatched.current = null; setUncertain(false); setMessage('배송·제공 설정을 저장했습니다. 기존 주문의 방식·금액·파일은 유지됩니다.'); }
   /* 저장되지 않았다는 답을 받았으면 잠금을 푼다(앞서 결과를 모르던 저장을 다시 보낸 경우에도). 안내가 누르라고 하는 [현재 배송·제공 설정 불러오기]를 누를 수 있어야 한다. */
   else { setMessage(result.error ?? '결과를 확인하지 못했습니다.'); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) dispatched.current = null; }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setMessage(GOODS_FULFILLMENT_SAVE_UNCERTAIN); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <div className="flex min-w-0 flex-col gap-4" data-goods-fulfillment=""><button type="button" className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" disabled={pending || uncertain || Boolean(pendingFile)} onClick={() => { void read(); }}>현재 배송·제공 설정 불러오기</button>
  {draft ? <form className="flex min-w-0 flex-col gap-4" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" disabled={pending || uncertain || Boolean(pendingFile) || Boolean(disabledReason)}><legend className="sr-only">상품 제공 방식</legend>
   <GoodsFulfillmentDraftFields draft={draft} onChange={setDraft} onUpload={file => { void upload(file); }} fieldId={fieldId} />
  </fieldset><button type="submit" className={`${buttonVariants()} self-start`} data-slot="button" disabled={pending || Boolean(pendingFile) || Boolean(disabledReason)}>{uncertain ? '저장됐는지 확인' : '배송·제공 설정 저장'}</button></form> : null}
  {pendingFile ? <p className={`${GOOD_NOTE_CLASS} flex flex-wrap items-center gap-2`} role="status">{pendingFile.name}이(가) 올라갔는지 아직 확인하지 못했습니다. <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" disabled={pending} onClick={() => { void verify(); }}>같은 업로드 결과 확인</button></p> : null}
  {settings ? <p className="text-sm text-muted-foreground wrap-anywhere">저장된 방식: {settings.methods.map(m => `${FULFILLMENT_METHOD_LABELS[m.method]}${m.feeAmount === null ? '' : ` ${krw(m.feeAmount)}`}`).join(', ')}</p> : null}
  {showDisabledReason && disabledReason ? <p className={GOOD_NOTE_CLASS} role="status">{disabledReason}</p> : null}{message ? <p className="text-sm font-medium" role="status">{message}</p> : null}
 </div>;
}
