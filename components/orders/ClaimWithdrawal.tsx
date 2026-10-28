'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadAdminClaimWithdrawalAction, readAdminClaimWithdrawalAction, submitAdminClaimWithdrawalAction } from '@/app/admin/claim-withdrawal-actions';
import { claimWithdrawalError, claimWithdrawalReceiptMatches, normalizeClaimWithdrawalRequest, parseClaimWithdrawalContext, parseClaimWithdrawalReceipt, type ClaimWithdrawalContext, type ClaimWithdrawalRequest, type ClaimWithdrawalReceipt, type ClaimWithdrawalResult } from '@/lib/orders/claim-withdrawal';
import { ORDER_CLAIM_TYPE_LABELS, type OrderClaimStage } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';

async function customerRequest(claimId: string, operation?: string, payload?: ClaimWithdrawalRequest): Promise<ClaimWithdrawalResult> {
  try {
    const response = await fetch(`/api/orders/claims/${claimId}/withdrawal${operation ? `?operation=${operation}` : ''}`, payload ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') throw new Error('invalid response');
    if ('error' in body && typeof body.error === 'string') return { error: body.error, uncertain: 'uncertain' in body && body.uncertain === true, conflict: 'conflict' in body && body.conflict === true };
    if (!response.ok) throw new Error('invalid response');
    if ('context' in body) { const context = parseClaimWithdrawalContext(body.context); if (context?.claimId === claimId) return { context }; }
    if ('receipt' in body) { if (body.receipt === null) return { receipt: null }; const receipt = parseClaimWithdrawalReceipt(body.receipt); if (receipt?.claimId === claimId) return { receipt }; }
    throw new Error('invalid response');
  } catch { return { error: '결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.', uncertain: true }; }
}
export function ClaimWithdrawalPanel({ initial, operator = false, onClose }: { initial: ClaimWithdrawalContext; operator?: boolean; onClose: () => void }) {
  const router = useRouter(); const [context, setContext] = useState(initial); const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<ClaimWithdrawalReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimWithdrawalRequest | null>(null); const inFlight = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const type = ORDER_CLAIM_TYPE_LABELS[context.claimType]; const locked = pending || uncertain || Boolean(receipt);
  const canEdit = () => !inFlight.current && !dispatched.current && !receipt;
  function close() { if (!inFlight.current && !dispatched.current) onClose(); }
  function accept(result: ClaimWithdrawalReceipt, request: ClaimWithdrawalRequest) {
    if (!claimWithdrawalReceiptMatches(result, request, operator) || result.orderId !== context.orderId) { setError('현재 요청과 다른 결과입니다. 같은 요청의 저장 결과를 다시 확인해주세요.'); setUncertain(true); return; }
    dispatched.current = null; setReceipt(result); setUncertain(false); setError(''); setMessage(''); router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || conflict && !uncertain) return;
    const request = normalizeClaimWithdrawalRequest(dispatched.current ?? { id: crypto.randomUUID(), claimId: context.claimId, revision: context.revision, reason, confirmed });
    if (!request) { setError('2~500자 사유와 요청 철회 동의를 확인해주세요.'); return; }
    const wasUncertain = uncertain; dispatched.current = request; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = operator ? await submitAdminClaimWithdrawalAction(request) : await customerRequest(context.claimId, undefined, request);
      if ('error' in result) { const keep = wasUncertain || Boolean(result.uncertain); setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error); if (!keep) dispatched.current = null; }
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = operator ? await readAdminClaimWithdrawalAction(request.id) : await customerRequest(context.claimId, request.id);
      if ('error' in result) setError(result.error);
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage('아직 확인된 결과가 없습니다. 입력은 고정한 채 같은 요청을 재시도할 수 있습니다.');
    } catch { setError('결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reload() {
    if (inFlight.current || dispatched.current) return; inFlight.current = true; setPending(true); setError('');
    try {
      const result = operator ? await loadAdminClaimWithdrawalAction(context.claimId) : await customerRequest(context.claimId);
      if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === context.claimId && result.context.orderId === context.orderId) { setContext(result.context); setConflict(false); setConfirmed(false); setMessage('최신 상태를 읽었습니다. 사유는 보존했으며 철회 동의를 다시 확인해주세요.'); }
      else setError('현재 요청의 상태를 읽지 못했습니다.');
    } catch { setError('최신 요청 상태를 읽지 못했습니다.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const saved = receipt ?? context.withdrawal;
  return <section className="claim-withdrawal" aria-label={`${type} 요청 철회`}>
    <h3>{type} 요청 철회{operator ? '·고객 동의 확인' : ''}</h3>
    <p>철회하면 {type} 처리를 종료합니다. 주문과 결제금액은 유지되며, 다시 신청할 때는 현재 주문 상태와 신청 기한을 확인합니다.</p>
    {saved ? <div role="status"><strong>{type} 요청이 철회됐습니다.</strong><p>{formatOrderDateTime(saved.createdAt)} · {saved.actorKind === 'operator' ? '담당자 대리 기록' : '고객 직접 신청'}</p><p>{saved.reason}</p></div>
      : !context.allowed ? <p role="status">{claimWithdrawalError(undefined, context.blocker ?? '')}</p>
      : <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked}><legend>철회 사유와 확인</legend>
          <label>철회 사유<input value={reason} maxLength={500} minLength={2} required placeholder={operator ? '고객 요청과 상담 참조번호를 적어주세요.' : '요청을 철회하는 사유를 적어주세요.'} onChange={event => { if (canEdit()) setReason(event.target.value); }} /></label>
          <label className="claim-withdrawal__agreement"><input type="checkbox" checked={confirmed} required onChange={event => { if (canEdit()) setConfirmed(event.target.checked); }} />{operator ? '고객과 철회에 합의했으며, 반송 중인 굿즈가 없음을 확인했습니다.' : '요청 철회에 동의하며, 반송 중인 굿즈가 없습니다.'}</label>
        </fieldset>
        <div className="claim-withdrawal__actions">{uncertain ? <><button type="button" className="btn" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</button><button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</button></>
          : conflict ? <button type="button" className="btn" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</button>
            : <button type="submit" className="btn" disabled={pending || !confirmed}>{pending ? '처리 중…' : `${type} 요청 철회 확정`}</button>}</div>
      </form>}
    {error ? <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <button className="btn btn-ghost" type="button" disabled={pending || uncertain} onClick={close}>닫기</button>
  </section>;
}
export function ClaimWithdrawal({ claimId, stage, operator = false }: { claimId: string; stage: OrderClaimStage; operator?: boolean }) {
  const [context, setContext] = useState<ClaimWithdrawalContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  if (!['requested', 'in_review', 'collecting', 'on_hold', 'withdrawn'].includes(stage)) return null;
  /* 철회는 구매자 몫이다(10/27 회의 R7, 스마트스토어 기준). 운영자 화면은 철회 이력만 본다. */
  if (operator && stage !== 'withdrawn') return null;
  async function open() {
    if (loading.current) return; loading.current = true; setPending(true); setError('');
    try { const result = operator ? await loadAdminClaimWithdrawalAction(claimId) : await customerRequest(claimId); if ('error' in result) setError(result.error); else if ('context' in result) setContext(result.context); }
    catch { setError('최신 요청 상태를 읽지 못했습니다.'); } finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimWithdrawalPanel key={claimId} initial={context} operator={operator} onClose={() => setContext(null)} /> : <div className="claim-withdrawal-entry"><button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : stage === 'withdrawn' ? '요청 철회 이력' : '요청 철회하기'}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
