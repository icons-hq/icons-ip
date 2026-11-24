'use client';
import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { loadClaimRefundAccountAction, readClaimRefundAccountAction, retryVirtualAccountRefundAction, saveClaimRefundAccountAction } from '@/app/orders/claim-refund-account-actions';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { customerConfirm } from '@/lib/customer-confirm';
import { TOSS_REFUND_BANKS, tossBankLabel } from '@/lib/payments/toss-bank-codes';
import { CLAIM_REFUND_ACCOUNT_RECOVERY_PREFIX, claimRefundAccountError, claimRefundAccountReceiptMatches, claimRefundAccountRecoveryKey,
  claimRefundAccountRequestMetadata, normalizeClaimRefundAccountRequest, parseClaimRefundAccountRecovery, type ClaimRefundAccountContext, type ClaimRefundAccountFailure,
  type ClaimRefundAccountIdentity, type ClaimRefundAccountRecovery, type ClaimRefundAccountRequest, type ClaimRefundAccountReceipt,
  type ClaimRefundAccountRetry } from '@/lib/orders/claim-refund-account';

type Scope = ReturnType<typeof createGoodsDescriptionToolScope>;
const blank = { bankName: '', accountNumber: '', accountHolder: '' };

/* 가상계좌 환불 안내(ADR-0049 결정 5 보강). 결제대행사가 예금주를 확인한 뒤 송금하고, 은행 처리에 영업일 2일 정도 걸린다. */
const VIRTUAL_ACCOUNT_INTRO = '가상계좌로 결제한 주문은 입력한 환급 계좌로 결제대행사가 환불해요. 예금주를 확인한 뒤 송금하고, 은행 처리에 영업일 기준 2일 정도 걸려요.';
/* 입력된 계좌를 결제대행사에 그대로 보낼 수 없을 때(DB 판정 private.virtual_account_refund_account_usable — 목록의 은행 이름, 숫자 6~20자리). */
const VIRTUAL_ACCOUNT_FIX_HINT = '은행은 목록에서 고르고, 계좌번호는 숫자 6~20자리(하이픈 제외)로 다시 입력해주세요.';
const VIRTUAL_ACCOUNT_UNUSABLE = `등록된 계좌로는 환불할 수 없어요. ${VIRTUAL_ACCOUNT_FIX_HINT}`;
const VIRTUAL_ACCOUNT_ISSUE: Record<'required' | 'invalid' | 'unusable', string> = {
  required: '환불할 계좌가 없어 환불이 멈춰 있어요. 환급 계좌를 입력하면 그 계좌로 환불해요.',
  invalid: '결제대행사가 환급 계좌를 확인하지 못해 환불이 멈춰 있어요. 은행·계좌번호·예금주를 확인해 다시 입력해주세요.',
  unusable: VIRTUAL_ACCOUNT_UNUSABLE,
};

