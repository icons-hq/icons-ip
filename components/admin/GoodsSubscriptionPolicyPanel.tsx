'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { readGoodsSubscriptionPolicyAction, saveGoodsSubscriptionPolicyAction } from '@/app/admin/goods-subscription-policy-actions';
import { createAdminLocalAutosave, EMPTY_LOCAL_AUTOSAVE_SNAPSHOT } from '@/lib/admin/local-autosave';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { GOODS_SUBSCRIPTION_INTERVALS, GOODS_SUBSCRIPTION_INTERVAL_LABELS, createGoodsSubscriptionRequestLane, goodsSubscriptionDraft,
  parseGoodsSubscriptionRecovery, sameGoodsSubscriptionDraft, type GoodsSubscriptionDraft, type GoodsSubscriptionPolicy,
  type GoodsSubscriptionPolicyRequest, type GoodsSubscriptionRecovery } from '@/lib/admin/goods-subscription-policy';

type Workspace = { base: GoodsSubscriptionPolicy; draft: GoodsSubscriptionDraft; retry: GoodsSubscriptionPolicyRequest | null;
  latest: GoodsSubscriptionPolicy | null; recoveryPending: boolean; readbackRequired: boolean };
function storageAccess() { try { return window.localStorage; } catch { return null; } }
const description = (draft: GoodsSubscriptionDraft) => draft.intervals.map(item => GOODS_SUBSCRIPTION_INTERVAL_LABELS[item]).join(', ');

export function GoodsSubscriptionPolicyFields({ value, onChange }: { value: GoodsSubscriptionDraft; onChange: (next: GoodsSubscriptionDraft) => void }) {
  return <div className="col" style={{ gap: 14 }}>
    <label>정기배송 판매 설정<select value={value.enabled ? 'enabled' : 'disabled'} onChange={event => onChange({ ...value, enabled: event.target.value === 'enabled' })}>
      <option value="disabled">사용 안 함</option><option value="enabled">사용</option>
    </select></label>
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend>고객이 선택할 수 있는 주기</legend>
      <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>{GOODS_SUBSCRIPTION_INTERVALS.map(interval => <label key={interval} className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={value.intervals.includes(interval)} onChange={event => onChange({ ...value,
          intervals: event.target.checked ? [...value.intervals, interval] : value.intervals.filter(item => item !== interval) })} />
        {GOODS_SUBSCRIPTION_INTERVAL_LABELS[interval]}
      </label>)}</div>
    </fieldset>
    <label>정기배송 안내 문구<input value={value.message} maxLength={500} onChange={event => onChange({ ...value, message: event.target.value })}
      placeholder="예: 선택한 주기에 맞춰 정기적으로 배송해 드려요." style={{ width: '100%', minWidth: 0 }} /></label>
    <p className="muted">첫 회차와 다음 회차의 결제 금액·주기를 신청 화면에서 구분해 안내합니다. 이후 가격이나 배송 조건이 바뀌면 고객이 다시 확인한 뒤 결제합니다.</p>
  </div>;
}

