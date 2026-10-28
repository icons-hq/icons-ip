'use client';
import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { loadBankRefundContextAction, readBankRefundAction, recordBankRefundAction } from '@/app/admin/bank-transfer-refund-actions';
import { requestBankRefundAccount } from '@/lib/admin/bank-transfer-refund-account';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import {
  BANK_REFUND_LABELS, BANK_REFUND_RECOVERY_PREFIX, bankRefundError, bankRefundMetadata, bankRefundReceiptMatches,
  bankRefundRecoveryKey, normalizeBankRefundRequest, parseBankRefundRecovery,
  type BankRefundAccountView, type BankRefundContext, type BankRefundFailure, type BankRefundIdentity,
  type BankRefundReceipt, type BankRefundRecovery, type BankRefundRequest,
} from '@/lib/admin/bank-transfer-refund';

type Scope = ReturnType<typeof createGoodsDescriptionToolScope>;
const empty = { occurredAt: '', evidence: '', note: '', confirmed: false };
const localInstant = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 23); };

function AccountView({ account, onClose }: { account: BankRefundAccountView; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const timeout = window.setTimeout(onClose, 60_000);
    const hide = () => { if (document.visibilityState !== 'visible') onClose(); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', hide); };
  }, [onClose]);
  return <dialog ref={dialog} aria-labelledby="bank-refund-account-title" onCancel={onClose} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    style={{ width: 'min(460px, calc(100vw - 32px))', maxHeight: '85vh', overflow: 'auto', padding: 24, border: '1px solid #c8cdd2' }}>
    <h3 id="bank-refund-account-title">환불계좌 원문</h3>
    <p>송금 목적의 열람이 기록됐습니다. 계좌정보는 이 화면에만 표시되며 60초 후 또는 다른 탭으로 이동하면 닫힙니다.</p>
    <dl data-private="true" style={{ overflowWrap: 'anywhere' }}>
      <dt>은행</dt><dd>{account.bankName}</dd><dt>계좌번호</dt><dd>{account.accountNumber}</dd><dt>예금주</dt><dd>{account.accountHolder}</dd>
    </dl>
    <button className="btn btn-sm" type="button" onClick={onClose}>계좌정보 닫기</button>
  </dialog>;
}

