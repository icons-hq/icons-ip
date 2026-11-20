'use client';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readShippingCollectContractAction, readShippingCollectOperationAction, saveShippingCollectContractAction } from '@/app/admin/shipping-collect-contract-actions';
import { SHIPPING_COLLECT_FIELDS, SHIPPING_COLLECT_LABELS, parseShippingCollectPending, parseShippingCollectRequest, sameShippingCollectDocument, sameShippingCollectValues,
  type ShippingCollectDocument, type ShippingCollectPending, type ShippingCollectRequest, type ShippingCollectStatus, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/client';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const HINT = 'text-xs text-muted-foreground';
const TABLE_HEAD = 'h-9 px-2 text-left align-middle font-medium whitespace-nowrap';
const TABLE_CELL = 'px-2 py-1.5 align-middle';

type Edit = { base: ShippingCollectDocument; values: ShippingCollectValues; status: ShippingCollectStatus; latest: ShippingCollectDocument | null;
  retry: ShippingCollectRequest | null; pending: ShippingCollectPending | null; lookupMissing: boolean };
const statusLabel = (status: ShippingCollectStatus) => ({ draft: '준비 중 · 사용 안 함', active: '사용', disabled: '사용 안 함' }[status]);
export function ShippingCollectContractPanel({ originId, accountId, canEdit }: { originId: string; accountId: string; canEdit: boolean }) {
  const scope = useMemo(() => ({ ...createGoodsDescriptionToolScope(accountId), originId }), [accountId, originId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [sessionId, setSessionId] = useState<string | null>(null), [stored, setStored] = useState<{ scope: typeof scope; edit: Edit } | null>(null);
  const edit = stored?.scope === scope ? stored.edit : null;
  const setEdit = useMemo(() => (next: Edit) => setStored({ scope, edit: next }), [scope]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [storageUnavailable, setStorageUnavailable] = useState(false);
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
      setEdit({ base: result.value, values: result.value.values, status: result.value.status, latest: null, retry: null, pending, lookupMissing: false });
    }).catch(() => { if (scope.canApply(ticket)) setError('착불 운영 조건을 불러오지 못했습니다. 잠시 뒤 [착불 운영 조건 다시 읽기]를 눌러주세요.'); });
  }, [valid, sessionId, scope, originId, accountId, key, removePending, setEdit]);
  useAdminLeaveGuard({ dirty: valid && protect, blocked: valid && busy, message: '착불 운영 조건에 저장하지 않은 입력이 있습니다. 나가면 입력한 내용은 사라지고 저장 결과 확인용 요청 번호만 남습니다. 나가시겠습니까?' });
  async function refresh() {
    if (!valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true; setBusy(true);
    try {
      const result = await readShippingCollectContractAction({ originId, expectedActorId: accountId }); if (!scope.canApply(ticket)) return;
      if (result.ok) { setEdit(edit ? { ...edit, latest: result.value } : { base: result.value, values: result.value.values, status: result.value.status, latest: null, retry: null, pending: null, lookupMissing: false }); setError(''); }
      else setError(result.error);
    } catch { if (scope.canApply(ticket)) setError('최근에 저장된 내용을 불러오지 못했습니다. 입력은 그대로 있습니다. 잠시 뒤 [최신 저장본 비교]를 다시 눌러주세요.'); }
    finally { lane.current = false; setBusy(false); }
  }
  async function checkOperation() {
    if (!edit?.pending || !valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true; setBusy(true); setError('');
    try {
      const result = await readShippingCollectOperationAction({ originId, expectedActorId: accountId, operationId: edit.pending.operationId }); if (!scope.canApply(ticket)) return;
      if (!result.ok) { setError(result.error); return; }
      const { receipt, latest } = result.value;
      if (!receipt) { setEdit({ ...edit, latest, lookupMissing: true }); setMessage('이전 저장 요청이 처리됐는지 아직 확인되지 않았습니다. 저장되지 않았다고 볼 수 없으니 [이전 저장 결과 확인]을 다시 누르거나, [현재 저장값으로 편집 시작]을 눌러 지금 저장된 내용에서 다시 입력해주세요.'); return; }
      removePending();
      const current = latest ?? receipt;
      setEdit({ base: current, values: edit.retry ? edit.values : current.values, status: edit.retry ? edit.status : current.status,
        latest: edit.retry || latest && !sameShippingCollectDocument(latest, receipt) ? current : null, retry: null, pending: null, lookupMissing: false });
      setMessage('원래 요청의 저장 기록을 확인했습니다. 최신 저장본을 함께 확인해주세요.');
    } catch { if (scope.canApply(ticket)) setError('이전 저장 결과를 불러오지 못했습니다. 잠시 뒤 [이전 저장 결과 확인]을 다시 눌러주세요.'); }
    finally { lane.current = false; setBusy(false); }
  }
  async function save(original?: ShippingCollectRequest) {
    if (!edit || !valid || !sessionId || !canEdit || lane.current || edit.pending && !original) return;
    const request = original ?? parseShippingCollectRequest({ originId, expectedActorId: accountId, expectedRevision: edit.base.revision,
      operationId: crypto.randomUUID(), status: edit.status, values: edit.values });
    if (!request) { setError('칸 앞뒤의 공백과 줄바꿈을 지워주세요. 수납 주체는 100자, 고객 안내 문구는 500자, 나머지 칸은 200자까지 입력합니다. "실제 운영 근거 확인 · 사용"으로 저장하려면 모든 칸을 채워야 합니다.'); return; }
    const ticket = scope.capture(); if (!ticket) return;
    const pending: ShippingCollectPending = { version: 1, sessionId, originId, operationId: request.operationId };
    savePending(pending); setEdit({ ...edit, retry: request, pending, lookupMissing: false }); lane.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveShippingCollectContractAction(request); if (!scope.canApply(ticket)) return;
      if (!result.ok) {
        if (!result.uncertain) removePending();
        setEdit({ ...edit, retry: result.uncertain ? request : null, pending: result.uncertain ? pending : null, latest: result.latest ?? null, lookupMissing: false });
        setError(result.error); if (result.committed) setMessage('저장은 처리됐습니다. 최신 저장본을 확인해주세요.'); return;
      }
      removePending(); setEdit({ base: result.value, values: result.value.values, status: result.value.status, retry: null, pending: null, latest: null, lookupMissing: false });
      setMessage('착불 운영 조건을 저장하고 다시 확인했습니다. 실제 운송사 계약이나 수납을 대신 실행한 것은 아닙니다.');
    } catch { if (scope.canApply(ticket)) setError('저장됐는지 확인하지 못했습니다. [이전 저장 결과 확인]을 눌러 결과를 먼저 확인해주세요.'); }
    finally { lane.current = false; setBusy(false); }
  }
  function adoptLatest(keepInput: boolean) {
    if (!edit?.latest || busy || edit.pending && !edit.lookupMissing) return;
    removePending(); setEdit({ base: edit.latest, values: keepInput ? edit.values : edit.latest.values, status: keepInput ? edit.status : edit.latest.status, retry: null, pending: null, latest: null, lookupMissing: false });
    setError(''); setMessage('지금 저장된 내용을 기준으로 편집합니다. 저장하기 전에 다른 사람이 이 조건을 바꾸면 저장되지 않습니다.');
  }
  const locked = !canEdit || busy || Boolean(edit?.pending);
  return <section className="mt-4 flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground break-words" aria-labelledby={`collect-contract-${originId}`} data-shipping-collect-contract="">
    <h3 className="text-base leading-snug font-medium" id={`collect-contract-${originId}`}>착불 수납 운영 조건</h3>
    <p className="text-muted-foreground">실제 수납 계약·출고 표기·증빙·환급 절차를 확인해 입력합니다. 상품의 착불 설정과 따로 저장합니다. 상태가 &lsquo;준비 중&rsquo;이면 고객이 착불을 고를 때 적용되지 않고, &lsquo;실제 운영 근거 확인 · 사용&rsquo;으로 저장해야 적용됩니다.</p>
    {!auth.ready ? <p className="text-muted-foreground" role="status">로그인 상태 확인 중…</p> : auth.blocked ? <p className="text-destructive" role="alert">로그인 계정이 바뀌었거나 로그인이 끝났습니다. 다시 로그인한 뒤 이 화면을 다시 열어주세요.</p> : <>
      {error && <p className="text-destructive" role="alert">{error}</p>}{message && <p className="text-muted-foreground" role="status">{message}</p>}
      {storageUnavailable && <p className="text-muted-foreground" role="status">이 탭에 저장 결과 확인용 요청 번호를 남길 수 없습니다. 저장 결과를 확인할 때까지 이 화면을 닫거나 새로고침하지 마세요.</p>}
      {!edit ? <button type="button" className={`${OUTLINE} w-fit`} data-slot="button" disabled={busy} onClick={() => void refresh()}>착불 운영 조건 다시 읽기</button> : <>
        <p className="flex flex-wrap items-center gap-2">현재 저장 상태 <AdminStatusBadge tone={edit.base.status === 'active' ? 'success' : 'neutral'}>{statusLabel(edit.base.status)}</AdminStatusBadge> 버전 {edit.base.revision}</p>
        {edit.pending && <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3" role="alert"><p className="text-destructive">이전 저장이 처리됐는지 먼저 확인해야 합니다. 입력했던 연락처와 계약 내용은 브라우저에 남기지 않았으니, 저장되지 않았으면 다시 입력해주세요.</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} data-slot="button" disabled={busy} onClick={() => void checkOperation()}>이전 저장 결과 확인</button>
          {edit.retry && <button type="button" className={OUTLINE} data-slot="button" disabled={busy} onClick={() => void save(edit.retry!)}>같은 입력으로 결과 확인</button>}</div></div>}
        {edit.latest && <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3"><strong className="font-medium">최신 저장본: {statusLabel(edit.latest.status)} · 버전 {edit.latest.revision}</strong>
          <details><summary className="cursor-pointer font-medium">입력과 최신 저장본 비교</summary><div className="mt-2 overflow-x-auto rounded-lg border bg-background"><table className="w-full text-sm"><thead><tr className="border-b"><th className={TABLE_HEAD}>항목</th><th className={TABLE_HEAD}>내 입력</th><th className={TABLE_HEAD}>최신 저장본</th></tr></thead><tbody>{SHIPPING_COLLECT_FIELDS.map(field => <tr className="border-b last:border-b-0" key={field}><th className={`${TABLE_HEAD} text-muted-foreground`} scope="row">{SHIPPING_COLLECT_LABELS[field]}</th><td className={TABLE_CELL}>{edit.values[field] || '미입력'}</td><td className={TABLE_CELL}>{edit.latest!.values[field] || '미입력'}</td></tr>)}</tbody></table></div></details>
          <div className="flex flex-wrap gap-2"><button type="button" className={OUTLINE} data-slot="button" disabled={busy || Boolean(edit.pending && !edit.lookupMissing)} onClick={() => adoptLatest(false)}>현재 저장값으로 편집 시작</button>
          {!edit.pending && <button type="button" className={OUTLINE} data-slot="button" disabled={busy} onClick={() => adoptLatest(true)}>내 입력 유지 · 최신 버전을 저장 기준으로</button>}</div></div>}
        <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <label className={FIELD}><span className={FIELD_LABEL}>착불 수납 상태</span><select className="w-full sm:w-72" value={edit.status} onChange={event => setEdit({ ...edit, status: event.target.value as ShippingCollectStatus })}><option value="draft">준비 중 · 사용 안 함</option><option value="active">실제 운영 근거 확인 · 사용</option><option value="disabled">사용 안 함</option></select></label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">{SHIPPING_COLLECT_FIELDS.map(field => <label className={FIELD} key={field}><span className={FIELD_LABEL}>{SHIPPING_COLLECT_LABELS[field]}</span>
            <input className="w-full" value={edit.values[field]} maxLength={field === 'collectorName' ? 100 : field === 'customerInstructions' ? 500 : 200} onChange={event => setEdit({ ...edit, values: { ...edit.values, [field]: event.target.value } })} />
            {['collectorName', 'collectionMethod', 'refundContact', 'customerInstructions'].includes(field) ? <small className={HINT}>고객에게 표시되는 안내</small> : <small className={HINT}>운영 관리자용 근거</small>}</label>)}</div>
        </fieldset>
        <p className="text-muted-foreground">이 화면의 연락처와 계약 내용은 브라우저에 임시저장하지 않습니다. 저장 결과를 모를 때만 결과 확인용 요청 번호를 이 탭에 남기고, 같은 로그인에서만 씁니다.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} data-slot="button" disabled={locked} onClick={() => void save()}>착불 운영 조건 저장</button>
          <button type="button" className={OUTLINE} data-slot="button" disabled={busy} onClick={() => void refresh()}>최신 저장본 비교</button></div>
      </>}
    </>}
  </section>;
}
