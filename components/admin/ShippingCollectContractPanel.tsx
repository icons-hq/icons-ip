'use client';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readShippingCollectContractAction, readShippingCollectOperationAction, saveShippingCollectContractAction } from '@/app/admin/shipping-collect-contract-actions';
import { readGoodsTransactionRuntimeAction } from '@/app/admin/goods-transaction-runtime-actions';
import { SHIPPING_COLLECT_EXAMPLES, SHIPPING_COLLECT_FIELDS, SHIPPING_COLLECT_INVALID_MESSAGE, SHIPPING_COLLECT_LABELS, SHIPPING_COLLECT_OFF_CONFIRM, SHIPPING_COLLECT_RUNTIME_OFF,
  SHIPPING_COLLECT_UNKNOWN_MESSAGE, parseShippingCollectPending, parseShippingCollectRequest, sameShippingCollectDocument, sameShippingCollectValues, shippingCollectFieldLimit,
  shippingCollectMissingLabels, shippingCollectRequiredMessage, shippingCollectStatusLabel,
  type ShippingCollectDocument, type ShippingCollectPending, type ShippingCollectReceipt, type ShippingCollectRequest, type ShippingCollectStatus, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { adminConfirm } from '@/lib/admin/confirm';
import { CHANGED_BY_OTHER, RELOAD_SAVED_CONFIRM, SAVE_CHECK_LABEL, SAVE_STOP_LABEL, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE } from '@/lib/admin/goods-template-save';
import { statusTone } from '@/lib/admin/status-tone';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/client';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { GoodReadback } from './GoodEditorParts';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const TABLE_HEAD = 'h-9 px-2 text-left align-middle font-medium whitespace-nowrap';
const TABLE_CELL = 'px-2 py-1.5 align-middle';
const SAVE_LABEL = '착불 조건 저장';
const SAVED_VIEW_LABEL = '지금 저장된 내용 보기';
const RESTART_LABEL = SAVE_STOP_LABEL;
const LEAVE_MESSAGE = `착불 조건을 고친 뒤 [${SAVE_LABEL}]을 누르지 않았습니다. 이 화면을 떠나면 적은 내용이 사라집니다. 이동할까요?`;

type Edit = { base: ShippingCollectDocument; values: ShippingCollectValues; status: ShippingCollectStatus; latest: ShippingCollectDocument | null;
  retry: ShippingCollectRequest | null; pending: ShippingCollectPending | null; lookupMissing: boolean };
const fresh = (document: ShippingCollectDocument): Edit => ({ base: document, values: document.values, status: document.status, latest: null, retry: null, pending: null, lookupMissing: false });
const documentOf = (receipt: ShippingCollectReceipt): ShippingCollectDocument => ({ originId: receipt.originId, revision: receipt.revision, versionId: receipt.versionId, status: receipt.status, values: receipt.values });
const trimmed = (values: ShippingCollectValues) => Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, values[key].trim()])) as ShippingCollectValues;

/** 저장됐는지 모를 때 상자에 보이는 말. 새로고침 뒤에는 적었던 내용이 화면에 없어(브라우저에 남기지 않는다) 조회만 할 수 있다. */
function pendingNotice(edit: Edit): string {
  if (edit.retry) return SHIPPING_COLLECT_UNKNOWN_MESSAGE;
  if (edit.lookupMissing) return `앞서 누른 저장이 됐는지 아직 확인되지 않습니다. 잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 누르거나, [${RESTART_LABEL}]를 눌러 지금 저장된 내용에서 다시 적어 주세요.`;
  return `앞서 누른 저장이 됐는지 확인하지 못했습니다. [${SAVE_CHECK_LABEL}]을 눌러 주세요. 적었던 내용은 화면에 남아 있지 않습니다.`;
}

/**
 * 고른 사용 여부를 한 줄로 되읽는다('글보다 화면' 3단계). 착불은 켜는 것만으로 주문이 생기지 않고, 상품에서 착불을 골라야 한다.
 * 착불 배송비는 온라인 결제 금액에 들어가지 않는다(주문서도 그렇게 말한다).
 */
function collectReadback(status: ShippingCollectStatus, values: ShippingCollectValues): string {
  if (status !== 'active') return '이 출고지 상품은 착불로 팔 수 없습니다.';
  const collector = values.collectorName.trim();
  return `이 출고지 상품의 '이 상품만의 배송비 규칙'에서 착불을 고를 수 있습니다. 착불 주문은 고객이 상품을 받을 때 ${collector ? `${collector}에게 ` : ''}배송비를 내고, 온라인 결제 금액에는 들어가지 않습니다.`;
}

