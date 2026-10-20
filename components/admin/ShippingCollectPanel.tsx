'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sealShippingCollectOperationAction, readShippingCollectEventOperationAction, readShippingCollectEventsAction, saveShippingCollectEventAction } from '@/app/admin/shipping-collect-event-actions';
import { SHIPPING_COLLECT_STATE_LABEL, SHIPPING_COLLECT_WRITE_EVENTS, shippingCollectEventReceiptMatches, parseShippingCollectRecovery, shippingCollectRecoveryKey,
  type ShippingCollectOperationRecovery, type ShippingCollectEventContext, type ShippingCollectEventRequest, type ShippingCollectObligation, type ShippingCollectWriteEvent } from '@/lib/admin/shipping-collect-events';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
const blank = { event: '', amount: '', occurredAt: '', party: '', reference: '', note: '' };
type CollectScope = ReturnType<typeof createGoodsDescriptionToolScope>;
function CollectEvidenceForm({ context, obligation, onSaved, onReload, scope, sessionId, readReady }: {
  scope: CollectScope; sessionId: string; readReady: boolean; context: ShippingCollectEventContext; obligation: ShippingCollectObligation; onSaved: (value: ShippingCollectObligation) => void; onReload: () => void;
}) {
  const storageKey = shippingCollectRecoveryKey(context, sessionId, obligation.shipmentId);
  const [recovery, setRecovery] = useState<ShippingCollectOperationRecovery | null>(() => {
    try { return parseShippingCollectRecovery(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'), context, sessionId, obligation.shipmentId); } catch { return null; }
  });
  function clearRecovery() { try { sessionStorage.removeItem(storageKey); } catch {} setRecovery(null); }
  function persistOperation(operationId: string) {
    const value: ShippingCollectOperationRecovery = { ...context, version: 1, sessionId, shipmentId: obligation.shipmentId, operationId };
    try { sessionStorage.setItem(storageKey, JSON.stringify(value));setRecovery(value);return true; } catch { setMessage('요청 번호를 보관할 수 없습니다. 브라우저 저장소를 사용할 수 있는 상태에서 다시 열어주세요.');return false; }
  }
  const [mustConfirm, setMustConfirm] = useState(Boolean(recovery));const requestBusy = useRef(false);
  const [draft, setDraft] = useState(blank);const [revision, setRevision] = useState(obligation.revision);
  const [pending, setPending] = useState(false);const [request, setRequest] = useState<ShippingCollectEventRequest | null>(null);
  const [uncertain, setUncertain] = useState(false);const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const latest = obligation.events.at(-1);const terminal = obligation.state === 'void' || obligation.state === 'refunded';
  const changed = revision !== obligation.revision;
  const update = (key: keyof typeof blank, value: string) => { if (scope.capture() && !requestBusy.current && !recovery && readReady && !mustConfirm) setDraft(current => ({ ...current, [key]: value })); };
  const saved = (next: ShippingCollectObligation) => {
    setMustConfirm(Boolean(recovery && !request));clearRecovery();setRevision(next.revision);setDraft(blank);setRequest(null);setUncertain(false);setMessage('외부 수납 기록을 저장했습니다. 온라인 결제·환불 금액은 변경하지 않았습니다.');onSaved(next);
  };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if (requestBusy.current || pending || uncertain || changed || recovery || mustConfirm || !readReady) return;
    const ticket = scope.capture();if (!ticket) return;
    const occurred = new Date(`${draft.occurredAt.length === 16 ? `${draft.occurredAt}:00` : draft.occurredAt}+09:00`);
    if (!SHIPPING_COLLECT_WRITE_EVENTS.includes(draft.event as ShippingCollectWriteEvent) || !/^(0|[1-9]\d*)$/.test(draft.amount)
      || !Number.isSafeInteger(Number(draft.amount)) || !Number.isFinite(occurred.getTime())) { setMessage('실제 금액과 한국 시간 기준 시각을 확인해주세요.');return; }
    const next: ShippingCollectEventRequest = { ...context, shipmentId: obligation.shipmentId, expectedRevision: revision, operationId: crypto.randomUUID(),
      event: draft.event as ShippingCollectWriteEvent, amount: Number(draft.amount), occurredAt: occurred.toISOString(), party: draft.party.trim(), reversesOperationId: draft.event === 'correction' ? latest?.operationId ?? null : null, reference: draft.reference.trim(), note: draft.note.trim() };
    if (!persistOperation(next.operationId)) return;
    requestBusy.current = true;setPending(true);setRequest(next);setMessage(null);
    try {
      const result = await saveShippingCollectEventAction(next);if (!alive.current || !scope.canApply(ticket)) return;
      if (result.ok) saved(result.value.obligation);
      else { setMessage(result.error);setUncertain(Boolean(result.uncertain));if (!result.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true);setMessage('저장 결과를 확인하지 못했습니다. 같은 요청의 기록을 먼저 확인해주세요.'); } }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function checkPrevious(seal = false) {
    if (!recovery || pending || requestBusy.current) return;const ticket = scope.capture();if (!ticket) return;requestBusy.current = true;setPending(true);
    try {
      const result = seal ? await sealShippingCollectOperationAction(recovery) : await readShippingCollectEventOperationAction(recovery);
      if (!alive.current || !scope.canApply(ticket)) return;
      if (!result.ok) { setMessage(result.error);return; }
      if (result.value && (!request || shippingCollectEventReceiptMatches(result.value, request))) { saved(result.value.obligation);return; }
      if (result.value) { setMessage('이전 기록이 현재 입력과 다릅니다. 내역을 확인해주세요.');return; }
      if (seal) { setMustConfirm(true);clearRecovery();setRequest(null);setUncertain(false);setDraft(blank);setMessage('이전 요청을 봉인했습니다. 최신 내역을 확인하고 올바른 증빙을 새로 입력해주세요.');onReload();return; }
      if (!request) { setMessage('아직 저장된 기록이 없습니다. 증빙 본문은 보관하지 않았으므로 이전 요청을 봉인한 뒤 최신 내역을 확인해주세요.');return; }
      const retried = await saveShippingCollectEventAction(request);if (!alive.current || !scope.canApply(ticket)) return;
      if (retried.ok) saved(retried.value.obligation);
      else { setMessage(retried.error);setUncertain(Boolean(retried.uncertain));if (!retried.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) setMessage('이전 기록을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const unresolved = Boolean(recovery) || uncertain;
  useEffect(() => {
    if (!unresolved && !pending && !Object.values(draft).some(Boolean)) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault();event.returnValue = ''; };
    const navigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href, location.href);if (target.href === location.href) return;
      if (unresolved || pending || !window.confirm('입력한 증빙은 브라우저에 보관하지 않습니다. 화면을 나가시겠습니까?')) { event.preventDefault();event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload);document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', unload);document.removeEventListener('click', navigation, true); };
  }, [unresolved, pending, draft]);
  return <form className="col" onSubmit={submit} style={{ gap: 12 }}>
    {recovery ? <p role="alert">이전 요청 {recovery.operationId}의 결과를 먼저 확인해주세요. 요청 번호만 이 탭에 보관하며 증빙 본문은 저장하지 않습니다.</p> : null}
    {mustConfirm && !recovery ? <p role="status">현재 상태: {SHIPPING_COLLECT_STATE_LABEL[obligation.state]} · 기록 {obligation.revision}. <button className="btn btn--ghost" type="button" disabled={pending || !readReady} onClick={() => { setRevision(obligation.revision);setMustConfirm(false); }}>최신 상태 확인 · 새 증빙 입력</button></p> : null}
    {changed ? <p role="alert">다른 기록이 추가됐습니다. 입력은 유지됩니다. 최신 이력을 확인한 뒤 <button className="btn btn--ghost" type="button" disabled={pending || unresolved} onClick={() => setRevision(obligation.revision)}>최신 기준 적용</button></p> : null}
    <fieldset disabled={pending || unresolved || changed || mustConfirm || !readReady} className="col" style={{ border: 0, padding: 0, gap: 10 }}>
      <legend>실제 수납·환급 증빙 추가</legend>
      <label>기록 종류<select required value={draft.event} onChange={event => update('event', event.target.value)}><option value="">선택해주세요</option>
        {SHIPPING_COLLECT_WRITE_EVENTS.filter(value => value === 'correction' ? latest && latest.event !== 'planned' && latest.event !== 'correction' : !terminal).map(value => <option value={value} key={value}>{value === 'correction' ? '최신 기록 정정 (반대 기록 추가)' : SHIPPING_COLLECT_STATE_LABEL[value]}</option>)}</select></label>
      {draft.event === 'correction' && latest ? <p>최근 기록 {latest.operationId}을 취소하는 반대 기록입니다. 정정 금액은 {krw(latest.amount)}이며 올바른 사실은 정정 후 새로 기록해주세요.</p> : null}
      <label>실제 확인 금액 (원)<input required inputMode="numeric" pattern="[0-9]+" value={draft.amount} onChange={event => update('amount', event.target.value)} /></label>
      <small>주문 당시 착불 금액 {krw(obligation.amount)}. 미수납 종료는 0원, 수납·전액 환급은 예정 금액과 일치해야 합니다.</small>
      <label>실제 발생 시각 (한국 시간)<input required type="datetime-local" step="1" value={draft.occurredAt} onChange={event => update('occurredAt', event.target.value)} /></label>
      <button className="btn btn--ghost" type="button" onClick={() => update('occurredAt', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19))}>현재 시각 입력</button>
      <label>수납·반환 주체<input required maxLength={200} value={draft.party} onChange={event => update('party', event.target.value)} /></label>
      <label>운송사 수납·환급 증빙 번호 또는 참조<input required maxLength={1000} value={draft.reference} onChange={event => update('reference', event.target.value)} /></label>
      <label>확인 내용<input required maxLength={1000} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
      <small>카드번호·계좌번호·수령인 연락처는 입력하지 마세요. 배송 완료만으로 수납된 것으로 기록하지 않습니다.</small>
    </fieldset>
    {message ? <p role={uncertain ? 'alert' : 'status'}>{message}</p> : null}
    <div className="row" style={{ gap: 8 }}>
      {unresolved ? <><button className="btn" type="button" disabled={pending} onClick={() => void checkPrevious()}>이전 결과 확인{request ? ' 후 같은 요청 재시도' : ''}</button>{!request ? <button className="btn btn--ghost" type="button" disabled={pending} onClick={() => void checkPrevious(true)}>이전 요청 봉인 후 다시 입력</button> : null}</>
        : <button className="btn" disabled={pending || changed || mustConfirm || !readReady} type="submit">{pending ? '기록 중…' : '증빙 확인 후 기록'}</button>}
      <button className="btn btn--ghost" type="button" disabled={pending} onClick={onReload}>최신 내역 불러오기</button>
    </div>
  </form>;
}
function VerifiedShippingCollectPanel({ orderId, expectedActorId, canManage, scope, sessionId }: ShippingCollectEventContext & { canManage: boolean; scope: CollectScope; sessionId: string }) {
  const contextKey = `${orderId}:${expectedActorId}`;const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; rows?: ShippingCollectObligation[]; error?: string } | null>(null);
  const key = `${contextKey}:${refresh}`;
  useEffect(() => {
    let active = true;const ticket = scope.capture();if (!ticket) return;
    void readShippingCollectEventsAction({ orderId, expectedActorId }).then(result => {
      if (active && scope.canApply(ticket)) setLoaded(previous => result.ok ? { key, rows: result.value }
        : { key, rows: previous?.key.startsWith(`${contextKey}:`) ? previous.rows : undefined, error: result.error });
    }, () => { if (active && scope.canApply(ticket)) setLoaded(previous => ({ key, rows: previous?.key.startsWith(`${contextKey}:`) ? previous.rows : undefined, error: '착불 수납 내역을 확인하지 못했습니다.' })); });
    return () => { active = false; };
  }, [key, contextKey, orderId, expectedActorId, scope]);
  const visible = loaded?.key.startsWith(`${contextKey}:`) ? loaded : null;const reload = () => setRefresh(value => value + 1);
  const saved = (value: ShippingCollectObligation) => {
    setLoaded(previous => ({ key, rows: previous?.rows?.map(row => row.shipmentId === value.shipmentId && row.revision <= value.revision ? value : row) }));reload();
  };
  if (visible?.rows?.length === 0) return null;
  return <section className="card col wc-admin-kit" aria-label="착불 수납 원장" style={{ padding: 16, gap: 16 }}>
    <h3 style={{ margin: 0 }}>착불 수납 원장</h3><p>주문 시 온라인으로 결제하지 않은 배송비입니다. 실제 운송사 수납·환급 증빙을 별도로 기록합니다.</p>
    {!visible || visible.key !== key ? <p role="status">착불 수납 내역을 확인하는 중입니다…</p> : null}
    {visible?.error ? <><p role="alert">{visible.error}</p><button className="btn" onClick={reload}>다시 불러오기</button></> : null}
    {visible?.rows?.map(obligation => <article className="col" key={`${contextKey}:${obligation.shipmentId}`} style={{ gap: 12 }}>
        <h4 style={{ margin: 0 }}>{obligation.originName} · {krw(obligation.amount)}</h4><p>{SHIPPING_COLLECT_STATE_LABEL[obligation.state]} · 기록 {obligation.revision}</p>
        <details><summary>수납·환급 이력 {obligation.events.length}건</summary><ol>{obligation.events.map(event => <li key={event.operationId}>
          <strong>{event.event === 'correction' ? '증빙 정정' : SHIPPING_COLLECT_STATE_LABEL[event.event]}</strong> · {krw(event.amount)} · 기록 {formatOrderDateTime(event.recordedAt)}
          {event.occurredAt ? <p>발생 {formatOrderDateTime(event.occurredAt)}</p> : null}{event.party ? <p>수납·반환 주체: {event.party}</p> : null}{event.reversesOperationId ? <p>정정 대상: {event.reversesOperationId}</p> : null}{event.reference ? <p>{event.reference}</p> : null}{event.note ? <p>{event.note}</p> : null}
        </li>)}</ol></details>
        {canManage ? <CollectEvidenceForm readReady={visible.key === key && !visible.error} scope={scope} sessionId={sessionId} context={{ orderId, expectedActorId }} obligation={obligation} onSaved={saved} onReload={reload} /> : null}
      </article>)}
  </section>;
}


export function ShippingCollectPanel(props: ShippingCollectEventContext & { canManage: boolean }) {
  const scope = useMemo(() => ({ ...createGoodsDescriptionToolScope(props.expectedActorId), orderId: props.orderId }), [props.expectedActorId, props.orderId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    scope.setEnabled(true);scope.activate();
    const discard = () => {
      try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i);if (key?.startsWith('icons:shipping-collect:operation:v1:')) sessionStorage.removeItem(key); } } catch {}
    };
    const signOut = () => { scope.authenticate(null, null);discard();setSessionId(null); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => {
      const id = session ? inquiryDraftSessionId(session.access_token) : null;scope.authenticate(session?.user.id ?? null, id);
      if (scope.getSnapshot().blocked) { discard();setSessionId(null); } else setSessionId(id);
    }).data.subscription : null;
    return () => { scope.dispose();subscription?.unsubscribe();window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [scope]);
  if (!auth.ready) return <p role="status">착불 원장 조회를 위해 로그인 상태를 확인하는 중입니다…</p>;
  if (auth.blocked || !sessionId) return <p role="alert">계정 또는 로그인 세션이 바뀌었습니다. 현재 계정으로 주문 화면을 다시 열어주세요.</p>;
  return <VerifiedShippingCollectPanel {...props} key={`${props.orderId}:${props.expectedActorId}:${sessionId}`} scope={scope} sessionId={sessionId} />;
}
