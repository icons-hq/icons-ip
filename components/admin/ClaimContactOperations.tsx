'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, CLAIM_CONTACT_JOURNAL_PREFIX, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeClaimContact, fetchClaimContactContext, readOrSealClaimContactOperation, recordClaimReshipmentV2 } from '@/lib/claim-contact/client';
import { claimContactError, normalizeClaimContactChangeRequest, normalizeClaimContactReshipmentRequest, parseClaimContactJournal,
  type ChangeRequest, type ClaimContactJournal, type Command, type ContextResponse, type ErrorResponse, type OperationReceipt,
  type OperationRequest, type ReshipmentRequest, type Target } from '@/lib/claim-contact/contracts';
import type { AdminClaimReshipItem } from '@/lib/admin/claims.server';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { formatOrderDateTime } from '@/lib/orders';

type Props = { actorId: string; orderId: string; claimId: string; canReship: boolean; carriers: ShippingCarrierRegistry; reshipItems: readonly AdminClaimReshipItem[] };
type Draft = { recipientName: string; phone: string; postalCode: string; address1: string; address2: string; agreement: string; customerConfirmed: boolean; handoffConfirmed: boolean;
  carrier: string; trackingNumber: string; items: Record<string, string>; destinationConfirmed: boolean; dispatchConfirmed: boolean };
const blank = (): Draft => ({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', agreement: '', customerConfirmed: false, handoffConfirmed: false,
  carrier: '', trackingNumber: '', items: {}, destinationConfirmed: false, dispatchConfirmed: false });
const targetLabel = (target: Target) => target === 'collection' ? '회수지' : '재배송지';
type Dispatched = { command: Command; request: ChangeRequest | ReshipmentRequest };

