'use client';
import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { loadClaimRefundAccountAction, readClaimRefundAccountAction, saveClaimRefundAccountAction } from '@/app/orders/claim-refund-account-actions';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { CLAIM_REFUND_ACCOUNT_RECOVERY_PREFIX, claimRefundAccountError, claimRefundAccountReceiptMatches, claimRefundAccountRecoveryKey,
  claimRefundAccountRequestMetadata, normalizeClaimRefundAccountRequest, parseClaimRefundAccountRecovery, type ClaimRefundAccountContext, type ClaimRefundAccountFailure,
  type ClaimRefundAccountIdentity, type ClaimRefundAccountRecovery, type ClaimRefundAccountRequest, type ClaimRefundAccountReceipt } from '@/lib/orders/claim-refund-account';

type Scope = ReturnType<typeof createGoodsDescriptionToolScope>;
const blank = { bankName: '', accountNumber: '', accountHolder: '' };

function RefundAccountForm({ identity, scope }: { identity: ClaimRefundAccountIdentity; scope: Scope }) {
  const key = claimRefundAccountRecoveryKey(identity);
  const [context, setContext] = useState<ClaimRefundAccountContext | null>(null);
  const [draft, setDraft] = useState(blank);
  const [recovery, setRecovery] = useState<ClaimRefundAccountRecovery | null>(() => {
    try { return parseClaimRefundAccountRecovery(JSON.parse(sessionStorage.getItem(key) ?? 'null'), identity); } catch { return null; }
  });
  const [pending, setPending] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const dispatched = useRef<ClaimRefundAccountRequest | null>(null), busy = useRef(false), alive = useRef(true);
  const locked = pending || Boolean(recovery) || needsRefresh || !context?.allowed;

  useEffect(() => { alive.current = true; return () => { alive.current = false; dispatched.current = null; }; }, []);
  useEffect(() => {
    let active = true; const ticket = scope.capture(); if (!ticket) return;
    startTransition(async () => {
      try {
        const result = await loadClaimRefundAccountAction(identity);
        if (!active || !alive.current || !scope.canApply(ticket)) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
        else { setContext(result.context); setNeedsRefresh(false); }
      } catch { if (active && alive.current && scope.canApply(ticket)) setError('최신 요청 상태를 읽지 못했습니다. 다시 확인해주세요.'); }
    });
    return () => { active = false; };
  }, [identity, reload, scope]);

  const dirty = Boolean(recovery || pending || Object.values(draft).some(Boolean));
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      if (!window.confirm('입력 중인 계좌정보는 브라우저에 보관하지 않습니다. 화면을 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);

  function clearRecovery() { try { sessionStorage.removeItem(key); } catch {} setRecovery(null); dispatched.current = null; setCanRetry(false); }
  function accept(receipt: ClaimRefundAccountReceipt, original: ClaimRefundAccountRecovery) {
    if (!claimRefundAccountReceiptMatches(receipt, original)) { setError('현재 요청과 다른 저장 결과입니다. 이전 요청의 결과를 다시 확인해주세요.'); return; }
    clearRecovery(); setDraft(blank); setError(''); setNeedsRefresh(true); setReload(value => value + 1);
    setMessage(receipt.state === 'saved' ? '환불계좌를 등록했습니다. 환급은 담당자가 확인한 뒤 별도로 진행합니다.'
      : '이전 저장 요청을 종료했습니다. 최신 상태를 확인한 뒤 계좌를 새로 입력해주세요.');
  }
  function fail(result: ClaimRefundAccountFailure, wasUncertain: boolean) {
    setError(result.error);
    if (result.authChanged) { clearRecovery(); setDraft(blank); scope.authenticate(null, null); return; }
    if (!result.uncertain && !wasUncertain) { clearRecovery(); if (result.conflict) setNeedsRefresh(true); }
  }
  async function send(retry = false) {
    if (busy.current || !scope.capture() || (!retry && locked) || retry && !dispatched.current) return;
    const original = dispatched.current ?? normalizeClaimRefundAccountRequest({ ...identity, version: 1, operationId: crypto.randomUUID(), revision: context?.revision, account: draft });
    if (!original) { setError('은행, 계좌번호, 예금주를 모두 확인해주세요.'); return; }
    const ticket = scope.capture(); if (!ticket) return;
    const metadata = claimRefundAccountRequestMetadata(original);
    try { sessionStorage.setItem(key, JSON.stringify(metadata)); } catch { setError('저장 요청번호를 보관할 수 없습니다. 브라우저 저장소를 확인해주세요.'); return; }
    const wasUncertain = Boolean(recovery);
    dispatched.current = original; setCanRetry(true); setRecovery(metadata); busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await saveClaimRefundAccountAction(original);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, wasUncertain);
      else if (result.receipt?.state === 'saved') accept(result.receipt, original);
      else setError('저장 결과를 확인하지 못했습니다. 이전 요청의 결과를 먼저 확인해주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('저장 결과를 확인하지 못했습니다. 이전 요청의 결과를 먼저 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function check(seal = false) {
    if (busy.current || !recovery) return;
    const original = recovery, ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await readClaimRefundAccountAction(original, seal);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, true);
      else if (result.receipt) accept(result.receipt, original);
      else setMessage(dispatched.current ? '아직 저장된 결과를 확인하지 못했습니다. 같은 내용으로 다시 저장할 수 있습니다.'
        : '아직 저장된 결과가 없습니다. 계좌정보는 보관하지 않았으므로 이전 요청을 종료한 뒤 새로 입력해주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('이전 요청의 결과를 확인하지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  function refresh() { if (busy.current || recovery) return; setError(''); setNeedsRefresh(true); setReload(value => value + 1); }

  return <section className="order-detail-inquiry col" aria-label="환불계좌 확인" style={{ alignItems: 'stretch', gap: 12 }}>
    <h3 style={{ margin: 0 }}>환불계좌 확인</h3>
    <p>무통장으로 결제한 주문의 환불계좌를 등록해주세요. 계좌 등록만으로 환급이 완료되지는 않습니다.</p>
    {context?.maskedAccount ? <p>등록된 계좌: {context.maskedAccount} · {context.maskedHolder}</p> : null}
    {!context && !error ? <p role="status">현재 요청 상태를 확인하고 있습니다.</p> : null}
    {context && !context.allowed && !context.maskedAccount ? <p>{claimRefundAccountError(undefined, context.blocker ?? undefined).error}</p> : null}
    {recovery ? <p role="alert">이전 저장 요청의 결과를 먼저 확인해주세요. 요청번호만 이 탭에 보관하며 계좌정보는 저장하지 않습니다.</p> : null}
    {context?.allowed || recovery ? <form onSubmit={event => { event.preventDefault(); startTransition(async () => { await send(); }); }}>
      <fieldset disabled={locked} className="col" style={{ border: 0, padding: 0, gap: 10 }}>
        <legend>결제한 분의 환불계좌</legend>
        {([{ key: 'bankName', label: '은행', max: 40 }, { key: 'accountNumber', label: '계좌번호', max: 30 }, { key: 'accountHolder', label: '예금주', max: 40 }] as const).map(field =>
          <label className="col" style={{ gap: 5 }} key={field.key}>{field.label}<input required autoComplete="off" maxLength={field.max}
            inputMode={field.key === 'accountNumber' ? 'numeric' : undefined} pattern={field.key === 'accountNumber' ? '(?=.*[0-9])[0-9\\-]{8,30}' : undefined}
            value={draft[field.key]} onChange={event => { if (!locked && scope.capture()) setDraft(previous => ({ ...previous, [field.key]: event.target.value })); }} /></label>)}
      </fieldset>
      {!recovery ? <button className="btn" type="submit" disabled={locked}>{pending ? '저장 중…' : '환불계좌 등록'}</button> : null}
    </form> : null}
    {recovery ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" type="button" disabled={pending} onClick={() => startTransition(async () => { await check(); })}>이전 저장 결과 확인</button>
      {canRetry ? <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => startTransition(async () => { await send(true); })}>같은 내용으로 다시 저장</button>
        : <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => startTransition(async () => { await check(true); })}>미저장 요청 종료 후 새로 입력</button>}
    </div> : <button className="btn btn-ghost" type="button" disabled={pending} onClick={refresh}>최신 요청 상태 확인</button>}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}

export function ClaimRefundAccount({ actorId, orderId, claimId }: { actorId: string; orderId: string; claimId: string }) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(actorId), [actorId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const discard = () => {
      try { for (let index = sessionStorage.length - 1; index >= 0; index--) { const key = sessionStorage.key(index); if (key?.startsWith(CLAIM_REFUND_ACCOUNT_RECOVERY_PREFIX)) sessionStorage.removeItem(key); } } catch {}
    };
    const signout = () => { scope.authenticate(null, null); discard(); setSessionId(null); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signout);
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      const id = session ? inquiryDraftSessionId(session.access_token) : null;
      scope.authenticate(session?.user.id ?? null, id);
      if (scope.getSnapshot().blocked) { discard(); setSessionId(null); } else setSessionId(id);
    }).data.subscription;
    return () => { scope.dispose(); subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signout); };
  }, [scope]);
  const identity = useMemo(() => sessionId ? { actorId, sessionId, orderId, claimId } : null, [actorId, sessionId, orderId, claimId]);
  if (!auth.ready) return <p role="status">환불계좌를 확인하기 위해 로그인 상태를 확인하고 있습니다.</p>;
  if (auth.blocked || !identity) return <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 주문을 다시 열어주세요.</p>;
  return <RefundAccountForm key={`${orderId}:${claimId}:${sessionId}`} identity={identity} scope={scope} />;
}
