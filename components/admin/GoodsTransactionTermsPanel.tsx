'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readGoodsTransactionTermsAction, saveGoodsTransactionTermsAction } from '@/app/admin/goods-transaction-terms-actions';
import { createAdminLocalAutosave, EMPTY_LOCAL_AUTOSAVE_SNAPSHOT } from '@/lib/admin/local-autosave';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { goodsTermsDraft, parseGoodsTermsRecovery, prepareGoodsTermsInput, sameGoodsTerms,
  type DeliveryTermsInput, type GoodsTermsDraft, type GoodsTermsRecovery, type GoodsTermsRequest, type VolumeTermsInput } from '@/lib/admin/goods-transaction-terms';
import type { GoodsTransactionAdminTerms } from '@/lib/goods-transaction';

type Workspace = { base: GoodsTransactionAdminTerms; draft: GoodsTermsDraft; retry: GoodsTermsRequest | null; latest: GoodsTransactionAdminTerms | null; recoveryPending: boolean };
function browserStorage() { try { return window.localStorage; } catch { return null; } }
const inputStyle = { minWidth: 0, width: '100%' } as const;
const stateLabel = (value: string | undefined) => ({ draft: '초안 · 미적용', active: '사용 중', disabled: '사용 안 함' }[value ?? ''] ?? '미설정');
function comparisonValues(draft: GoodsTermsDraft): Array<[string, string]> {
  const v = draft.volume.fields, d = draft.delivery.fields;
  const shown = (value: string, unit = '') => value ? `${value}${unit}` : '미입력';
  return [
    ['복수구매 할인 상태', stateLabel(draft.volume.status)], ['할인 조건', v.condition === 'quantity' ? '같은 상품 구매 수량' : '같은 상품 정상가 합계'],
    ['최소 구매 조건', shown(v.threshold, v.condition === 'quantity' ? '개' : '원')], ['개당 할인', shown(v.discountValue, v.discountKind === 'percent' ? '%' : '원')],
    ['할인 시작 · 한국 시간', v.startsAt || '기간 제한 없음'], ['할인 종료 · 한국 시간', v.endsAt || '기간 제한 없음'],
    ['확장 배송비 상태', stateLabel(draft.delivery.status)], ['배송비 결제', ({ prepaid: '선결제', collect: '착불', buyer_choice: '구매자 선택' } as Record<string, string>)[d.paymentMode] ?? '선택 필요'],
    ['수량별 배송비', ({ existing: '기본 상품 설정', repeat: '수량마다 반복', tier2: '2구간', tier3: '3구간' } as Record<string, string>)[d.kind] ?? '선택 필요'],
    ...(d.kind === 'existing' ? [] : [['기본 배송비', shown(d.baseFee, '원')] as [string, string]]),
    ...(d.kind === 'repeat' ? [['부과 단위', shown(d.interval, '개마다')] as [string, string]] : []),
    ...(['tier2', 'tier3'].includes(d.kind) ? [['첫 수량 한도', shown(d.firstLimit, '개 이하')], ['첫 한도 초과 추가금', shown(d.extra1, '원')]] as Array<[string, string]> : []),
    ...(d.kind === 'tier3' ? [['두 번째 수량 한도', shown(d.secondLimit, '개 이하')], ['두 번째 한도 초과 추가금', shown(d.extra2, '원')]] as Array<[string, string]> : []),
  ];
}
function PolicyComparison({ draft, latest }: { draft: GoodsTermsDraft; latest: GoodsTermsDraft }) {
  const own = new Map(comparisonValues(draft)), saved = new Map(comparisonValues(latest));
  return <div style={{ overflowX: 'auto' }}><table><caption>현재 입력과 최신 저장값</caption><thead><tr><th>항목</th><th>내 입력</th><th>최신 저장본</th></tr></thead><tbody>
    {[...new Set([...own.keys(), ...saved.keys()])].map(key => <tr key={key}><th scope="row">{key}</th><td>{own.get(key) ?? '해당 없음'}</td><td>{saved.get(key) ?? '해당 없음'}</td></tr>)}
  </tbody></table></div>;
}