export function claimContactJournalKey(identity: ClaimContactIdentity, orderId: string, claimId: string) {
  // One pending operation locks both address targets and dispatch in this tab.
  return `${CLAIM_CONTACT_JOURNAL_PREFIX}${identity.actorId}:${identity.sessionId}:${orderId}:${claimId}`;
}
function readJournal(key: string, identity: ClaimContactIdentity, orderId: string, claimId: string) {
  try {
    const value = parseClaimContactJournal(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    if (value?.actorId === identity.actorId && value.sessionId === identity.sessionId && value.orderId === orderId && value.claimId === claimId) return value;
    sessionStorage.removeItem(key);
  } catch { /* A write still requires successful journal persistence. */ }
  return null;
}
function receiptMatches(receipt: OperationReceipt, journal: ClaimContactJournal) {
  return receipt.operationId === journal.operationId && receipt.actorId === journal.actorId && receipt.sessionId === journal.sessionId
    && receipt.orderId === journal.orderId && receipt.claimId === journal.claimId && receipt.command === journal.command
    && receipt.target === journal.target && receipt.expectedClaimType === journal.expectedClaimType && receipt.expectedClaimRevision === journal.expectedClaimRevision;
}

export function ClaimContactOperationPanel({ identity, scope, orderId, claimId, canReship, carriers, reshipItems }: Omit<Props, 'actorId'> & {
  identity: ClaimContactIdentity; scope: ClaimContactScope;
}) {
  const router = useRouter(), key = claimContactJournalKey(identity, orderId, claimId);
  const [context, setContext] = useState<ContextResponse | null>(null), [draft, setDraft] = useState<Draft>(blank);
  const [recovery, setRecovery] = useState<ClaimContactJournal | null>(() => readJournal(key, identity, orderId, claimId));
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const alive = useRef(true), busy = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const dispatched = useRef<Dispatched | null>(null);
  const dirty = Boolean(context || recovery);

  function clearPrivate() { setContext(null); setDraft(blank()); dispatched.current = null; setCanRetry(false); }
  function closePrivate() { generation.current++; controller.current?.abort(); clearPrivate(); }
  useEffect(() => {
    alive.current = true; generation.current++;
    const hide = () => { if (document.visibilityState !== 'visible') { generation.current++; controller.current?.abort(); setContext(null); setDraft(blank()); dispatched.current = null; setCanRetry(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; controller.current?.abort(); dispatched.current = null; document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => {
    if (!context?.expiresAt || recovery) return;
    const timeout = window.setTimeout(() => { setContext(null); setDraft(blank()); setError('주소 확인 시간이 지났습니다. 최신 주소를 다시 확인해주세요.'); }, Math.max(0, Date.parse(context.expiresAt) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [context?.expiresAt, recovery]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const destination = new URL(anchor.href, location.href);
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
      if (!window.confirm('입력한 연락처는 보관하지 않습니다. 미확정 요청은 다시 열어 처리 결과를 확인할 수 있습니다. 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);

  function begin() {
    const ticket = scope.capture(); if (busy.current || !ticket) return null;
    busy.current = true; setPending(true); setError(''); setMessage('');
    const epoch = ++generation.current, abort = new AbortController(); controller.current = abort;
    return { valid: () => alive.current && generation.current === epoch && scope.canApply(ticket),
      options: { signal: abort.signal, expectedIdentity: identity } };
  }
  function end() { busy.current = false; controller.current = null; if (alive.current) setPending(false); }
  function fail(failure: ErrorResponse) {
    setError(failure.message);
    if (failure.authChanged) { clearPrivate(); scope.authenticate(null, null); }
    else if (failure.recoveryOnly && !failure.uncertain) clearPrivate();
    // A late error cannot prove the original request did not commit. Keep its
    // metadata until a receipt or an explicit server seal is read back.
  }
  function accept(receipt: OperationReceipt, original: ClaimContactJournal) {
    if (!receiptMatches(receipt, original)) { setError('현재 요청과 다른 결과입니다. 저장 결과를 다시 확인해주세요.'); return; }
    try { sessionStorage.removeItem(key); } catch { /* A retained journal can only recover this completed operation. */ }
    setRecovery(null); clearPrivate(); setError('');
    setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 주소를 확인한 뒤 다시 입력해주세요.'
      : receipt.state === 'noop' ? '변경할 내용이 없어 기존 연락처를 유지했습니다.'
        : receipt.command === 'reshipment' ? '확인한 재배송지와 실제 재출고를 기록했습니다.' : `${targetLabel(receipt.target)} 연락처를 수정했습니다.`);
    router.refresh();
  }
  async function load(target: Target, command: Command) {
    if (recovery || (command === 'reshipment' && !canReship)) return;
    const run = begin(); if (!run) return; clearPrivate();
    try {
      const result = await fetchClaimContactContext({ requestId: crypto.randomUUID(), orderId, claimId, target, command }, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else {
        setContext(result);
        setDraft({ ...blank(), recipientName: result.address?.recipientName ?? '', phone: result.address?.phone ?? '', postalCode: result.address?.postalCode.trim() ?? '', address1: result.address?.address1.trim() ?? '', address2: result.address?.address2 ?? '',
          carrier: carriers.find(carrier => carrier.active)?.code ?? '', items: Object.fromEntries(reshipItems.map(item => [item.id, item.currentVariantId])) });
      }
    } catch { if (run.valid()) setError('현재 주소를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { end(); }
  }
  async function save(retry = false) {
    if (busy.current || (!retry && recovery) || retry && !dispatched.current) return;
    if (!retry && (!context?.allowed || !context.address || !context.signedContext)) return;
    if (!retry && (!context!.expiresAt || Date.parse(context!.expiresAt) <= Date.now())) { closePrivate(); setError('주소 확인 시간이 지났습니다. 최신 주소를 다시 확인해주세요.'); return; }
    const operationId = crypto.randomUUID();
    const request = retry ? dispatched.current!.request : context!.command === 'change'
      ? normalizeClaimContactChangeRequest({ requestId: crypto.randomUUID(), orderId, claimId, target: context!.target, operationId, signedContext: context!.signedContext,
        contact: { recipientName: draft.recipientName, phone: draft.phone, address2: draft.address2,
          ...(draft.postalCode.trim() !== context!.address!.postalCode.trim() || draft.address1.trim() !== context!.address!.address1.trim() ? { postalCode: draft.postalCode, address1: draft.address1 } : {}) }, agreement: draft.agreement,
        customerConfirmed: draft.customerConfirmed, handoffNotStartedConfirmed: draft.handoffConfirmed })
      : normalizeClaimContactReshipmentRequest({ requestId: crypto.randomUUID(), orderId, claimId, operationId, signedContext: context!.signedContext,
        carrier: draft.carrier, trackingNumber: draft.trackingNumber, items: reshipItems.map(item => ({ orderItemId: item.id, variantId: draft.items[item.id] })),
        destinationConfirmed: draft.destinationConfirmed, dispatchConfirmed: draft.dispatchConfirmed });
    if (!request) { setError('연락처·합의 근거 또는 재출고 정보와 확인 항목을 모두 확인해주세요.'); return; }
    const command = retry ? dispatched.current!.command : context!.command;
    const journal = retry ? recovery : parseClaimContactJournal({ operationId: request.operationId, orderId, claimId, command,
      target: context!.target, expectedClaimType: context!.claimType, expectedClaimRevision: context!.claimRevision,
      actorId: identity.actorId, sessionId: identity.sessionId, startedAt: new Date().toISOString() });
    if (!journal) { setError('요청 상태를 확인하지 못했습니다. 최신 주소를 다시 확인해주세요.'); return; }
    const run = begin(); if (!run) return;
    try {
      try { sessionStorage.setItem(key, JSON.stringify(journal)); } catch { setError('요청번호를 보관할 수 없습니다. 브라우저 저장소를 확인해주세요.'); return; }
      dispatched.current = { command, request }; setRecovery(journal); setCanRetry(true);
      const result = command === 'change' ? await changeClaimContact(request, run.options) : await recordClaimReshipmentV2(request, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else if (result.receipt) accept(result.receipt, journal);
      else setError(claimContactError('claim_contact_outcome_unknown').message);
    } catch { if (run.valid()) setError(claimContactError('claim_contact_outcome_unknown').message); }
    finally { end(); }
  }
  async function check(sealIfAbsent = false) {
    if (!recovery) return;
    const original = recovery, run = begin(); if (!run) return;
    try {
      const request: OperationRequest = { requestId: crypto.randomUUID(), sealIfAbsent, orderId: original.orderId, claimId: original.claimId,
        operationId: original.operationId, command: original.command, target: original.target,
        expectedClaimType: original.expectedClaimType, expectedClaimRevision: original.expectedClaimRevision };
      const result = await readOrSealClaimContactOperation(request, run.options);
      if (!run.valid()) return;
      if ('code' in result) fail(result);
      else if (result.receipt) accept(result.receipt, original);
      else setMessage('아직 저장 결과가 없습니다. 같은 내용으로 다시 요청하거나 미처리 요청을 종료한 뒤 새로 입력해주세요.');
    } catch { if (run.valid()) setError(claimContactError('claim_contact_outcome_unknown').message); }
    finally { end(); }
  }
  const locked = pending || Boolean(recovery) || !context?.allowed || !context.address || !context.signedContext;
  const patch = (value: Partial<Draft>) => setDraft(previous => ({ ...previous, ...value }));
  return <section aria-label="회수·재배송 연락처 처리" className="admin-claim-contact">
    <h3>회수·재배송 연락처</h3>
    <p>수거·재배송을 시작하기 전에 받는 분, 연락처와 주소 전체를 수정합니다. 지역 요금이 달라지거나 요금 근거를 확인할 수 없는 변경은 저장하지 않습니다.</p>
    <div className="admin-claim-contact__buttons">
      <button className="btn btn-sm btn-ghost" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('collection', 'change'); }}>회수지 연락처 확인</button>
      <button className="btn btn-sm btn-ghost" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('reshipment', 'change'); }}>재배송지 연락처 확인</button>
      {canReship ? <button className="btn btn-sm" type="button" disabled={pending || Boolean(recovery)} onClick={() => { void load('reshipment', 'reshipment'); }}>최종 주소 확인 후 재출고 등록</button> : null}
    </div>
    {context ? <div data-private="true">
      <h4>{context.command === 'reshipment' ? '재출고 최종 주소 확인' : `${targetLabel(context.target)} 연락처 수정`}</h4>
      {context.referenceOnly ? <p>{context.sourceKind === 'seller_intake' ? '최초 접수 당시 주소를 참고합니다.' : '원주문 배송지를 참고합니다.'} 확인만으로 연락처가 수정되지는 않습니다.</p> : null}
      {context.address ? <p className="admin-claim-contact__address">{context.address.recipientName} · {context.address.phone}<br />({context.address.postalCode}) {context.address.address1}<br />{context.address.address2}</p>
        : <p>{context.piiState === 'purged' ? '주소 원문이 파기되어 표시하지 않습니다.' : context.unavailableReason === 'retention_due' ? '주소 보관기간이 지나 내용을 표시하지 않습니다.' : '현재 주소를 표시할 수 없습니다.'}</p>}
      {!context.allowed ? <p role="status">{claimContactError('claim_contact_blocked').message}</p> : null}
      {context.allowed && context.address ? <form autoComplete="off" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked}>
          <legend>{context.command === 'change' ? '연락처와 고객 확인' : '실제 발송 정보'}</legend>
          {context.command === 'change' ? <>
            <label>받는 분<input autoComplete="off" required value={draft.recipientName} onChange={event => patch({ recipientName: event.target.value })} /></label>
            <label>연락처<input autoComplete="off" inputMode="tel" required value={draft.phone} onChange={event => patch({ phone: event.target.value })} /></label>
            <label>우편번호<input autoComplete="off" inputMode="numeric" pattern={draft.postalCode.trim() !== context.address!.postalCode.trim() || draft.address1.trim() !== context.address!.address1.trim() ? "[0-9]{5}" : undefined} maxLength={20} required value={draft.postalCode} onChange={event => patch({ postalCode: event.target.value })} /></label>
            <label>기본 주소<input autoComplete="off" maxLength={200} required value={draft.address1} onChange={event => patch({ address1: event.target.value })} /></label>
            <label>상세주소<input autoComplete="off" value={draft.address2} onChange={event => patch({ address2: event.target.value })} /></label>
            <label>고객 합의 근거<textarea required rows={3} value={draft.agreement} onChange={event => patch({ agreement: event.target.value })} /></label>
            <p>받는 분 50자, 연락처 숫자 8~15자리, 우편번호 5자리, 기본·상세주소 각각 200자, 합의 근거 2~500자까지 입력할 수 있습니다.</p>
            <label className="admin-claim-contact__check"><input type="checkbox" checked={draft.customerConfirmed} onChange={event => patch({ customerConfirmed: event.target.checked })} />고객과 변경 내용을 확인했습니다.</label>
            <label className="admin-claim-contact__check"><input type="checkbox" checked={draft.handoffConfirmed} onChange={event => patch({ handoffConfirmed: event.target.checked })} />{context.target === 'collection' ? '택배사 수거가 시작되지 않은 것을 확인했습니다.' : '교환품을 아직 발송하지 않은 것을 확인했습니다.'}</label>
          </> : <>
            {reshipItems.map(item => <label key={item.id}>{item.name} · {item.qty}개 재출고 상품<select required value={draft.items[item.id] ?? ''} onChange={event => patch({ items: { ...draft.items, [item.id]: event.target.value } })}>
              <option value="" disabled>재출고할 상품 선택</option>{item.options.map(option => <option key={option.id} value={option.id}>{option.goodName ? `${option.goodName} · ` : ''}{option.name} · {option.code} · 재고 {option.stockQty}개</option>)}
            </select></label>)}
            <label>택배사<select required value={draft.carrier} onChange={event => patch({ carrier: event.target.value })}><option value="" disabled>택배사 선택</option>{carriers.filter(carrier => carrier.active).map(carrier => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}</select></label>
            <label>재출고 운송장번호<input autoComplete="off" required value={draft.trackingNumber} onChange={event => patch({ trackingNumber: event.target.value })} placeholder="영문과 숫자 8~30자" /></label>
            <label className="admin-claim-contact__check"><input type="checkbox" checked={draft.destinationConfirmed} onChange={event => patch({ destinationConfirmed: event.target.checked })} />표시된 최종 주소가 실제 발송할 주소와 같습니다.</label>
            <label className="admin-claim-contact__check"><input type="checkbox" checked={draft.dispatchConfirmed} onChange={event => patch({ dispatchConfirmed: event.target.checked })} />전체 수량과 실제 발송 정보를 확인했습니다.</label>
            <p>회수한 상품의 재고를 복원하고 선택한 상품으로 전체 수량을 재출고합니다. 결제금액과 카드팩은 유지됩니다.</p>
          </>}
        </fieldset>
        {!recovery ? <button className="btn btn-sm" disabled={locked} type="submit">{context.command === 'change' ? '연락처 수정 저장' : '재출고 등록하고 교환 종결'}</button> : null}
      </form> : null}
      <button className="btn btn-sm btn-ghost" type="button" onClick={closePrivate}>연락처 닫기</button>
    </div> : null}
    {recovery ? <div className="admin-claim-contact__recovery">
      <p role="alert">{targetLabel(recovery.target)} {recovery.command === 'reshipment' ? '재출고' : '연락처 수정'} 요청의 결과를 먼저 확인해주세요. 주소 원문 없이 요청번호만 이 탭에 보관합니다.</p>
      <p>요청 시각 {formatOrderDateTime(recovery.startedAt)}</p>
      <div className="admin-claim-contact__buttons">
        <button className="btn btn-sm" type="button" disabled={pending} onClick={() => { void check(); }}>저장 결과 확인</button>
        {canRetry ? <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void save(true); }}>같은 내용으로 다시 요청</button> : null}
        <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void check(true); }}>미처리 요청 종료</button>
      </div>
    </div> : null}
    {pending ? <p role="status">처리 결과를 확인하고 있습니다.</p> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}

export function ClaimContactOperations({ actorId, ...props }: Props) {
  return <ClaimContactSession actorId={actorId}>{(identity, scope) => <ClaimContactOperationPanel key={`${props.orderId}:${props.claimId}:${identity.sessionId}`} {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