export function GoodsSubscriptionPolicyPanel({ goodId, accountId, disabledReason = '', onBusyChange }: {
  goodId: string; accountId: string; disabledReason?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const scope = useMemo(() => ({ ...createGoodsDescriptionToolScope(accountId), goodId, lane: createGoodsSubscriptionRequestLane() }), [accountId, goodId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const storage = useMemo(() => createAdminLocalAutosave({ scope: { accountId, formId: 'goods-subscription-policy', recordId: goodId },
    fields: ['policyDraft'], storage: storageAccess() }), [accountId, goodId]);
  const stored = useSyncExternalStore(storage.subscribe, storage.getSnapshot, () => EMPTY_LOCAL_AUTOSAVE_SNAPSHOT);
  const [session, setSession] = useState<{ owner: typeof scope; id: string } | null>(null);
  const [state, setState] = useState<{ owner: typeof scope; workspace: Workspace | null; busy: boolean; error: string; message: string } | null>(null);
  const ui = state?.owner === scope ? state : null; const workspace = ui?.workspace ?? null;
  const sessionId = session?.owner === scope ? session.id : null;
  const valid = auth.ready && !auth.blocked; const busy = valid && Boolean(ui?.busy);
  const setUi = useMemo(() => (patch: Partial<Omit<NonNullable<typeof state>, 'owner'>>) => setState(previous => ({
    ...(previous?.owner === scope ? previous : { owner: scope, workspace: null, busy: false, error: '', message: '' }), ...patch, owner: scope,
  })), [scope]);
  const dirty = Boolean(workspace && !sameGoodsSubscriptionDraft(workspace.draft, goodsSubscriptionDraft(workspace.base)));
  const recovery = useMemo(() => {
    try { return parseGoodsSubscriptionRecovery(JSON.parse(stored.recovery?.values.policyDraft ?? 'null')); } catch { return null; }
  }, [stored.recovery]);

  function persist(next: Workspace, flush = false) {
    if (!sessionId || next.recoveryPending) return;
    if (!next.retry && !next.readbackRequired && sameGoodsSubscriptionDraft(next.draft, goodsSubscriptionDraft(next.base))) { storage.discard(); return; }
    const payload: GoodsSubscriptionRecovery = { version: 1, sessionId, base: next.base, draft: next.draft, retry: next.retry };
    storage.capture([['policyDraft', JSON.stringify(payload)]]); if (flush) storage.flush();
  }

  useEffect(() => {
    scope.setEnabled(true); scope.activate(); let currentSession: string | null = null;
    const signOut = () => { scope.authenticate(null, null); storage.discard(); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const listener = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, next) => {
      const id = next ? inquiryDraftSessionId(next.access_token) : null;
      if (next?.user.id !== accountId || !id || currentSession !== null && currentSession !== id) storage.discard();
      else { currentSession = id; setSession({ owner: scope, id }); }
      scope.authenticate(next?.user.id ?? null, id);
    }).data.subscription : null;
    return () => { scope.dispose(); listener?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); storage.flush(); };
  }, [scope, storage, accountId]);

  useEffect(() => {
    if (!valid || !sessionId) return;
    const ticket = scope.capture(); if (!ticket) return;
    const sequence = scope.lane.read(); if (sequence === null) return;
    void readGoodsSubscriptionPolicyAction({ goodId, expectedActorId: accountId }).then(result => {
      if (!scope.canApply(ticket) || !scope.lane.current(sequence)) return;
      if (!result.ok) { setUi({ error: result.error }); return; }
      setUi({ workspace: { base: result.value, draft: goodsSubscriptionDraft(result.value), retry: null, latest: null,
        recoveryPending: Boolean(storage.getSnapshot().recovery), readbackRequired: false }, error: '' });
    }).catch(() => { if (scope.canApply(ticket) && scope.lane.current(sequence)) setUi({ error: '정기배송 설정을 불러오지 못했습니다.' }); });
  }, [scope, valid, sessionId, goodId, accountId, storage, setUi]);

  const protectsOtherWrites = busy || valid && Boolean(workspace?.retry);
  useEffect(() => { onBusyChange?.(protectsOtherWrites); return () => onBusyChange?.(false); }, [protectsOtherWrites, onBusyChange]);
  useEffect(() => {
    const flush = () => storage.flush(); const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => { flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
  }, [storage]);
  useEffect(() => {
    if (!valid || !dirty && !busy && !workspace?.retry) return;
    const unload = (event: BeforeUnloadEvent) => { storage.flush(); event.preventDefault(); event.returnValue = ''; };
    const navigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (busy || workspace?.retry || !window.confirm('저장하지 않은 정기배송 입력이 있습니다. 이 화면을 나가시겠습니까? 입력은 이 브라우저에 7일간 보관됩니다.')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, [valid, dirty, busy, workspace?.retry, storage]);

  function edit(draft: GoodsSubscriptionDraft) {
    if (!workspace || !valid || scope.lane.busy() || workspace.retry || workspace.recoveryPending || workspace.readbackRequired) return;
    const next = { ...workspace, draft }; setUi({ workspace: next, message: '', error: '' }); persist(next);
  }
  async function readLatest() {
    if (!valid || scope.lane.busy()) return;
    const ticket = scope.capture(); if (!ticket) return;
    const sequence = scope.lane.begin(); if (sequence === null) return; setUi({ busy: true });
    try {
      const result = await readGoodsSubscriptionPolicyAction({ goodId, expectedActorId: accountId });
      if (!scope.canApply(ticket) || !scope.lane.current(sequence)) return;
      if (!result.ok) { setUi({ error: result.error }); return; }
      setUi({ workspace: workspace ? { ...workspace, latest: result.value, readbackRequired: false }
        : { base: result.value, draft: goodsSubscriptionDraft(result.value), retry: null, latest: null,
          recoveryPending: Boolean(stored.recovery), readbackRequired: false }, error: '' });
    } catch { if (scope.canApply(ticket)) setUi({ error: '최신 저장본을 확인하지 못했습니다. 입력은 유지됩니다.' }); }
    finally { scope.lane.finish(sequence); if (scope.canApply(ticket)) setUi({ busy: false }); }
  }
  async function save(original?: GoodsSubscriptionPolicyRequest) {
    if (!workspace || !valid || scope.lane.busy() || workspace.recoveryPending || workspace.readbackRequired || disabledReason || workspace.retry && !original) return;
    if (!workspace.draft.intervals.length) { setUi({ error: '정기배송 주기를 하나 이상 선택해주세요.' }); return; }
    const request: GoodsSubscriptionPolicyRequest = original ?? { goodId, expectedActorId: accountId,
      expectedRevision: workspace.base.revision, expectedGoodUpdatedAt: workspace.base.goodUpdatedAt, operationId: crypto.randomUUID(),
      ...workspace.draft, message: workspace.draft.message.trim() };
    const ticket = scope.capture(); if (!ticket) return;
    const sequence = scope.lane.begin(); if (sequence === null) return;
    const pending = { ...workspace, retry: request }; setUi({ workspace: pending, busy: true, error: '', message: '' }); persist(pending, true);
    try {
      const result = await saveGoodsSubscriptionPolicyAction(request);
      if (!scope.canApply(ticket) || !scope.lane.current(sequence)) return;
      if (!result.ok) {
        const next = { ...pending, retry: result.uncertain ? request : null, latest: result.latest ?? null,
          readbackRequired: Boolean(result.committed && !result.latest) };
        setUi({ workspace: next, error: result.error, message: result.committed ? '원래 요청의 저장은 확인됐습니다.' : '' }); persist(next, true); return;
      }
      const next = { base: result.value, draft: goodsSubscriptionDraft(result.value), retry: null, latest: null, recoveryPending: false, readbackRequired: false };
      setUi({ workspace: next, message: '정기배송 설정을 저장하고 다시 확인했습니다.' }); persist(next, true);
    } catch { if (scope.canApply(ticket)) setUi({ error: '저장 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.' }); }
    finally { scope.lane.finish(sequence); if (scope.canApply(ticket)) setUi({ busy: false }); }
  }
  const recoveryValid = recovery?.sessionId === sessionId && recovery?.base.goodId === goodId
    && (!recovery.retry || recovery.retry.expectedActorId === accountId);
  function restore() {
    if (!workspace || !valid || scope.lane.busy() || !recovery || !recoveryValid) return;
    const next = { base: recovery.base, draft: recovery.draft, retry: recovery.retry, latest: workspace.base, recoveryPending: false, readbackRequired: false };
    storage.restore(); setUi({ workspace: next, message: '임시 입력을 복원했습니다. 최신 저장본과 비교해주세요.' }); persist(next, true);
  }
  function applyLatest(keep: boolean) {
    if (!workspace?.latest || !valid || scope.lane.busy() || workspace.retry) return;
    const next = { base: workspace.latest, draft: keep ? workspace.draft : goodsSubscriptionDraft(workspace.latest),
      retry: null, latest: null, recoveryPending: false, readbackRequired: false };
    setUi({ workspace: next, error: '', message: keep ? '입력을 유지하고 최신 버전을 저장 기준으로 선택했습니다.' : '최신 저장본을 불러왔습니다.' }); persist(next, true);
  }
  const locked = !valid || !workspace || busy || Boolean(workspace.retry || workspace.recoveryPending || workspace.readbackRequired);
  return <div className="wc-admin-kit col" style={{ gap: 16, minWidth: 0 }} onKeyDown={event => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault();
  }}>
    <p>상품별 정기배송 주기와 안내를 저장합니다. 카드 자동결제 연결과 서비스 공개 준비가 완료된 상품만 고객에게 신청 버튼이 표시됩니다.</p>
    {!auth.ready ? <p role="status">로그인 상태를 확인하는 중입니다…</p> : auth.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 상품 화면을 다시 열어주세요.</p> : <>
      {ui?.error && <p role="alert">{ui.error}</p>}{ui?.message && <p role="status">{ui.message}</p>}
      {stored.unavailable && <p role="status">브라우저 임시저장을 사용할 수 없습니다. 화면을 나가기 전에 저장해주세요.</p>}
      {disabledReason && <p role="status">{disabledReason}</p>}
      {workspace?.recoveryPending && <div className="card col" style={{ padding: 12, gap: 8 }}>
        <p>{recoveryValid ? '같은 로그인 세션에서 저장하지 않은 정기배송 입력이 있습니다.' : '이전 로그인 세션이거나 확인할 수 없는 임시 입력입니다.'}</p>
        {recoveryValid && <button type="button" className="btn" disabled={busy} onClick={restore}>임시 입력 복원</button>}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { storage.discard(); setUi({ workspace: { ...workspace, recoveryPending: false } }); }}>임시 입력 버리기</button>
      </div>}
      {!workspace ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void readLatest()}>설정 다시 불러오기</button> : <>
        {workspace.retry && <div role="alert"><p>이전 저장 결과를 확인해야 합니다. 입력과 요청 번호를 보존했습니다.</p>
          <button type="button" className="btn" disabled={busy || Boolean(disabledReason)} onClick={() => void save(workspace.retry!)}>같은 요청으로 결과 확인</button></div>}
        {workspace.latest && <section className="card col" aria-label="정기배송 최신 저장본 비교" style={{ padding: 12, gap: 10 }}>
          <strong>최신 저장본 · 버전 {workspace.latest.revision}</strong>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>항목</th><th>내 입력</th><th>최신 저장본</th></tr></thead><tbody>
            <tr><th scope="row">판매 설정</th><td>{workspace.draft.enabled ? '사용' : '사용 안 함'}</td><td>{workspace.latest.enabled ? '사용' : '사용 안 함'}</td></tr>
            <tr><th scope="row">주기</th><td>{description(workspace.draft)}</td><td>{description(workspace.latest)}</td></tr>
            <tr><th scope="row">안내 문구</th><td>{workspace.draft.message || '없음'}</td><td>{workspace.latest.message || '없음'}</td></tr>
          </tbody></table></div>
          <button type="button" className="btn" disabled={busy || Boolean(workspace.retry)} onClick={() => applyLatest(true)}>내 입력 유지 · 최신 버전을 저장 기준으로</button>
          <button type="button" className="btn btn-ghost" disabled={busy || Boolean(workspace.retry)} onClick={() => applyLatest(false)}>내 입력 버리고 최신 저장본 불러오기</button>
        </section>}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><GoodsSubscriptionPolicyFields value={workspace.draft} onChange={edit} /></fieldset>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="btn" disabled={locked || Boolean(disabledReason)} onClick={() => void save()}>정기배송 설정 저장</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void readLatest()}>최신 저장본 비교</button>
        </div>
        <small role="status">{busy ? '요청 처리 중…' : workspace.retry ? '결과 확인 필요' : workspace.readbackRequired ? '최신 저장본 확인 필요'
          : dirty ? '미저장 입력 · 이 브라우저에 7일 임시보관' : '서버 저장값과 동일'}</small>
      </>}
    </>}
  </div>;
}