function PolicyStatus({ label, value, onChange }: { label: string; value: string; onChange: (value: 'draft' | 'active' | 'disabled') => void }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value as 'draft' | 'active' | 'disabled')}>
    <option value="draft">초안 · 가격·배송비에 미적용</option><option value="active">사용</option><option value="disabled">사용 안 함</option>
  </select></label>;
}
function NumberField({ label, value, onChange, min = 0, max = 2147483647 }: { label: string; value: string; onChange: (value: string) => void; min?: number; max?: number }) {
  return <label>{label}<input type="number" step="1" min={min} max={max} value={value} onChange={event => onChange(event.target.value)} style={inputStyle} /></label>;
}
export function GoodsVolumeDiscountFields({ value, onChange }: { value: GoodsTermsDraft['volume']; onChange: (value: GoodsTermsDraft['volume']) => void }) {
  const fields = value.fields, patch = (key: keyof typeof fields, next: string) => onChange({ ...value, fields: { ...fields, [key]: next } });
  return <div className="col" style={{ gap: 12 }}>
    <PolicyStatus label="복수구매 할인 상태" value={value.status} onChange={status => onChange({ ...value, status })} />
    <div className="admin-form-grid">
      <label>할인 조건<select value={fields.condition} onChange={event => patch('condition', event.target.value)}><option value="quantity">같은 상품 구매 수량</option><option value="regular_subtotal">같은 상품 정상가 합계</option></select></label>
      <NumberField label={fields.condition === 'quantity' ? '최소 구매 수량 (개)' : '최소 정상가 합계 (원)'} value={fields.threshold} min={fields.condition === 'quantity' ? 2 : 1} max={fields.condition === 'quantity' ? 2147483647 : 999999999999} onChange={next => patch('threshold', next)} />
      <label>할인 방식<select value={fields.discountKind} onChange={event => patch('discountKind', event.target.value)}><option value="fixed">개당 정액 할인</option><option value="percent">개당 비율 할인</option></select></label>
      <NumberField label={fields.discountKind === 'percent' ? '개당 할인율 (%)' : '개당 할인액 (원)'} value={fields.discountValue} min={1} max={fields.discountKind === 'percent' ? 100 : 2147483647} onChange={next => patch('discountValue', next)} />
      <label>할인 시작 (한국 시간)<input type="datetime-local" step="any" value={fields.startsAt} onChange={event => patch('startsAt', event.target.value)} style={inputStyle} /></label>
      <label>할인 종료 (한국 시간)<input type="datetime-local" step="any" value={fields.endsAt} onChange={event => patch('endsAt', event.target.value)} style={inputStyle} /></label>
    </div>
    <p className="muted">같은 상품의 옵션별 수량을 합산합니다. 조건을 충족하면 기간 할인이 반영된 단가에서 개당 할인하고, 그다음 쿠폰·적립금을 적용합니다. 비율 할인은 개당 1원 미만을 버립니다. 기간을 모두 비우면 상시 적용합니다.</p>
  </div>;
}
export function GoodsDeliveryPricingFields({ value, onChange }: { value: GoodsTermsDraft['delivery']; onChange: (value: GoodsTermsDraft['delivery']) => void }) {
  const fields = value.fields, patch = (key: keyof typeof fields, next: string) => onChange({ ...value, fields: { ...fields, [key]: next } });
  return <div className="col" style={{ gap: 12 }}>
    <PolicyStatus label="확장 배송비 상태" value={value.status} onChange={status => onChange({ ...value, status })} />
    <div className="admin-form-grid">
      <label>배송비 결제<select value={fields.paymentMode} onChange={event => patch('paymentMode', event.target.value)}><option value="prepaid">선결제</option><option value="collect">착불</option><option value="buyer_choice">구매자 선택 · 선결제 또는 착불</option></select></label>
      <label>수량별 배송비<select value={fields.kind} onChange={event => patch('kind', event.target.value)}><option value="existing">기본 상품의 배송비 설정 사용</option><option value="repeat">수량마다 배송비 반복</option><option value="tier2">2구간 배송비</option><option value="tier3">3구간 배송비</option></select></label>
      {fields.kind !== 'existing' && <NumberField label="기본 배송비 (원)" value={fields.baseFee} max={1000000} onChange={next => patch('baseFee', next)} />}
      {fields.kind === 'repeat' && <NumberField label="배송비 부과 단위 (개마다)" value={fields.interval} min={1} onChange={next => patch('interval', next)} />}
      {['tier2', 'tier3'].includes(fields.kind) && <><NumberField label="기본 배송비 적용 한도 (개 이하)" value={fields.firstLimit} min={1} onChange={next => patch('firstLimit', next)} />
        <NumberField label="첫 번째 한도 초과 추가금 (원)" value={fields.extra1} max={1000000} onChange={next => patch('extra1', next)} /></>}
      {fields.kind === 'tier3' && <><NumberField label="두 번째 수량 한도 (개 이하)" value={fields.secondLimit} min={2} onChange={next => patch('secondLimit', next)} />
        <NumberField label="두 번째 한도 초과 추가금 (원)" value={fields.extra2} max={1000000} onChange={next => patch('extra2', next)} /></>}
    </div>
    <p className="muted">수량은 같은 상품의 모든 옵션을 합산합니다. 반복 방식은 부과 단위마다 기본 배송비를 더하고, 구간 방식은 기본 배송비에 해당 구간의 추가금 하나를 더합니다. 지역 추가 배송비는 별도로 계산합니다.</p>
    {fields.paymentMode !== 'prepaid' && <p>착불은 출고지의 수납 주체·방법·증빙·분쟁 연락처가 준비되어야 사용할 수 있습니다. 고객이 배송 시 별도로 낼 금액을 주문서에 표시하며 온라인 환급에 합산하지 않습니다.</p>}
  </div>;
}