function RefundPanel({ identity, scope }: { identity: BankRefundIdentity; scope: Scope }) {
  const router = useRouter(), key = bankRefundRecoveryKey(identity);
  const [context, setContext] = useState<BankRefundContext | null>(null);
  const [draft, setDraft] = useState(empty), [pending, setPending] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0), [canRetry, setCanRetry] = useState(false);
  const [account, setAccount] = useState<BankRefundAccountView | null>(null);
  const [recovery, setRecovery] = useState<BankRefundRecovery | null>(() => {
    try { return parseBankRefundRecovery(JSON.parse(sessionStorage.getItem(key) ?? 'null'), identity); } catch { return null; }
  });
  const alive = useRef(true), busy = useRef(false), dispatched = useRef<BankRefundRequest | null>(null);
  const nextKind = !context ? null : context.confirmBlocker === null ? 'confirm_cancellation'
    : context.fileBlocker === null ? 'file_transfer' : context.completeBlocker === null ? 'complete_transfer' : null;
  const kind = recovery?.kind ?? nextKind;
  const locked = pending || Boolean(recovery) || needsRefresh || !nextKind;
  const dirty = Boolean(recovery || draft.occurredAt || draft.evidence || draft.note || draft.confirmed);
  const closeAccount = useMemo(() => () => setAccount(null), []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; dispatched.current = null; }; }, []);
  useEffect(() => {
    let active = true; const ticket = scope.capture(); if (!ticket) return;
    startTransition(async () => {
      try {
        const result = await loadBankRefundContextAction(identity);
        if (!active || !alive.current || !scope.canApply(ticket)) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
        else { setContext(result.context); setNeedsRefresh(false); }
      } catch { if (active && alive.current && scope.canApply(ticket)) setError('최신 환불 상태를 읽지 못했습니다. 다시 확인해주세요.'); }
    });
    return () => { active = false; };
  }, [identity, reload, scope]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const destination = new URL(anchor.href, location.href);
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
      if (!window.confirm('입력 중인 증빙은 보관하지 않습니다. 화면을 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);

  function clearRecovery() { try { sessionStorage.removeItem(key); } catch {} setRecovery(null); dispatched.current = null; setCanRetry(false); }
  function accept(receipt: BankRefundReceipt, original: BankRefundRecovery) {
    if (!bankRefundReceiptMatches(receipt, original)) { setError('현재 요청과 다른 결과입니다. 이전 처리 결과를 다시 확인해주세요.'); return; }
    clearRecovery(); setDraft(empty); setAccount(null); setError(''); setNeedsRefresh(true); setReload(value => value + 1);
    setMessage(receipt.state === 'sealed' ? '이전 미처리 요청을 종료했습니다. 최신 상태를 확인한 뒤 다시 입력해주세요.'
      : receipt.kind === 'complete_transfer' ? '실제 송금 증빙을 기록하고 환불을 완료했습니다.'
        : receipt.kind === 'confirm_cancellation' ? '취소를 확정하고 재고를 복원했습니다. 환불은 송금대기로 남아 있습니다.' : '계좌 송금 접수를 기록했습니다. 실제 송금 후 완료 증빙을 남겨주세요.');
    router.refresh();
  }
  function fail(failure: BankRefundFailure, uncertain: boolean) {
    setError(failure.error);
    if (failure.authChanged) { clearRecovery(); setDraft(empty); setAccount(null); scope.authenticate(null, null); return; }
    if (!failure.uncertain && !uncertain) { clearRecovery(); if (failure.conflict) setNeedsRefresh(true); }
  }
  async function save(retry = false) {
    if (busy.current || !scope.capture() || (!retry && locked) || retry && !dispatched.current) return;
    const occurredAt = new Date(draft.occurredAt);
    const original = dispatched.current ?? normalizeBankRefundRequest({ ...identity, version: 1, operationId: crypto.randomUUID(),
      revision: context?.revision, amount: context?.amount, kind: nextKind, evidence: draft.evidence.trim(), note: draft.note.trim(),
      occurredAt: Number.isFinite(occurredAt.getTime()) ? occurredAt.toISOString() : '', confirmed: draft.confirmed });
    if (!original) { setError('확인 일시, 증빙, 메모와 확인 항목을 모두 입력해주세요.'); return; }
    const ticket = scope.capture(); if (!ticket) return;
    const metadata = bankRefundMetadata(original), wasUncertain = Boolean(recovery);
    try { sessionStorage.setItem(key, JSON.stringify(metadata)); } catch { setError('처리 요청번호를 보관할 수 없습니다. 브라우저 저장소를 확인해주세요.'); return; }
    dispatched.current = original; setRecovery(metadata); setCanRetry(true); busy.current = true; setPending(true); setAccount(null); setError(''); setMessage('');
    try {
      const result = await recordBankRefundAction(original);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, wasUncertain);
      else if (result.receipt?.state === 'recorded') accept(result.receipt, original);
      else setError('처리 결과를 확인하지 못했습니다. 이전 처리 결과를 먼저 확인해주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('처리 결과를 확인하지 못했습니다. 이전 처리 결과를 먼저 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function check(seal = false) {
    if (busy.current || !recovery) return;
    const original = recovery, ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setAccount(null); setError(''); setMessage('');
    try {
      const result = await readBankRefundAction(original, seal);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, true);
      else if (result.receipt) accept(result.receipt, original);
      else setMessage(dispatched.current ? '아직 처리 결과가 없습니다. 같은 내용으로 다시 요청할 수 있습니다.' : '아직 처리 결과가 없습니다. 이전 요청을 종료한 뒤 증빙을 다시 입력해주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('이전 처리 결과를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  async function viewAccount() {
    if (busy.current || recovery || needsRefresh || !context || context.viewBlocker !== null) return;
    const ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setAccount(null); setError('');
    try {
      const result = await requestBankRefundAccount({ ...identity, revision: context.revision, viewId: crypto.randomUUID() });
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, false); else setAccount(result.account);
    } catch { if (alive.current && scope.canApply(ticket)) setError('환불계좌를 확인하지 못했습니다. 다시 확인해주세요.'); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const blocked = context && !nextKind && context.phase !== 'completed'
    ? bankRefundError(undefined, context.confirmBlocker ?? context.completeBlocker ?? context.fileBlocker ?? undefined).error : null;

  return <section aria-label="무통장 환불 처리" className="col" style={{ alignItems: 'stretch', gap: 12 }}>
    <h4 style={{ margin: 0 }}>무통장 환불</h4>
    <p>취소 확정과 실제 송금 완료를 따로 기록합니다. 환불 수단은 계좌 송금이며, 이 화면에서 은행 송금을 실행하지 않습니다.</p>
    {context ? <><p><strong>환불 전액: {context.amount.toLocaleString('ko-KR')}원</strong> · {context.phase === 'completed' ? '송금 완료' : context.phase === 'awaiting_transfer' ? '송금대기' : '취소 확정 전'}</p>
      {context.gift ? <p>선물의 결제한 분에게 환불합니다. 선물 받는 분의 요청과 환급 대상을 구분해주세요.</p> : null}
      {context.confirmedAt ? <p>취소 확정 {formatOrderDateTime(context.confirmedAt)} · 접수 {context.filedAt ? formatOrderDateTime(context.filedAt) : '미접수'}</p> : null}
      {context.maskedAccount ? <p>등록된 환불계좌: {context.maskedAccount} · {context.maskedHolder}</p> : null}
    </> : !error ? <p role="status">현재 환불 상태를 확인하고 있습니다.</p> : null}
    {blocked ? <p>{blocked}</p> : null}
    {context?.viewBlocker === null ? <button className="btn btn-sm btn-ghost" disabled={pending || Boolean(recovery) || needsRefresh} type="button"
      onClick={() => startTransition(async () => { await viewAccount(); })}>환불계좌 원문 확인</button> : null}
    {recovery ? <p role="alert">이전 처리 결과를 먼저 확인해주세요. 요청번호만 이 탭에 보관하며 증빙과 계좌정보는 저장하지 않습니다.</p> : null}
    {kind ? <form onSubmit={event => { event.preventDefault(); startTransition(async () => { await save(); }); }}>
      <fieldset disabled={locked} className="col" style={{ border: 0, padding: 0, gap: 10 }}>
        <legend>{BANK_REFUND_LABELS[kind]}</legend>
        <label>확인 일시<input type="datetime-local" step="0.001" required value={draft.occurredAt} onChange={event => setDraft(previous => ({ ...previous, occurredAt: event.target.value }))} /></label>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setDraft(previous => ({ ...previous, occurredAt: localInstant() }))}>현재 시각 입력</button>
        <label>확인 증빙<input required maxLength={300} value={draft.evidence} onChange={event => setDraft(previous => ({ ...previous, evidence: event.target.value }))} placeholder="상담 기록 또는 송금 확인 증빙 참조" /></label>
        <label>처리 메모<input required maxLength={300} value={draft.note} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} /></label>
        <p>증빙과 메모에 계좌번호·예금주 등 개인정보를 입력하지 마세요.</p>
        <label className="row" style={{ alignItems: 'flex-start', gap: 8 }}><input type="checkbox" required checked={draft.confirmed} onChange={event => setDraft(previous => ({ ...previous, confirmed: event.target.checked }))} />
          <span>{kind === 'complete_transfer' ? '등록된 환불계좌로 표시된 전액의 실제 송금이 완료된 것을 확인했습니다.'
            : kind === 'confirm_cancellation' ? '주문 전체의 취소 확정 근거를 확인했습니다. 재고를 복원하며 환불은 송금대기로 남습니다.'
              : '결제한 분의 환불계좌와 전액 송금 접수 내용을 확인했습니다. 실제 송금 완료는 별도로 기록합니다.'}</span>
        </label>
      </fieldset>
      {!recovery ? <button className="btn btn-sm" type="submit" disabled={locked}>{pending ? '처리 중…' : BANK_REFUND_LABELS[kind]}</button> : null}
    </form> : null}
    {recovery ? <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button className="btn btn-sm" disabled={pending} type="button" onClick={() => startTransition(async () => { await check(); })}>이전 처리 결과 확인</button>
      {canRetry ? <button className="btn btn-sm btn-ghost" disabled={pending} type="button" onClick={() => startTransition(async () => { await save(true); })}>같은 내용으로 다시 요청</button>
        : <button className="btn btn-sm btn-ghost" disabled={pending} type="button" onClick={() => startTransition(async () => { await check(true); })}>미처리 요청 종료 후 새로 입력</button>}
    </div> : <button className="btn btn-sm btn-ghost" disabled={pending || dirty && !needsRefresh} type="button" onClick={() => { setError(''); setAccount(null); if (needsRefresh) setDraft(empty); setNeedsRefresh(true); setReload(value => value + 1); }}>최신 환불 상태 확인</button>}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {account ? <AccountView account={account} onClose={closeAccount} /> : null}
  </section>;
}

export function BankTransferRefund({ actorId, orderId, claimId }: { actorId: string; orderId: string; claimId: string }) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(actorId), [actorId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const discard = () => { try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i); if (key?.startsWith(BANK_REFUND_RECOVERY_PREFIX)) sessionStorage.removeItem(key); } } catch {} };
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
  if (!auth.ready) return <p role="status">무통장 환불 처리를 위해 로그인 상태를 확인하고 있습니다.</p>;
  if (auth.blocked || !identity) return <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 요청을 다시 열어주세요.</p>;
  return <RefundPanel key={`${orderId}:${claimId}:${sessionId}`} identity={identity} scope={scope} />;
}
