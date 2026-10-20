'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readShippingCollectContractAction, readShippingCollectOperationAction, saveShippingCollectContractAction } from '@/app/admin/shipping-collect-contract-actions';
import { SHIPPING_COLLECT_FIELDS, SHIPPING_COLLECT_LABELS, parseShippingCollectPending, parseShippingCollectRequest, sameShippingCollectDocument, sameShippingCollectValues,
  type ShippingCollectDocument, type ShippingCollectPending, type ShippingCollectRequest, type ShippingCollectStatus, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/client';

type Edit = { base: ShippingCollectDocument; values: ShippingCollectValues; status: ShippingCollectStatus; latest: ShippingCollectDocument | null;
  retry: ShippingCollectRequest | null; pending: ShippingCollectPending | null; lookupMissing: boolean };
const statusLabel = (status: ShippingCollectStatus) => ({ draft: '초안 · 미사용', active: '사용', disabled: '사용 안 함' }[status]);
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
    }).catch(() => { if (scope.canApply(ticket)) setError('착불 운영 조건을 불러오지 못했습니다.'); });
  }, [valid, sessionId, scope, originId, accountId, key, removePending, setEdit]);
  useEffect(() => {
    if (!valid || !protect) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download') || event.defaultPrevented) return;
      const url = new URL(anchor.href, location.href); if (url.pathname === location.pathname && url.search === location.search && url.origin === location.origin) return;
      if (busy || !window.confirm('착불 운영 조건에 저장하지 않은 입력이 있습니다. 화면을 나가면 입력은 사라지고 요청 확인 정보만 남습니다. 나가시겠습니까?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [valid, protect, busy]);
  async function refresh() {
    if (!valid || lane.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    lane.current = true; setBusy(true);
    try {
      const result = await readShippingCollectContractAction({ originId, expectedActorId: accountId }); if (!scope.canApply(ticket)) return;
      if (result.ok) { setEdit(edit ? { ...edit, latest: result.value } : { base: result.value, values: result.value.values, status: result.value.status, latest: null, retry: null, pending: null, lookupMissing: false }); setError(''); }
      else setError(result.error);
    } catch { if (scope.canApply(ticket)) setError('최신 저장본을 불러오지 못했습니다. 입력은 유지됩니다.'); }
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
      if (!receipt) { setEdit({ ...edit, latest, lookupMissing: true }); setMessage('아직 원래 요청의 처리 결과를 확인하지 못했습니다. 미처리로 단정하지 않습니다. 다시 확인하거나 현재 저장값을 기준으로 편집할 수 있습니다.'); return; }
      removePending();
      const current = latest ?? receipt;
      setEdit({ base: current, values: edit.retry ? edit.values : current.values, status: edit.retry ? edit.status : current.status,
        latest: edit.retry || latest && !sameShippingCollectDocument(latest, receipt) ? current : null, retry: null, pending: null, lookupMissing: false });
      setMessage('원래 요청의 저장 기록을 확인했습니다. 최신 저장본을 함께 확인해주세요.');
    } catch { if (scope.canApply(ticket)) setError('이전 요청 결과를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { lane.current = false; setBusy(false); }
  }
  async function save(original?: ShippingCollectRequest) {
    if (!edit || !valid || !sessionId || !canEdit || lane.current || edit.pending && !original) return;
    const request = original ?? parseShippingCollectRequest({ originId, expectedActorId: accountId, expectedRevision: edit.base.revision,
      operationId: crypto.randomUUID(), status: edit.status, values: edit.values });
    if (!request) { setError('각 항목의 앞뒤 공백·줄바꿈·길이를 확인해주세요. 사용하려면 모든 실제 운영 조건과 근거가 필요합니다.'); return; }
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
    } catch { if (scope.canApply(ticket)) setError('저장 결과가 불명확합니다. 같은 요청 결과를 확인해주세요.'); }
    finally { lane.current = false; setBusy(false); }
  }
  function adoptLatest(keepInput: boolean) {
    if (!edit?.latest || busy || edit.pending && !edit.lookupMissing) return;
    removePending(); setEdit({ base: edit.latest, values: keepInput ? edit.values : edit.latest.values, status: keepInput ? edit.status : edit.latest.status, retry: null, pending: null, latest: null, lookupMissing: false });
    setError(''); setMessage('현재 저장본을 기준으로 편집합니다. 이후 저장은 이 버전이 바뀌면 거절됩니다.');
  }
  const locked = !canEdit || busy || Boolean(edit?.pending);
  return <section className="card col wc-admin-kit" aria-labelledby={`collect-contract-${originId}`} style={{ padding: 16, marginTop: 16, gap: 12, minWidth: 0 }}>
    <h3 id={`collect-contract-${originId}`}>착불 수납 운영 조건</h3>
    <p>실제 수납 계약·출고 표기·증빙·환급 절차를 확인해 입력합니다. 상품의 착불 설정과 별도로 저장하며, 초안은 고객 선택에 적용되지 않습니다.</p>
    {!auth.ready ? <p role="status">로그인 상태 확인 중…</p> : auth.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p> : <>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {storageUnavailable && <p role="status">요청 확인 정보를 이 탭에 보관할 수 없습니다. 결과를 확인할 때까지 화면을 유지해주세요.</p>}
      {!edit ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>착불 운영 조건 다시 읽기</button> : <>
        <p>현재 저장 상태: {statusLabel(edit.base.status)} · 버전 {edit.base.revision}</p>
        {edit.pending && <div role="alert"><p>이전 저장 결과를 확인해야 합니다. 연락처와 계약 내용은 브라우저 저장소에 보관하지 않았습니다.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void checkOperation()}>이전 저장 결과 확인</button>
          {edit.retry && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void save(edit.retry!)}>같은 입력으로 결과 확인</button>}</div>}
        {edit.latest && <div className="card col" style={{ padding: 12, gap: 8 }}><strong>최신 저장본: {statusLabel(edit.latest.status)} · 버전 {edit.latest.revision}</strong>
          <details><summary>입력과 최신 저장본 비교</summary><div style={{ overflowX: 'auto' }}><table><thead><tr><th>항목</th><th>내 입력</th><th>최신 저장본</th></tr></thead><tbody>{SHIPPING_COLLECT_FIELDS.map(field => <tr key={field}><th scope="row">{SHIPPING_COLLECT_LABELS[field]}</th><td>{edit.values[field] || '미입력'}</td><td>{edit.latest!.values[field] || '미입력'}</td></tr>)}</tbody></table></div></details>
          <button type="button" className="btn btn-ghost" disabled={busy || Boolean(edit.pending && !edit.lookupMissing)} onClick={() => adoptLatest(false)}>현재 저장값으로 편집 시작</button>
          {!edit.pending && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => adoptLatest(true)}>내 입력 유지 · 최신 버전을 저장 기준으로</button>}</div>}
        <fieldset disabled={locked} className="col" style={{ border: 0, padding: 0, minWidth: 0, gap: 12 }}>
          <label>착불 수납 상태<select value={edit.status} onChange={event => setEdit({ ...edit, status: event.target.value as ShippingCollectStatus })}><option value="draft">초안 · 미사용</option><option value="active">실제 운영 근거 확인 · 사용</option><option value="disabled">사용 안 함</option></select></label>
          <div className="admin-form-grid">{SHIPPING_COLLECT_FIELDS.map(field => <label key={field}>{SHIPPING_COLLECT_LABELS[field]}
            <input value={edit.values[field]} maxLength={field === 'collectorName' ? 100 : field === 'customerInstructions' ? 500 : 200} onChange={event => setEdit({ ...edit, values: { ...edit.values, [field]: event.target.value } })} />
            {['collectorName', 'collectionMethod', 'refundContact', 'customerInstructions'].includes(field) ? <small>고객에게 표시되는 안내</small> : <small>운영 관리자용 근거</small>}</label>)}</div>
        </fieldset>
        <p className="muted">이 화면의 연락처와 계약 입력은 브라우저에 임시저장하지 않습니다. 결과가 불명확하면 저장 요청을 식별하는 정보만 같은 탭·로그인 세션에 남깁니다.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><button type="button" className="btn" disabled={locked} onClick={() => void save()}>착불 운영 조건 저장</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>최신 저장본 비교</button></div>
      </>}
    </>}
  </section>;
}