export function GoodsTransactionTermsPanel({ goodId, accountId, disabledReason = '', onBusyChange }: {
  goodId: string; accountId: string; disabledReason?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const scope = useMemo(() => ({ ...createGoodsDescriptionToolScope(accountId), goodId }), [accountId, goodId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const storage = useMemo(() => createAdminLocalAutosave({ scope: { accountId, formId: 'goods-transaction-terms', recordId: goodId }, fields: ['policyDraft'], storage: browserStorage() }), [accountId, goodId]);
  const stored = useSyncExternalStore(storage.subscribe, storage.getSnapshot, () => EMPTY_LOCAL_AUTOSAVE_SNAPSHOT);
  const [sessionId, setSessionId] = useState<string | null>(null), [storedWorkspace, setStoredWorkspace] = useState<{ owner: typeof scope; value: Workspace } | null>(null);
  const workspace = storedWorkspace?.owner === scope ? storedWorkspace.value : null;
  const setWorkspace = useMemo(() => (value: Workspace) => setStoredWorkspace({ owner: scope, value }), [scope]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const requestBusy = useRef(false), generation = useRef(0), root = useRef<HTMLDivElement>(null);
  const valid = auth.ready && !auth.blocked, ready = valid && workspace !== null;
  const dirty = Boolean(workspace && !sameGoodsTerms(workspace.draft, goodsTermsDraft(workspace.base)));
  const protectedInput = dirty || Boolean(workspace?.retry);
  const recovery = useMemo(() => {
    try { return parseGoodsTermsRecovery(JSON.parse(stored.recovery?.values.policyDraft ?? 'null')); } catch { return null; }
  }, [stored.recovery]);
  function persist(value: Workspace, immediately = false) {
    if (!sessionId || value.recoveryPending) return;
    if (!value.retry && sameGoodsTerms(value.draft, goodsTermsDraft(value.base))) { storage.discard(); return; }
    const recoveryValue: GoodsTermsRecovery = { version: 1, sessionId, base: value.base, draft: value.draft, retry: value.retry };
    storage.capture([['policyDraft', JSON.stringify(recoveryValue)]]); if (immediately) storage.flush();
  }
  useEffect(() => {
    scope.setEnabled(true); scope.activate(); let currentSession: string | null = null;
    const signOut = () => { scope.authenticate(null, null); storage.discard(); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    const subscription = getSupabaseConfig().isConfigured ? createClient().auth.onAuthStateChange((_event, session) => {
      const id = session ? inquiryDraftSessionId(session.access_token) : null;
      if (session?.user.id !== accountId || !id || currentSession !== null && currentSession !== id) storage.discard();
      else { currentSession = id; setSessionId(id); }
      scope.authenticate(session?.user.id ?? null, id);
    }).data.subscription : null;
    return () => { scope.dispose(); subscription?.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); storage.flush(); };
  }, [scope, storage, accountId]);
  useEffect(() => {
    if (!valid || !sessionId) return;
    const ticket = scope.capture(); if (!ticket) return;
    const sequence = ++generation.current;
    void readGoodsTransactionTermsAction({ goodId, expectedActorId: accountId }).then(result => {
      if (!scope.canApply(ticket) || sequence !== generation.current) return;
      if (!result.ok) { setError(result.error); return; }
      setWorkspace({ base: result.value, draft: goodsTermsDraft(result.value), retry: null, latest: null, recoveryPending: Boolean(storage.getSnapshot().recovery) });
    }).catch(() => { if (scope.canApply(ticket) && sequence === generation.current) setError('할인·배송 설정을 불러오지 못했습니다.'); });
  }, [scope, valid, sessionId, goodId, accountId, storage, setWorkspace]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const flush = () => storage.flush(), hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => { flush(); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
  }, [storage]);
  useEffect(() => {
    if (!valid || !protectedInput && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { storage.flush(); event.preventDefault(); event.returnValue = ''; };
    const navigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      if (busy || workspace?.retry || !window.confirm('저장하지 않은 할인·배송 입력이 있습니다. 이 화면을 나가시겠습니까? 입력은 이 브라우저에 7일간 보관됩니다.')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, [valid, protectedInput, busy, workspace?.retry, storage]);
  function edit(kind: 'volume' | 'delivery', value: GoodsTermsDraft['volume'] | GoodsTermsDraft['delivery']) {
    if (!workspace || !valid || busy || requestBusy.current || workspace.retry || workspace.recoveryPending) return;
    const next = { ...workspace, draft: { ...workspace.draft, [kind]: value } };
    setWorkspace(next); setMessage(''); persist(next);
  }
  async function readLatest() {
    if (!valid || busy || requestBusy.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    requestBusy.current = true; setBusy(true); const sequence = ++generation.current;
    try {
      const result = await readGoodsTransactionTermsAction({ goodId, expectedActorId: accountId });
      if (!scope.canApply(ticket) || sequence !== generation.current) return;
      if (!result.ok) { setError(result.error); return; }
      if (!workspace) setWorkspace({ base: result.value, draft: goodsTermsDraft(result.value), retry: null, latest: null, recoveryPending: Boolean(stored.recovery) });
      else setWorkspace({ ...workspace, latest: result.value });
      setError('');
    } catch { if (scope.canApply(ticket)) setError('최신 저장본을 확인하지 못했습니다. 입력은 유지됩니다.'); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  async function save(kind: 'volume' | 'delivery', original?: GoodsTermsRequest) {
    if (!workspace || !valid || busy || requestBusy.current || workspace.recoveryPending || disabledReason || workspace.retry && !original) return;
    const prepared = original ? null : prepareGoodsTermsInput(kind, workspace.draft);
    if (prepared && !prepared.ok) { setError(prepared.error); return; }
    const request: GoodsTermsRequest = original ?? { goodId, expectedActorId: accountId, expectedRevision: workspace.base.revision,
      expectedGoodUpdatedAt: workspace.base.goodUpdatedAt, operationId: crypto.randomUUID(),
      volume: kind === 'volume' && prepared?.ok ? prepared.value as VolumeTermsInput : null,
      delivery: kind === 'delivery' && prepared?.ok ? prepared.value as DeliveryTermsInput : null };
    const ticket = scope.capture(); if (!ticket) return;
    requestBusy.current = true; setBusy(true); setError(''); setMessage(''); const sequence = ++generation.current;
    const pending = { ...workspace, retry: request }; setWorkspace(pending); persist(pending, true);
    try {
      const result = await saveGoodsTransactionTermsAction(request);
      if (!scope.canApply(ticket) || sequence !== generation.current) return;
      if (!result.ok) {
        const next = { ...pending, retry: result.uncertain ? request : null, latest: result.latest ?? null };
        setWorkspace(next); persist(next, true); setError(result.error);
        if (result.committed) setMessage('원래 요청의 저장은 확인됐습니다. 최신 저장본을 비교한 뒤 이어서 편집해주세요.');
        return;
      }
      const serverDraft = goodsTermsDraft(result.value), draft = { ...workspace.draft, [kind]: serverDraft[kind] };
      const next = { base: result.value, draft, retry: null, latest: null, recoveryPending: false };
      setWorkspace(next); persist(next, true); setMessage(`${kind === 'volume' ? '복수구매 할인' : '확장 배송비'} 설정을 저장하고 다시 확인했습니다.`);
    } catch { if (scope.canApply(ticket) && sequence === generation.current) setError('저장 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.'); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  function restore() {
    if (!workspace || busy || !recovery || recovery.sessionId !== sessionId || recovery.base.goodId !== goodId
      || recovery.retry && recovery.retry.expectedActorId !== accountId) return;
    const next = { base: recovery.base, draft: recovery.draft, retry: recovery.retry, latest: workspace.base, recoveryPending: false };
    storage.restore(); setWorkspace(next); persist(next, true); setMessage('임시 입력을 복원했습니다. 최신 저장본과 비교해주세요.');
  }
  function applyLatest(keepDraft: boolean) {
    if (!workspace?.latest || busy || workspace.retry) return;
    const next = { base: workspace.latest, draft: keepDraft ? workspace.draft : goodsTermsDraft(workspace.latest), latest: null, retry: null, recoveryPending: false };
    setWorkspace(next); persist(next, true); setError(''); setMessage(keepDraft ? '입력을 유지하고 최신 저장본을 기준으로 바꿨습니다. 내용을 확인한 뒤 저장해주세요.' : '최신 저장본을 불러왔습니다.');
  }
  const locked = !ready || busy || Boolean(workspace?.retry) || Boolean(workspace?.recoveryPending);
  const recoveryValid = recovery?.sessionId === sessionId && recovery?.base.goodId === goodId && (!recovery.retry || recovery.retry.expectedActorId === accountId);
  return <div className="wc-admin-kit col" ref={root} style={{ gap: 18, minWidth: 0 }}>
    <p>할인과 확장 배송비는 각각 저장합니다. 초안은 결제에 적용되지 않으며, 기본 상품의 가격·배송 정보를 먼저 저장해야 합니다.</p>
    {!auth.ready ? <p role="status">로그인 상태를 확인하는 중입니다…</p> : auth.blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 상품 화면을 다시 열어주세요.</p> : <>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {stored.unavailable && <p role="status">브라우저 임시저장을 사용할 수 없습니다. 화면을 나가기 전에 설정을 저장해주세요.</p>}
      {workspace?.recoveryPending && <div className="card col" style={{ padding: 12, gap: 8 }}><p>{recoveryValid ? '같은 로그인 세션에서 저장하지 않은 할인·배송 입력이 있습니다.' : '이전 로그인 세션이거나 형식을 확인할 수 없는 임시 입력입니다.'}</p>
        {recoveryValid && <button type="button" className="btn" onClick={restore} disabled={busy}>임시 입력 복원</button>}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { storage.discard(); setWorkspace({ ...workspace, recoveryPending: false }); }}>임시 입력 버리기</button></div>}
      {disabledReason && <p role="status">{disabledReason}</p>}
      {!workspace ? <button className="btn btn-ghost" type="button" onClick={() => void readLatest()} disabled={busy}>설정 다시 불러오기</button> : <>
        {workspace.retry && <div role="alert"><p>이전 저장의 결과가 아직 확인되지 않았습니다. 입력과 요청 번호를 보존했습니다.</p><button type="button" className="btn" disabled={busy || Boolean(disabledReason)} onClick={() => void save(workspace.retry!.volume ? 'volume' : 'delivery', workspace.retry!)}>같은 요청으로 결과 확인</button></div>}
        {workspace.latest && <section className="card col" aria-label="할인·배송 최신 저장본 비교" style={{ padding: 14, gap: 10 }}>
          <strong>최신 저장본 · 버전 {workspace.latest.revision}</strong>
          <p>복수구매 할인: {stateLabel(workspace.latest.volume?.status)} · 확장 배송비: {stateLabel(workspace.latest.delivery?.status)}</p>
          <details><summary>현재 입력과 최신 저장값 비교</summary><PolicyComparison draft={workspace.draft} latest={goodsTermsDraft(workspace.latest)} /></details>
          <button type="button" className="btn" onClick={() => applyLatest(true)} disabled={busy || Boolean(workspace.retry)}>내 입력 유지 · 최신 버전을 저장 기준으로</button>
          <button type="button" className="btn btn-ghost" onClick={() => applyLatest(false)} disabled={busy || Boolean(workspace.retry)}>내 입력 버리고 최신 저장본 불러오기</button>
        </section>}
        <section aria-label="복수구매 할인" className="card col" style={{ padding: 16, gap: 12, minWidth: 0 }}><h3>복수구매 할인 <small>저장 상태: {stateLabel(workspace.base.volume?.status)}</small></h3>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><GoodsVolumeDiscountFields value={workspace.draft.volume} onChange={value => edit('volume', value)} /></fieldset>
          <button type="button" className="btn" disabled={locked || Boolean(disabledReason)} onClick={() => void save('volume')}>복수구매 할인 저장</button></section>
        <section aria-label="착불·수량별 배송비" className="card col" style={{ padding: 16, gap: 12, minWidth: 0 }}><h3>착불·수량별 배송비 <small>저장 상태: {stateLabel(workspace.base.delivery?.status)}</small></h3>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><GoodsDeliveryPricingFields value={workspace.draft.delivery} onChange={value => edit('delivery', value)} /></fieldset>
          <button type="button" className="btn" disabled={locked || Boolean(disabledReason)} onClick={() => void save('delivery')}>확장 배송비 저장</button></section>
        <button className="btn btn-ghost" type="button" onClick={() => void readLatest()} disabled={busy}>최신 저장본 비교</button>
        <small role="status">{busy ? '요청 처리 중…' : workspace.retry ? '결과 확인 필요' : dirty ? '미저장 입력 · 이 브라우저에 7일 임시보관' : '서버 저장값과 동일'}</small>
      </>}
    </>}
  </div>;
}
