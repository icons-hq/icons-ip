'use client';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
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
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { cn } from 'cn';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const HINT = 'text-xs text-muted-foreground';
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
    try { sessionStorage.setItem(storageKey, JSON.stringify(value));setRecovery(value);return true; } catch { setMessage('브라우저가 요청 번호를 보관하지 못해 기록하지 않았습니다. 브라우저의 사이트 데이터 저장을 허용한 뒤 주문 화면을 다시 열어 입력해주세요.');return false; }
  }
  const [mustConfirm, setMustConfirm] = useState(Boolean(recovery));const requestBusy = useRef(false);
  const [draft, setDraft] = useState(blank);const [revision, setRevision] = useState(obligation.revision);
  const [pending, setPending] = useState(false);const [request, setRequest] = useState<ShippingCollectEventRequest | null>(null);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
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
      || !Number.isSafeInteger(Number(draft.amount)) || !Number.isFinite(occurred.getTime())) { setMessage('기록 종류를 고르고, 금액은 원 단위 숫자로, 발생 시각은 KST로 입력해주세요.');return; }
    const next: ShippingCollectEventRequest = { ...context, shipmentId: obligation.shipmentId, expectedRevision: revision, operationId: crypto.randomUUID(),
      event: draft.event as ShippingCollectWriteEvent, amount: Number(draft.amount), occurredAt: occurred.toISOString(), party: draft.party.trim(), reversesOperationId: draft.event === 'correction' ? latest?.operationId ?? null : null, reference: draft.reference.trim(), note: draft.note.trim() };
    if (!persistOperation(next.operationId)) return;
    requestBusy.current = true;setPending(true);setRequest(next);setMessage(null);
    try {
      const result = await saveShippingCollectEventAction(next);if (!alive.current || !scope.canApply(ticket)) return;
      if (result.ok) saved(result.value.obligation);
      else { setMessage(result.error);setUncertain(Boolean(result.uncertain));if (!result.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true);setMessage('저장 결과를 확인하지 못했습니다. [이전 결과 확인 후 같은 요청 재시도]를 눌러 저장됐는지 먼저 확인해주세요.'); } }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function checkPrevious(seal = false) {
    if (!recovery || pending || requestBusy.current) return;const ticket = scope.capture();if (!ticket) return;requestBusy.current = true;setPending(true);
    try {
      const result = seal ? await sealShippingCollectOperationAction(recovery) : await readShippingCollectEventOperationAction(recovery);
      if (!alive.current || !scope.canApply(ticket)) return;
      if (!result.ok) { setMessage(result.error);return; }
      if (result.value && (!request || shippingCollectEventReceiptMatches(result.value, request))) { saved(result.value.obligation);return; }
      if (result.value) { setMessage('이 요청 번호로 저장된 기록이 지금 입력과 다릅니다. [최신 내역 불러오기]로 이력을 확인해주세요.');return; }
      if (seal) { setMustConfirm(true);clearRecovery();setRequest(null);setUncertain(false);setDraft(blank);setMessage('이전 요청을 무효로 처리했습니다. 늦게 도착해도 기록되지 않습니다. 최신 내역을 확인하고 올바른 증빙을 새로 입력해주세요.');onReload();return; }
      if (!request) { setMessage('이전 요청은 아직 저장되지 않았습니다. 입력했던 증빙 내용은 보관하지 않으므로 [이전 요청 무효 처리 후 다시 입력]을 누른 뒤 최신 내역을 확인하고 다시 입력해주세요.');return; }
      const retried = await saveShippingCollectEventAction(request);if (!alive.current || !scope.canApply(ticket)) return;
      if (retried.ok) saved(retried.value.obligation);
      else { setMessage(retried.error);setUncertain(Boolean(retried.uncertain));if (!retried.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) setMessage('이전 기록을 확인하지 못했습니다. 잠시 뒤 [이전 결과 확인]을 다시 눌러주세요.'); }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const unresolved = Boolean(recovery) || uncertain;
  useAdminLeaveGuard({ dirty: Object.values(draft).some(Boolean), blocked: unresolved || pending, message: '저장하지 않은 증빙 입력은 브라우저에 남지 않고 사라집니다. 화면을 나가시겠습니까?' });
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={submit}>
    {recovery ? <p className="text-destructive" role="alert">이전 요청 {recovery.operationId}이 저장됐는지 아직 모릅니다. 아래 [이전 결과 확인]을 먼저 눌러주세요. 이 탭에는 요청 번호만 남기고, 입력했던 증빙 내용은 남기지 않습니다.</p> : null}
    {mustConfirm && !recovery ? <p className="flex flex-wrap items-center gap-2" role="status">현재 상태: {SHIPPING_COLLECT_STATE_LABEL[obligation.state]} · 기록 {obligation.revision}. <button className={OUTLINE} data-slot="button" type="button" disabled={pending || !readReady} onClick={() => { setRevision(obligation.revision);setMustConfirm(false); }}>최신 상태 확인 · 새 증빙 입력</button></p> : null}
    {changed ? <p className="flex flex-wrap items-center gap-2 text-destructive" role="alert">다른 사람이 기록을 먼저 추가했습니다. 입력은 그대로 있습니다. 위 이력을 확인한 뒤 <button className={OUTLINE} data-slot="button" type="button" disabled={pending || unresolved} onClick={() => setRevision(obligation.revision)}>최신 기준 적용</button></p> : null}
    <fieldset disabled={pending || unresolved || changed || mustConfirm || !readReady} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="float-left w-full p-0 font-medium">실제 수납·환급 증빙 추가</legend>
      <label className={FIELD}><span className={FIELD_LABEL}>기록 종류</span><select className="w-full sm:w-72" required value={draft.event} onChange={event => update('event', event.target.value)}><option value="">선택해주세요</option>
        {SHIPPING_COLLECT_WRITE_EVENTS.filter(value => value === 'correction' ? latest && latest.event !== 'planned' && latest.event !== 'correction' : !terminal).map(value => <option value={value} key={value}>{value === 'correction' ? '최신 기록 정정 (반대 기록 추가)' : SHIPPING_COLLECT_STATE_LABEL[value]}</option>)}</select></label>
      {draft.event === 'correction' && latest ? <p className="text-muted-foreground">최근 기록 {latest.operationId}을 없던 것으로 되돌리는 기록입니다. 금액은 그 기록과 같은 {krw(latest.amount)}으로 입력합니다. 맞는 내용은 정정한 뒤 새로 기록해주세요.</p> : null}
      <label className={FIELD}><span className={FIELD_LABEL}>실제 확인 금액 (원)</span><input className="w-full tabular-nums sm:w-48" required inputMode="numeric" pattern="[0-9]+" value={draft.amount} onChange={event => update('amount', event.target.value)} /></label>
      <small className={HINT}>주문 당시 착불 금액은 {krw(obligation.amount)}입니다. 미수납 종료는 0원, 외부 수납 확인·전액 환급은 이 금액과 같게 입력합니다.</small>
      <label className={FIELD}><span className={FIELD_LABEL}>실제 발생 시각 (KST)</span><input className="w-full sm:w-64" required type="datetime-local" step="1" value={draft.occurredAt} onChange={event => update('occurredAt', event.target.value)} /></label>
      <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" onClick={() => update('occurredAt', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19))}>현재 시각 입력</button>
      <label className={FIELD}><span className={FIELD_LABEL}>수납·반환 주체</span><input className="w-full" required maxLength={200} value={draft.party} onChange={event => update('party', event.target.value)} /></label>
      <label className={FIELD}><span className={FIELD_LABEL}>운송사 수납·환급 증빙 번호 또는 참조</span><input className="w-full" required maxLength={1000} value={draft.reference} onChange={event => update('reference', event.target.value)} /></label>
      <label className={FIELD}><span className={FIELD_LABEL}>확인 내용</span><input className="w-full" required maxLength={1000} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
      <small className={HINT}>카드번호·계좌번호·수령인 연락처는 입력하지 마세요. 배송 완료만으로 수납된 것으로 기록하지 않습니다.</small>
    </fieldset>
    {message ? <p className={uncertain ? 'text-destructive' : 'text-muted-foreground'} role={uncertain ? 'alert' : 'status'}>{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      {unresolved ? <><button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => void checkPrevious()}>이전 결과 확인{request ? ' 후 같은 요청 재시도' : ''}</button>{!request ? <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => void checkPrevious(true)}>이전 요청 무효 처리 후 다시 입력</button> : null}</>
        : <button className={PRIMARY} data-slot="button" disabled={pending || changed || mustConfirm || !readReady} type="submit">{pending ? '기록 중…' : '증빙 확인 후 기록'}</button>}
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={onReload}>최신 내역 불러오기</button>
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
  return <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground break-words" aria-label="착불 수납 기록" data-shipping-collect="">
    <div className="flex flex-col gap-1">
      <h3 className="text-base leading-snug font-medium">착불 수납 기록</h3><p className="text-muted-foreground">주문 때 온라인으로 결제하지 않고 받는 분이 따로 내는 배송비입니다. 운송사에서 실제로 받거나 돌려준 증빙을 확인해 여기에 따로 기록합니다.</p>
    </div>
    {!visible || visible.key !== key ? <p className="text-muted-foreground" role="status">착불 수납 내역을 확인하는 중입니다…</p> : null}
    {visible?.error ? <><p className="text-destructive" role="alert">{visible.error}</p><button className={`${PRIMARY} w-fit`} data-slot="button" type="button" onClick={reload}>다시 불러오기</button></> : null}
    {visible?.rows?.map(obligation => <article className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" key={`${contextKey}:${obligation.shipmentId}`}>
        <h4 className="font-medium">{obligation.originName} · <span className="tabular-nums">{krw(obligation.amount)}</span></h4><p className="flex flex-wrap items-center gap-2"><AdminStatusBadge tone={statusTone('shippingCollect', obligation.state)}>{SHIPPING_COLLECT_STATE_LABEL[obligation.state]}</AdminStatusBadge> 기록 {obligation.revision}</p>
        <details className="rounded-lg bg-muted/40 px-3 py-2"><summary className="cursor-pointer font-medium">수납·환급 이력 {obligation.events.length}건</summary><ol className="mt-2 flex flex-col gap-2 border-l pl-4">{obligation.events.map(event => <li key={event.operationId}>
          <strong className="font-medium">{event.event === 'correction' ? '증빙 정정' : SHIPPING_COLLECT_STATE_LABEL[event.event]}</strong> · {krw(event.amount)} · 기록 {formatOrderDateTime(event.recordedAt)}
          {event.occurredAt ? <p>발생 {formatOrderDateTime(event.occurredAt)}</p> : null}{event.party ? <p>수납·반환 주체: {event.party}</p> : null}{event.reversesOperationId ? <p>정정 대상: {event.reversesOperationId}</p> : null}{event.reference ? <p>{event.reference}</p> : null}{event.note ? <p className="text-muted-foreground">{event.note}</p> : null}
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
  if (!auth.ready) return <p className="text-sm text-muted-foreground" role="status">착불 수납 기록을 열기 전에 로그인 상태를 확인하는 중입니다…</p>;
  if (auth.blocked || !sessionId) return <p className="text-sm text-destructive" role="alert">로그인 계정이 바뀌었거나 로그인이 끝났습니다. 다시 로그인한 뒤 주문 화면을 다시 열어주세요.</p>;
  return <VerifiedShippingCollectPanel {...props} key={`${props.orderId}:${props.expectedActorId}:${sessionId}`} scope={scope} sessionId={sessionId} />;
}