/**
 * 출고지의 착불 조건. 사용으로 저장해야 그 출고지 상품에서 착불을 켤 수 있다.
 * 네 칸은 모두 고객에게 보인다. 예전의 근거 네 칸은 걷어 냈다(2026-11-26 — 읽는 주문·정산 처리가 없었다).
 * `originActive`: 출고지의 사용 여부. 사용 안 함인 출고지에는 착불 조건을 저장할 수 없어 미리 잠근다(넘기지 않으면 잠그지 않는다).
 */
export function ShippingCollectContractPanel({ originId, accountId, canEdit, originActive }: { originId: string; accountId: string; canEdit: boolean; originActive?: boolean }) {
  const scope = useMemo(() => ({ ...createGoodsDescriptionToolScope(accountId), originId }), [accountId, originId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [sessionId, setSessionId] = useState<string | null>(null), [stored, setStored] = useState<{ scope: typeof scope; edit: Edit } | null>(null);
  const edit = stored?.scope === scope ? stored.edit : null;
  const setEdit = useMemo(() => (next: Edit) => setStored({ scope, edit: next }), [scope]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [storageUnavailable, setStorageUnavailable] = useState(false);
  /* 쇼핑몰 주문 설정. true 켜짐 · false 꺼짐 · null 아직 모름(읽는 중이거나 읽지 못함). 꺼져 있으면 '사용'을 고르기 전에 막는다. */
  const [runtime, setRuntime] = useState<boolean | null>(null);
  const lane = useRef(false), valid = auth.ready && !auth.blocked;
  const key = `icons:admin:collect-operation:v1:${JSON.stringify([accountId, originId])}`;
  const dirty = Boolean(edit && (edit.status !== edit.base.status || !sameShippingCollectValues(edit.values, edit.base.values)));
  const protect = dirty || busy || Boolean(edit?.pending);
  const removePending = useMemo(() => () => { try { sessionStorage.removeItem(key); } catch { setStorageUnavailable(true); } }, [key]);
  function savePending(pending: ShippingCollectPending) { try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch { setStorageUnavailable(true); } }
  useEffect(() => {
    scope.setEnabled(true); scope.activate(); let first: string | null = null;
    const signOut = () => { scope.authenticate(null, null); removePending(); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => {
      const id = session ? inquiryDraftSessionId(session.access_token) : null;
      if (session?.user.id !== accountId || !id || first !== null && first !== id) removePending();
      else { first = id; setSessionId(id); }
      scope.authenticate(session?.user.id ?? null, id);
    }).data.subscription : null;
    return () => { scope.dispose(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [scope, accountId, removePending]);
  useEffect(() => {
    if (!valid || !sessionId) return;
    const ticket = scope.capture(); if (!ticket) return;
    void readShippingCollectContractAction({ originId, expectedActorId: accountId }).then(result => {
      if (!scope.canApply(ticket)) return;
      if (!result.ok) { setError(result.error); return; }
      let pending: ShippingCollectPending | null = null;
      try { pending = parseShippingCollectPending(JSON.parse(sessionStorage.getItem(key) ?? 'null')); } catch { setStorageUnavailable(true); }
      if (pending?.sessionId !== sessionId || pending.originId !== originId) { pending = null; removePending(); }
      setEdit({ ...fresh(result.value), pending });
    }).catch(() => { if (scope.canApply(ticket)) setError('착불 조건을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.'); });
  }, [valid, sessionId, scope, originId, accountId, key, removePending, setEdit]);
  useEffect(() => {
    if (!valid) return;
    let live = true;
    void readGoodsTransactionRuntimeAction().then(value => { if (live) setRuntime(value); }, () => { if (live) setRuntime(null); });
    return () => { live = false; };
  }, [valid]);
  useAdminLeaveGuard({ dirty: valid && protect, blocked: valid && busy, message: LEAVE_MESSAGE });
  /* [지금 저장된 내용 보기]: 그사이 다른 사람이 바꿨으면 비교 상자를 연다. 처음 불러오지 못했을 때는 같은 조회로 다시 불러온다. */
  async function refresh() {
    if (!valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true; setBusy(true);
    try {
      const result = await readShippingCollectContractAction({ originId, expectedActorId: accountId }); if (!scope.canApply(ticket)) return;
      if (!result.ok) { setError(result.error); return; }
      setError('');
      if (!edit) { setEdit(fresh(result.value)); return; }
      if (sameShippingCollectDocument(result.value, edit.base)) { setEdit({ ...edit, latest: null }); setMessage('다른 사람이 바꾼 내용이 없습니다.'); return; }
      setEdit({ ...edit, latest: result.value }); setMessage('');
    } catch { if (scope.canApply(ticket)) setError(`지금 저장된 내용을 불러오지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 [${SAVED_VIEW_LABEL}]를 다시 눌러 주세요.`); }
    finally { lane.current = false; setBusy(false); }
  }
  /* 새로고침 뒤처럼 저장하려던 내용이 화면에 없을 때: 앞서 누른 저장이 됐는지만 조회한다(다시 저장하지 않는다). */
  async function checkOperation() {
    if (!edit?.pending || !valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true; setBusy(true); setError('');
    try {
      const result = await readShippingCollectOperationAction({ originId, expectedActorId: accountId, operationId: edit.pending.operationId }); if (!scope.canApply(ticket)) return;
      if (!result.ok) { setError(result.error); return; }
      const { receipt, latest } = result.value;
      if (!receipt) {
        /* 아직 저장 기록이 없다. 저장되지 않았다고 단정할 수 없어 잠금은 그대로 두고, 상자의 안내를 바꾼다. */
        setEdit({ ...edit, latest, lookupMissing: true });
        return;
      }
      removePending();
      setEdit(fresh(latest ?? documentOf(receipt)));
      setMessage(latest && !sameShippingCollectDocument(latest, documentOf(receipt)) ? '앞서 누른 저장이 됐습니다. 그 뒤에 다른 사람이 다시 바꿔, 지금 저장된 내용을 보여 드립니다.' : '앞서 누른 저장이 됐습니다.');
    } catch { if (scope.canApply(ticket)) setError(`저장됐는지 확인하지 못했습니다. 잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`); }
    finally { lane.current = false; setBusy(false); }
  }
  /**
   * 저장. `original`은 결과를 모르는 저장을 같은 내용 그대로 다시 보낼 때([저장됐는지 확인] — 두 번 저장되지 않는다),
   * `base`는 다른 사람이 먼저 바꾼 내용 위에 내 입력을 덮어쓸 때 넘긴다.
   */
  async function save({ original, base: over }: { original?: ShippingCollectRequest; base?: ShippingCollectDocument } = {}) {
    if (!edit || !valid || !sessionId || !canEdit || lane.current || edit.pending && !original) return;
    const base = over ?? edit.base;
    let request = original ?? null;
    if (!request) {
      const values = trimmed(edit.values), missing = edit.status === 'active' ? shippingCollectMissingLabels(values) : [];
      if (missing.length) { setError(shippingCollectRequiredMessage(missing)); return; }
      if (edit.status === 'active' && base.status !== 'active' && runtime === false) { setError(SHIPPING_COLLECT_RUNTIME_OFF); return; }
      request = parseShippingCollectRequest({ originId, expectedActorId: accountId, expectedRevision: base.revision, operationId: crypto.randomUUID(), status: edit.status, values });
      if (!request) { setError(SHIPPING_COLLECT_INVALID_MESSAGE); return; }
    }
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true;
    try {
      /* 착불을 끄면 주문이 막히는 상품이 있다. 저장하기 전에 한 번 묻는다. */
      if (!original && base.status === 'active' && request.status !== 'active') {
        if (!await adminConfirm(SHIPPING_COLLECT_OFF_CONFIRM) || !scope.canApply(ticket)) return;
      }
      const working: Edit = { ...edit, base, values: request.values, latest: null, lookupMissing: false };
      const pending: ShippingCollectPending = { version: 1, sessionId, originId, operationId: request.operationId };
      savePending(pending); setEdit({ ...working, retry: request, pending }); setBusy(true); setError(''); setMessage('');
      const result = await saveShippingCollectContractAction(request); if (!scope.canApply(ticket)) return;
      if (!result.ok) {
        if (!result.uncertain) removePending();
        let latest = result.latest ?? null;
        /* 다른 사람이 먼저 바꿔 거절됐으면 지금 저장된 내용을 바로 읽어 비교 상자를 연다. */
        if (!result.uncertain && result.conflict && !latest) {
          const read = await readShippingCollectContractAction({ originId, expectedActorId: accountId }).catch(() => null);
          if (!scope.canApply(ticket)) return;
          latest = read?.ok ? read.value : null;
        }
        /* 저장은 됐는데 그 뒤 내용을 다시 읽지 못했거나 또 바뀐 경우: 내 저장을 기준으로 삼는다. */
        const next = result.committed ? documentOf(result.committed) : base;
        setEdit({ ...working, base: next, retry: result.uncertain ? request : null, pending: result.uncertain ? pending : null,
          latest: latest && !sameShippingCollectDocument(latest, next) ? latest : null });
        /* 결과를 모를 때는 아래 상자가 말한다(같은 문장을 두 번 보이지 않는다). 다른 사람이 먼저 바꿨는데 지금 저장된 내용을 읽지 못했으면 비교 상자가 없어, 여는 버튼을 말한다. */
        setError(result.uncertain ? '' : result.conflict && !result.committed && !latest
          ? `${CHANGED_BY_OTHER} 지금 저장된 내용을 불러오지 못했습니다. 적은 내용은 그대로 있습니다. [${SAVED_VIEW_LABEL}]를 눌러 비교해 주세요.` : result.error);
        return;
      }
      removePending(); setEdit(fresh(result.value));
      setMessage(result.value.status === 'active' ? '착불 조건을 사용으로 저장했습니다. 이제 이 출고지 상품에서 착불을 켤 수 있습니다.' : '착불 조건을 사용 안 함으로 저장했습니다.');
    } catch { /* 결과를 모른다. 저장 전에 남겨 둔 표시가 아래 상자를 띄운다. */ }
    finally { lane.current = false; setBusy(false); }
  }
  /* [저장됐는지 확인]: 저장하려던 내용이 화면에 남아 있으면 그대로 다시 보내고(두 번 저장되지 않는다), 없으면 조회만 한다. */
  function checkSaved() { if (edit?.retry) void save({ original: edit.retry }); else void checkOperation(); }
  /*
   * [그만두고 다시 하기]: 앞서 누른 저장을 더 기다리지 않고, 지금 저장된 내용을 새로 읽어 거기서 다시 적는다.
   * 저장하려던 내용이 화면에 남아 있으면 그것이 사라진다고 먼저 묻는다(화면 규칙 7).
   */
  async function restart() {
    if (!edit?.pending || !valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true;
    try {
      if (edit.retry && (!await adminConfirm(RELOAD_SAVED_CONFIRM) || !scope.canApply(ticket))) return;
      setBusy(true); setError('');
      const result = await readShippingCollectContractAction({ originId, expectedActorId: accountId }); if (!scope.canApply(ticket)) return;
      if (!result.ok) { setError(result.error); return; }
      removePending(); setEdit(fresh(result.value)); setMessage('지금 저장된 내용을 불러왔습니다. 여기서 다시 적어 주세요.');
    } catch { if (scope.canApply(ticket)) setError(`지금 저장된 내용을 불러오지 못했습니다. 잠시 뒤 [${RESTART_LABEL}]를 다시 눌러 주세요.`); }
    finally { lane.current = false; setBusy(false); }
  }
  async function discardInput() {
    if (!edit?.latest || busy || edit.pending) return;
    const latest = edit.latest;
    if (dirty && !await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) return;
    setEdit(fresh(latest)); setError(''); setMessage('다른 사람이 저장한 내용으로 바꿨습니다.');
  }
  const originOff = originActive === false, runtimeOff = runtime === false;
  const locked = !canEdit || busy || Boolean(edit?.pending) || originOff;
  return <section className="mt-4 flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground break-words" aria-labelledby={`collect-contract-${originId}`} data-shipping-collect-contract="">
    <h3 className="flex flex-wrap items-center gap-2 text-base leading-snug font-medium" id={`collect-contract-${originId}`}>착불 조건
      {edit ? <AdminStatusBadge tone={statusTone('setting', edit.base.status === 'active' ? 'active' : 'inactive')}>{shippingCollectStatusLabel(edit.base.status)}</AdminStatusBadge> : null}</h3>
    {!auth.ready ? <p className="text-muted-foreground" role="status">로그인 상태를 확인하고 있습니다.</p> : auth.blocked ? <p className="text-destructive" role="alert">로그인한 계정이 바뀌었거나 로그인이 끝났습니다. 다시 로그인한 뒤 이 화면을 다시 열어 주세요.</p> : <>
      {error && <p className="text-destructive" role="alert">{error}</p>}{message && <p className="text-muted-foreground" role="status">{message}</p>}
      {storageUnavailable && <p className="text-muted-foreground" role="status">이 브라우저에는 저장 중이라는 표시를 남길 수 없습니다. 저장이 끝날 때까지 이 화면을 닫거나 새로고침하지 마세요.</p>}
      {!edit ? <button type="button" className={`${OUTLINE} w-fit`} data-slot="button" disabled={busy} onClick={() => void refresh()}>착불 조건 다시 불러오기</button> : <>
        {edit.pending && <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" role="alert">
          <p className="text-destructive">{pendingNotice(edit)}</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} data-slot="button" disabled={busy} onClick={checkSaved}>{SAVE_CHECK_LABEL}</button>
            <button type="button" className={OUTLINE} data-slot="button" disabled={busy} onClick={() => void restart()}>{RESTART_LABEL}</button></div></div>}
        {edit.latest && !edit.pending && <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3" data-collect-changed="">
          <strong className="font-medium">{CHANGED_BY_OTHER} 지금 저장된 상태는 {shippingCollectStatusLabel(edit.latest.status)}입니다.</strong>
          <div className="overflow-x-auto rounded-lg border bg-background"><table className="w-full text-sm"><thead><tr className="border-b"><th className={TABLE_HEAD}>칸</th><th className={TABLE_HEAD}>내 입력</th><th className={TABLE_HEAD}>지금 저장된 내용</th></tr></thead>
            <tbody>{SHIPPING_COLLECT_FIELDS.map(field => <tr className="border-b last:border-b-0" key={field}><th className={`${TABLE_HEAD} text-muted-foreground`} scope="row">{SHIPPING_COLLECT_LABELS[field]}</th><td className={TABLE_CELL}>{edit.values[field] || '없음'}</td><td className={TABLE_CELL}>{edit.latest!.values[field] || '없음'}</td></tr>)}</tbody></table></div>
          <p className="text-muted-foreground">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={OUTLINE} data-slot="button" disabled={busy || !canEdit || originOff} onClick={() => void save({ base: edit.latest! })}>{TEMPLATE_SAVE_OVER_LATEST_LABEL}</button>
            <button type="button" className={OUTLINE} data-slot="button" disabled={busy} onClick={() => void discardInput()}>{TEMPLATE_DISCARD_INPUT_LABEL}</button></div></div>}
        {originOff && <AdminNotice tone="warning">사용 안 함인 출고지에는 착불 조건을 저장할 수 없습니다. 위에서 출고지의 &lsquo;사용 여부&rsquo;를 사용으로 바꿔 저장한 뒤 다시 열어 주세요.</AdminNotice>}
        <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <label className={FIELD}><span className={FIELD_LABEL}>착불 사용 여부</span><select className="w-full sm:w-72" value={edit.status === 'active' ? 'active' : 'off'}
            onChange={event => setEdit({ ...edit, status: event.target.value === 'active' ? 'active' : edit.base.status === 'active' ? 'disabled' : edit.base.status })}>
            <option value="off">사용 안 함</option><option value="active" disabled={runtimeOff && edit.base.status !== 'active'}>사용</option></select></label>
          {runtimeOff ? <AdminNotice tone="warning">{SHIPPING_COLLECT_RUNTIME_OFF}</AdminNotice> : <GoodReadback>{collectReadback(edit.status, edit.values)}</GoodReadback>}
          <p className="text-muted-foreground">아래 네 칸은 착불 상품의 상품 상세와 주문서, 주문 메일에 그대로 보입니다. 사용으로 저장하려면 모두 적어야 합니다.</p>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">{SHIPPING_COLLECT_FIELDS.map(field => <label className={FIELD} key={field}><span className={FIELD_LABEL}>{SHIPPING_COLLECT_LABELS[field]}</span>
            <input className="w-full" value={edit.values[field]} maxLength={shippingCollectFieldLimit(field)} placeholder={SHIPPING_COLLECT_EXAMPLES[field]} onChange={event => setEdit({ ...edit, values: { ...edit.values, [field]: event.target.value } })} /></label>)}</div>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} data-slot="button" disabled={locked || Boolean(edit.latest)} onClick={() => void save()}>{SAVE_LABEL}</button>
          <button type="button" className={OUTLINE} data-slot="button" disabled={busy || Boolean(edit.pending)} onClick={() => void refresh()}>{SAVED_VIEW_LABEL}</button></div>
      </>}
    </>}
  </section>;
}