function savedMessage(context: ClaimRefundAccountContext | null, retry: ClaimRefundAccountRetry | undefined): string {
  if (context?.mode !== 'virtual_account') return '환불계좌를 등록했습니다. 환급은 담당자가 확인한 뒤 별도로 진행합니다.';
  if (retry === 'started') return '환급 계좌를 저장하고 이 계좌로 환불을 다시 요청했어요. 처리 결과는 이 화면에서 확인할 수 있어요.';
  if (retry === 'operator_required') return '환급 계좌를 저장했어요. 담당자가 확인한 뒤 이 계좌로 환불해요.';
  if (retry === 'account_invalid') return `환급 계좌를 저장했지만 이 계좌로는 환불할 수 없어요. ${VIRTUAL_ACCOUNT_FIX_HINT}`;
  if (retry === 'failed') return '환급 계좌를 저장했어요. 환불 요청은 아직 보내지 못했어요 — 잠시 뒤 [이 계좌로 환불 다시 요청]을 눌러주세요.';
  return '환급 계좌를 저장했어요. 환불할 때 이 계좌를 써요.';
}

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
  /* 입력 중 이탈 경고. 링크 이동은 고객 공용 확인창(lib/customer-confirm.ts)으로 묻는다 — 확인창은 비동기라 먼저 이동을 멈추고,
     [이동하기]를 누르면 같은 링크를 다시 눌러 원래 이동을 잇는다. 새로고침·탭 닫기는 브라우저만 물을 수 있어 beforeunload가 맡는다. */
  useEffect(() => {
    if (!dirty) return;
    let allowed: HTMLAnchorElement | null = null;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      /* 확인 뒤 다시 누른 그 링크는 그대로 보낸다. */
      if (anchor === allowed) { allowed = null; return; }
      const target = new URL(anchor.href, location.href);
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      event.preventDefault(); event.stopPropagation();
      void customerConfirm({ title: '화면을 이동할까요?', message: '입력 중인 계좌정보는 브라우저에 보관하지 않아요.', confirmLabel: '이동하기', cancelLabel: '계속 입력' })
        .then(confirmed => {
          if (!confirmed || !anchor.isConnected) return;
          /* 이미 이동을 확인했으니 전체 이동에서 브라우저가 한 번 더 묻지 않게 한다. */
          window.removeEventListener('beforeunload', unload);
          allowed = anchor;
          anchor.click();
        });
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);

  function clearRecovery() { try { sessionStorage.removeItem(key); } catch {} setRecovery(null); dispatched.current = null; setCanRetry(false); }
  function accept(receipt: ClaimRefundAccountReceipt, original: ClaimRefundAccountRecovery, retry?: ClaimRefundAccountRetry) {
    if (!claimRefundAccountReceiptMatches(receipt, original)) { setError('현재 요청과 다른 저장 결과입니다. 이전 요청의 결과를 다시 확인해주세요.'); return; }
    clearRecovery(); setDraft(blank); setError(''); setNeedsRefresh(true); setReload(value => value + 1);
    setMessage(receipt.state === 'saved' ? savedMessage(context, retry)
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
      else if (result.receipt?.state === 'saved') accept(result.receipt, original, result.refundRetry);
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
      else if (result.receipt) accept(result.receipt, original, result.refundRetry);
      else setMessage(dispatched.current ? '아직 저장된 결과를 확인하지 못했습니다. 같은 내용으로 다시 저장할 수 있습니다.'
        : '아직 저장된 결과가 없습니다. 계좌정보는 보관하지 않았으므로 이전 요청을 종료한 뒤 새로 입력해주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('이전 요청의 결과를 확인하지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  function refresh() { if (busy.current || recovery) return; setError(''); setNeedsRefresh(true); setReload(value => value + 1); }
  async function retryRefund() {
    if (busy.current || recovery) return;
    const ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await retryVirtualAccountRefundAction(identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      setMessage(result.refundRetry === 'started' ? '이 계좌로 환불을 다시 요청했어요. 처리 결과는 이 화면에서 확인할 수 있어요.'
        : result.refundRetry === 'operator_required' ? '담당자가 확인한 뒤 이 계좌로 환불해요.'
          : result.refundRetry === 'account_invalid' ? VIRTUAL_ACCOUNT_UNUSABLE
            : '지금은 환불을 다시 요청할 수 없어요. 최신 상태를 확인해주세요.');
      setNeedsRefresh(true); setReload(value => value + 1);
    } catch { if (alive.current && scope.canApply(ticket)) setError('환불 요청 결과를 확인하지 못했습니다. 잠시 뒤 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const virtualAccount = context?.mode === 'virtual_account';
  /* 계좌는 이미 있는데 환불이 계좌 없음으로 멈췄다(저장 직후 재시도가 실패했거나 결제 화면 계좌를 그대로 쓸 때). 거절된 계좌는 바꿔야 풀린다. */
  const canRetryRefund = virtualAccount && context?.refundAccountIssue === 'required' && Boolean(context.maskedAccount || context.checkoutAccount);

  return <section className="order-detail-inquiry col" aria-label="환불계좌 확인" style={{ alignItems: 'stretch', gap: 12 }}>
    <h3 style={{ margin: 0 }}>환불계좌 확인</h3>
    {virtualAccount ? <p>{VIRTUAL_ACCOUNT_INTRO}</p>
      : context?.blocker === 'refund_account_not_needed' ? null : <p>무통장으로 결제한 주문의 환불계좌를 등록해주세요. 계좌 등록만으로 환급이 완료되지는 않습니다.</p>}
    {virtualAccount && context?.refundAccountIssue ? <p role="alert">{VIRTUAL_ACCOUNT_ISSUE[context.refundAccountIssue]}</p> : null}
    {context?.maskedAccount ? <p>등록된 계좌: {context.maskedAccount} · {context.maskedHolder}</p> : null}
    {virtualAccount && context?.checkoutAccount ? <p>결제 화면에서 입력한 계좌: {tossBankLabel(context.checkoutAccount.bankCode)} {context.checkoutAccount.maskedAccount} · {context.checkoutAccount.maskedHolder}
      {context.maskedAccount ? ' (위에 등록된 계좌로 먼저 환불해요)' : ''}</p> : null}
    {!context && !error ? <p role="status">현재 요청 상태를 확인하고 있습니다.</p> : null}
    {context && !context.allowed && !context.maskedAccount ? <p>{claimRefundAccountError(undefined, context.blocker ?? undefined).error}</p> : null}
    {recovery ? <p role="alert">이전 저장 요청의 결과를 먼저 확인해주세요. 요청번호만 이 탭에 보관하며 계좌정보는 저장하지 않습니다.</p> : null}
    {context?.allowed || recovery ? <form onSubmit={event => { event.preventDefault(); startTransition(async () => { await send(); }); }}>
      <fieldset disabled={locked} className="col" style={{ border: 0, padding: 0, gap: 10 }}>
        <legend>{virtualAccount && context?.maskedAccount ? '바꿀 환급 계좌' : '결제한 분의 환불계좌'}</legend>
        {([{ key: 'bankName', label: '은행', max: 40 }, { key: 'accountNumber', label: '계좌번호', max: 30 }, { key: 'accountHolder', label: '예금주', max: 40 }] as const).map(field =>
          <label className="col" style={{ gap: 5 }} key={field.key}>{field.label}{field.key === 'bankName' && virtualAccount
            /* 가상계좌 환불은 결제대행사에 은행 코드를 보낸다 — 목록에서 골라 이름 → 코드 변환이 추측이 되지 않게 한다. */
            ? <select required value={draft.bankName} onChange={event => { if (!locked && scope.capture()) setDraft(previous => ({ ...previous, bankName: event.target.value })); }}>
              <option value="">은행 선택</option>
              {TOSS_REFUND_BANKS.map(bank => <option key={bank.code} value={bank.name}>{bank.name}</option>)}
            </select>
            : <input required autoComplete="off" maxLength={field.max}
            inputMode={field.key === 'accountNumber' ? 'numeric' : undefined} pattern={field.key === 'accountNumber' ? '(?=.*[0-9])[0-9\\-]{8,30}' : undefined}
            value={draft[field.key]} onChange={event => { if (!locked && scope.capture()) setDraft(previous => ({ ...previous, [field.key]: event.target.value })); }} />}</label>)}
      </fieldset>
      {!recovery ? <button className="btn" type="submit" disabled={locked}>{pending ? '저장 중…' : virtualAccount && context?.maskedAccount ? '환급 계좌 바꾸기' : virtualAccount ? '환급 계좌 저장' : '환불계좌 등록'}</button> : null}
    </form> : null}
    {recovery ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" type="button" disabled={pending} onClick={() => startTransition(async () => { await check(); })}>이전 저장 결과 확인</button>
      {canRetry ? <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => startTransition(async () => { await send(true); })}>같은 내용으로 다시 저장</button>
        : <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => startTransition(async () => { await check(true); })}>미저장 요청 종료 후 새로 입력</button>}
    </div> : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {canRetryRefund ? <button className="btn" type="button" disabled={pending} onClick={() => startTransition(async () => { await retryRefund(); })}>이 계좌로 환불 다시 요청</button> : null}
      <button className="btn btn-ghost" type="button" disabled={pending} onClick={refresh}>최신 요청 상태 확인</button>
    </div>}
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
