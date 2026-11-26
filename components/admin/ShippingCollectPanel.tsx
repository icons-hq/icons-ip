'use client';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sealShippingCollectOperationAction, readShippingCollectEventOperationAction, readShippingCollectEventsAction, saveShippingCollectEventAction } from '@/app/admin/shipping-collect-event-actions';
import { SHIPPING_COLLECT_STATE_LABEL, shippingCollectEventReceiptMatches, parseShippingCollectRecovery, shippingCollectRecoveryKey,
  type ShippingCollectOperationRecovery, type ShippingCollectEventContext, type ShippingCollectEventRequest, type ShippingCollectObligation } from '@/lib/admin/shipping-collect-events';
import { shippingCollectAmountProblem, shippingCollectConfirmRequest, shippingCollectEventLabel, shippingCollectEventSummary, shippingCollectFixedAmount,
  shippingCollectFixedAmountNote, shippingCollectKindOptions, shippingCollectNowLocal, shippingCollectServerMessage } from '@/lib/admin/shipping-collect-form';
import { adminConfirm } from '@/lib/admin/confirm';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { krw, krwAmountWords } from '@/lib/format';
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
/** 새 입력. 발생 시각은 지금으로 시작한다(대부분 확인한 자리에서 바로 기록한다). 금액은 기록 종류를 고르면 채워진다. */
const newDraft = () => ({ event: '', amount: '', occurredAt: shippingCollectNowLocal(), party: '', reference: '', note: '' });
type CollectScope = ReturnType<typeof createGoodsDescriptionToolScope>;
/** 정정 기록이 되돌린 기록을 내부 번호 대신 종류·금액·시각으로 가리킨다. */
function reversedEventSummary(obligation: ShippingCollectObligation, operationId: string) {
  const row = obligation.events.find(other => other.operationId === operationId);
  return row ? shippingCollectEventSummary(row) : '이력에 없음';
}
function CollectEvidenceForm({ context, obligation, onSaved, onReload, scope, sessionId, readReady, orderStatus }: {
  scope: CollectScope; sessionId: string; readReady: boolean; context: ShippingCollectEventContext; obligation: ShippingCollectObligation; onSaved: (value: ShippingCollectObligation) => void; onReload: () => void;
  /** 주문 상태. 주면 취소된 주문에서만 고를 수 있는 기록 종류를 미리 잠그고, 모르면 서버가 판단한다. */
  orderStatus?: string;
}) {
  const storageKey = shippingCollectRecoveryKey(context, sessionId, obligation.shipmentId);
  const [recovery, setRecovery] = useState<ShippingCollectOperationRecovery | null>(() => {
    try { return parseShippingCollectRecovery(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'), context, sessionId, obligation.shipmentId); } catch { return null; }
  });
  function clearRecovery() { try { sessionStorage.removeItem(storageKey); } catch {} setRecovery(null); }
  function persistOperation(operationId: string) {
    const value: ShippingCollectOperationRecovery = { ...context, version: 1, sessionId, shipmentId: obligation.shipmentId, operationId };
    try { sessionStorage.setItem(storageKey, JSON.stringify(value));setRecovery(value);return true; } catch { setMessage('브라우저가 저장 상태를 보관하지 못해 기록하지 않았습니다. 브라우저의 사이트 데이터 저장을 허용한 뒤 주문 화면을 다시 열어 입력해주세요.');return false; }
  }
  const [mustConfirm, setMustConfirm] = useState(Boolean(recovery));const requestBusy = useRef(false);
  const [draft, setDraft] = useState(newDraft);const [revision, setRevision] = useState(obligation.revision);
  const [pending, setPending] = useState(false);const [request, setRequest] = useState<ShippingCollectEventRequest | null>(null);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [uncertain, setUncertain] = useState(false);const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const latest = obligation.events.at(-1);const terminal = obligation.state === 'void' || obligation.state === 'refunded';
  const kinds = shippingCollectKindOptions(obligation, orderStatus);
  const fixedAmount = shippingCollectFixedAmount(draft.event, obligation, latest);
  const changed = revision !== obligation.revision;
  /* 기록 종류를 바꾸면 그 종류가 정하는 금액으로 채운다. 금액이 정해지는 종류에서는 금액을 바꿀 수 없다. */
  const update = (key: keyof ReturnType<typeof newDraft>, value: string) => {
    if (!(scope.capture() && !requestBusy.current && !recovery && readReady && !mustConfirm)) return;
    setDraft(current => {
      if (key === 'event') { const fixed = shippingCollectFixedAmount(value, obligation, latest);return { ...current, event: value, amount: fixed === null ? '' : String(fixed) }; }
      if (key === 'amount' && shippingCollectFixedAmount(current.event, obligation, latest) !== null) return current;
      return { ...current, [key]: value };
    });
  };
  const saved = (next: ShippingCollectObligation) => {
    setMustConfirm(Boolean(recovery && !request));clearRecovery();setRevision(next.revision);setDraft(newDraft());setRequest(null);setUncertain(false);setMessage('외부 수납 기록을 저장했습니다. 온라인 결제·환불 금액은 변경하지 않았습니다.');onSaved(next);
  };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if (requestBusy.current || pending || uncertain || changed || recovery || mustConfirm || !readReady) return;
    const ticket = scope.capture();if (!ticket) return;
    const occurred = new Date(`${draft.occurredAt.length === 16 ? `${draft.occurredAt}:00` : draft.occurredAt}+09:00`);
    const kind = kinds.find(option => option.event === draft.event);
    const amountText = fixedAmount === null ? draft.amount : String(fixedAmount);
    if (!kind || !/^(0|[1-9]\d*)$/.test(amountText)
      || !Number.isSafeInteger(Number(amountText)) || !Number.isFinite(occurred.getTime())) { setMessage('기록 종류를 고르고, 금액은 원 단위 숫자로, 발생 시각은 KST로 입력해주세요.');return; }
    if (kind.lock) { setMessage(`${kind.label}: ${kind.lock}`);return; }
    const problem = shippingCollectAmountProblem(draft.event, Number(amountText), obligation);
    if (problem) { setMessage(problem);return; }
    const next: ShippingCollectEventRequest = { ...context, shipmentId: obligation.shipmentId, expectedRevision: revision, operationId: crypto.randomUUID(),
      event: kind.event, amount: Number(amountText), occurredAt: occurred.toISOString(), party: draft.party.trim(), reversesOperationId: kind.event === 'correction' ? latest?.operationId ?? null : null, reference: draft.reference.trim(), note: draft.note.trim() };
    /* 확인창을 기다리는 동안 같은 제출이 또 들어오지 않게 먼저 잠근다. 확인받은 뒤에만 요청 번호를 보관하고 보낸다. */
    requestBusy.current = true;
    const confirmed = await adminConfirm(shippingCollectConfirmRequest({ obligation, event: next.event, amount: next.amount, latest }));
    if (!alive.current || !confirmed || !scope.canApply(ticket)) { requestBusy.current = false;return; }
    if (!persistOperation(next.operationId)) { requestBusy.current = false;return; }
    setPending(true);setRequest(next);setMessage(null);
    try {
      const result = await saveShippingCollectEventAction(next);if (!alive.current || !scope.canApply(ticket)) return;
      if (result.ok) saved(result.value.obligation);
      else { setMessage(shippingCollectServerMessage(result.error));setUncertain(Boolean(result.uncertain));if (!result.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true);setMessage('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.'); } }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function checkPrevious(seal = false) {
    if (!recovery || pending || requestBusy.current) return;const ticket = scope.capture();if (!ticket) return;requestBusy.current = true;setPending(true);
    try {
      const result = seal ? await sealShippingCollectOperationAction(recovery) : await readShippingCollectEventOperationAction(recovery);
      if (!alive.current || !scope.canApply(ticket)) return;
      if (!result.ok) { setMessage(shippingCollectServerMessage(result.error));return; }
      if (result.value && (!request || shippingCollectEventReceiptMatches(result.value, request))) { saved(result.value.obligation);return; }
      if (result.value) { setMessage('저장된 기록이 지금 입력한 내용과 다릅니다. [최신 내역 불러오기]로 이력을 확인해주세요.');return; }
      if (seal) { setMustConfirm(true);clearRecovery();setRequest(null);setUncertain(false);setDraft(newDraft());setMessage('이전에 보낸 기록은 그만뒀습니다. 늦게 도착해도 저장되지 않습니다. 이력을 확인하고 올바른 내용을 새로 입력해주세요.');onReload();return; }
      if (!request) { setMessage('아직 저장되지 않았습니다. 입력했던 내용은 남아 있지 않으니 [그만두고 다시 하기]를 누른 뒤 이력을 확인하고 다시 입력해주세요.');return; }
      const retried = await saveShippingCollectEventAction(request);if (!alive.current || !scope.canApply(ticket)) return;
      if (retried.ok) saved(retried.value.obligation);
      else { setMessage(shippingCollectServerMessage(retried.error));setUncertain(Boolean(retried.uncertain));if (!retried.uncertain) { setRequest(null);clearRecovery(); } }
    } catch { if (alive.current && scope.canApply(ticket)) setMessage('확인하지 못했습니다. 잠시 뒤 [저장됐는지 확인]을 다시 눌러주세요.'); }
    finally { requestBusy.current = false;if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const unresolved = Boolean(recovery) || uncertain;
  /* 처음 값(발생 시각)은 입력으로 치지 않는다. 종류를 고르거나 글을 적어야 '저장하지 않은 입력'이다. */
  useAdminLeaveGuard({ dirty: Boolean(draft.event || draft.party || draft.reference || draft.note), blocked: unresolved || pending, message: '저장하지 않은 증빙 입력은 브라우저에 남지 않고 사라집니다. 화면을 나가시겠습니까?' });
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={submit}>
    {recovery ? <p className="text-destructive" role="alert">보낸 기록이 저장됐는지 아직 모릅니다. [저장됐는지 확인]을 먼저 눌러주세요.{request ? '' : ' 화면을 다시 열어 입력했던 내용은 남아 있지 않습니다. 저장되지 않았다면 [그만두고 다시 하기]로 새로 입력해주세요.'}</p> : null}
    {mustConfirm && !recovery ? <p className="flex flex-wrap items-center gap-2" role="status">현재 상태: {SHIPPING_COLLECT_STATE_LABEL[obligation.state]}. 위 이력을 확인한 뒤 <button className={OUTLINE} data-slot="button" type="button" disabled={pending || !readReady} onClick={() => { setRevision(obligation.revision);setMustConfirm(false); }}>새로 입력하기</button></p> : null}
    {changed ? <p className="flex flex-wrap items-center gap-2 text-destructive" role="alert">다른 사람이 먼저 기록을 추가했습니다. 입력한 내용은 그대로 있습니다. 위 이력을 확인한 뒤 <button className={OUTLINE} data-slot="button" type="button" disabled={pending || unresolved} onClick={() => setRevision(obligation.revision)}>최신 이력 기준으로 계속</button></p> : null}
    <fieldset disabled={pending || unresolved || changed || mustConfirm || !readReady} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="float-left w-full p-0 font-medium">수납 기록 추가</legend>
      <label className={FIELD}><span className={FIELD_LABEL}>기록 종류</span><select className="w-full sm:w-72" required value={draft.event} onChange={event => update('event', event.target.value)}><option value="">선택해주세요</option>
        {kinds.map(option => <option value={option.event} key={option.event} disabled={Boolean(option.lock)}>{option.label}{option.lock ? ` · ${option.lock}` : ''}</option>)}</select></label>
      {terminal ? <small className={HINT}>이미 끝난 기록입니다. 잘못 적었다면 ‘바로 앞 기록 정정’만 할 수 있습니다.</small> : null}
      {draft.event === 'correction' && latest ? <p className="text-muted-foreground">바로 앞 기록({shippingCollectEventSummary(latest)})을 없던 것으로 되돌립니다. 맞는 내용은 되돌린 뒤 새로 기록해주세요.</p> : null}
      {draft.event && fixedAmount !== null ? <p className="flex flex-wrap items-baseline gap-x-2" data-collect-amount="fixed"><span className={FIELD_LABEL}>금액</span><span className="tabular-nums">{krwAmountWords(fixedAmount)}</span><small className={HINT}>{shippingCollectFixedAmountNote(draft.event)}</small></p> : null}
      {draft.event && fixedAmount === null ? <label className={FIELD}><span className={FIELD_LABEL}>금액 (원)</span><input className="w-full tabular-nums sm:w-48" required inputMode="numeric" pattern="[0-9]+" value={draft.amount} onChange={event => update('amount', event.target.value)} /></label> : null}
      <label className={FIELD}><span className={FIELD_LABEL}>발생 시각 (KST)</span><input className="w-full sm:w-64" required type="datetime-local" value={draft.occurredAt} onChange={event => update('occurredAt', event.target.value)} /></label>
      <label className={FIELD}><span className={FIELD_LABEL}>수납·반환한 곳 (필수)</span><input className="w-full" required maxLength={200} placeholder="예: 한진택배 김포 영업소" value={draft.party} onChange={event => update('party', event.target.value)} /></label>
      <label className={FIELD}><span className={FIELD_LABEL}>증빙 번호 (필수)</span><input className="w-full" required maxLength={1000} placeholder="예: 운송사 정산서 번호, 영수증 번호" value={draft.reference} onChange={event => update('reference', event.target.value)} /></label>
      <label className={FIELD}><span className={FIELD_LABEL}>확인한 내용 (필수)</span><input className="w-full" required maxLength={1000} placeholder={`예: 운송사 정산서에서 ${krwAmountWords(obligation.amount)} 수납 확인`} value={draft.note} onChange={event => update('note', event.target.value)} /></label>
      <small className={HINT}>이 주문의 수납 이력에 남습니다. 카드번호·계좌번호·연락처는 적지 마세요.</small>
    </fieldset>
    {message ? <p className={uncertain ? 'text-destructive' : 'text-muted-foreground'} role={uncertain ? 'alert' : 'status'}>{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      {unresolved ? <><button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => void checkPrevious()}>저장됐는지 확인</button>{!request ? <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => void checkPrevious(true)}>그만두고 다시 하기</button> : null}</>
        : <button className={PRIMARY} data-slot="button" disabled={pending || changed || mustConfirm || !readReady} type="submit">{pending ? '기록 중…' : '기록하기'}</button>}
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={onReload}>최신 내역 불러오기</button>
    </div>
  </form>;
}
function VerifiedShippingCollectPanel({ orderId, expectedActorId, canManage, orderStatus, scope, sessionId }: ShippingCollectEventContext & { canManage: boolean; orderStatus?: string; scope: CollectScope; sessionId: string }) {
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
      <h3 className="text-base leading-snug font-medium">착불 수납 기록</h3><p className="text-muted-foreground">착불 배송비는 받는 분이 운송사에 직접 냅니다. 운송사가 받았거나 돌려준 것을 확인하면 여기에 기록합니다.</p>
    </div>
    {!visible || visible.key !== key ? <p className="text-muted-foreground" role="status">착불 수납 내역을 확인하는 중입니다…</p> : null}
    {visible?.error ? <><p className="text-destructive" role="alert">{visible.error}</p><button className={`${PRIMARY} w-fit`} data-slot="button" type="button" onClick={reload}>다시 불러오기</button></> : null}
    {visible?.rows?.map(obligation => <article className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" key={`${contextKey}:${obligation.shipmentId}`}>
        <h4 className="font-medium">{obligation.originName} · <span className="tabular-nums">{krw(obligation.amount)}</span></h4><p className="flex flex-wrap items-center gap-2"><AdminStatusBadge tone={statusTone('shippingCollect', obligation.state)}>{SHIPPING_COLLECT_STATE_LABEL[obligation.state]}</AdminStatusBadge></p>
        <details className="rounded-lg bg-muted/40 px-3 py-2"><summary className="cursor-pointer font-medium">수납·환불 이력 {obligation.events.length}건</summary><ol className="mt-2 flex flex-col gap-2 border-l pl-4">{obligation.events.map(event => <li key={event.operationId}>
          <strong className="font-medium">{shippingCollectEventLabel(event.event)}</strong> · {krw(event.amount)} · {formatOrderDateTime(event.recordedAt)}에 기록
          {event.occurredAt ? <p>발생 {formatOrderDateTime(event.occurredAt)}</p> : null}{event.party ? <p>수납·반환한 곳: {event.party}</p> : null}
          {event.reversesOperationId ? <p>되돌린 기록: {reversedEventSummary(obligation, event.reversesOperationId)}</p> : null}
          {event.reference ? <p>증빙 번호: {event.reference}</p> : null}{event.note ? <p className="text-muted-foreground">{event.note}</p> : null}
        </li>)}</ol></details>
        {canManage ? <CollectEvidenceForm readReady={visible.key === key && !visible.error} scope={scope} sessionId={sessionId} context={{ orderId, expectedActorId }} obligation={obligation} orderStatus={orderStatus} onSaved={saved} onReload={reload} /> : null}
      </article>)}
  </section>;
}


export function ShippingCollectPanel(props: ShippingCollectEventContext & { canManage: boolean; orderStatus?: string }) {
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
