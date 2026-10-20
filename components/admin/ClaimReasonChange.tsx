'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimReasonAction, loadClaimReasonContextAction, readClaimReasonChangeAction } from '@/app/admin/claim-reason-change-actions';
import { claimReasonError, claimReasonReceiptMatches, normalizeClaimReasonRequest, type ClaimReasonContext, type ClaimReasonReceipt, type ClaimReasonRequest } from '@/lib/orders/claim-reason-change';
import { formatOrderDateTime, ORDER_WITHDRAWAL_REASON_LABELS, ORDER_WITHDRAWAL_REASON_TYPES, type OrderWithdrawalReasonType } from '@/lib/orders';
import { ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';

export function ClaimReasonChangePanel({ initial, onClose }: { initial: ClaimReasonContext; onClose: () => void }) {
  const router = useRouter(); const [context, setContext] = useState(initial);
  const [reasonType, setReasonType] = useState(initial.reasonType); const [reason, setReason] = useState(initial.reason);
  const [agreement, setAgreement] = useState(''); const [confirmed, setConfirmed] = useState(false); const [feeReviewed, setFeeReviewed] = useState(false);
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<ClaimReasonReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimReasonRequest | null>(null); const inFlight = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const locked = pending || uncertain || Boolean(receipt); const editable = () => !inFlight.current && !dispatched.current && !receipt;
  function accept(saved: ClaimReasonReceipt, request: ClaimReasonRequest) {
    if (!claimReasonReceiptMatches(saved, request) || saved.orderId !== context.orderId || saved.fromReasonType !== context.reasonType || saved.fromReason !== context.reason) {
      setError('현재 요청과 다른 저장 결과입니다. 같은 요청의 결과를 다시 확인해주세요.'); setUncertain(true); return;
    }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    if (saved.changed) router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || conflict && !uncertain) return;
    const request = normalizeClaimReasonRequest(dispatched.current ?? { id: crypto.randomUUID(), actorId: context.actorId, claimId: context.claimId,
      revision: context.revision, reasonType, reason, agreement, confirmed, feeReviewed });
    if (!request) { setError(claimReasonError(undefined, 'invalid_claim_reason_change')); return; }
    if (context.fee && !request.feeReviewed) { setError(claimReasonError(undefined, 'claim_reason_fee_review_required')); return; }
    const wasUncertain = uncertain; dispatched.current = request; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await changeClaimReasonAction(request);
      if ('error' in result) {
        const keep = wasUncertain || Boolean(result.uncertain); setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error);
        if (!keep) dispatched.current = null;
      } else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await readClaimReasonChangeAction(request.id);
      if ('error' in result) setError(result.error);
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage('확인된 저장 결과가 없습니다. 입력을 고정한 채 같은 요청을 재시도할 수 있습니다.');
    } catch { setError('결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reload() {
    if (inFlight.current || dispatched.current) return; inFlight.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimReasonContextAction(context.claimId);
      if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === context.claimId && result.context.orderId === context.orderId) {
        const changedActor = context.actorId !== result.context.actorId;
        const changedType = context.claimType !== result.context.claimType;
        setContext(result.context); setConflict(false); setConfirmed(false); setFeeReviewed(false);
        if (changedActor || changedType) { setReasonType(result.context.reasonType); setReason(result.context.reason); setAgreement(''); }
        setMessage(changedActor || changedType ? '계정 또는 요청 유형이 바뀌어 입력과 확인을 초기화했습니다.' : '최신 요청을 읽었습니다. 보존된 입력과 현재 사유·비용을 다시 확인해주세요.');
        if (changedType) { router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`); router.refresh(); }
      } else setError('현재 요청의 상태를 읽지 못했습니다.');
    } catch { setError('최신 요청을 읽지 못했습니다.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section className="claim-withdrawal" aria-label="교환 사유 정정">
    <h3>교환 사유 정정</h3>
    <p>원래 접수일 {formatOrderDateTime(context.requestedAt)} · 최초 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[context.originalReasonType])} / {context.originalReason}</p>
    <p>현재 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[receipt?.toReasonType ?? context.reasonType])} / {receipt?.toReason ?? context.reason}</p>
    <p>고객과 확인한 실제 사유를 기록합니다. 최초 접수일과 수거·보류·비용 기록은 유지되며, 새 분류의 기한도 원래 접수일 기준입니다.</p>
    {context.fee ? <p>기존 비용: {context.fee.amount.toLocaleString('ko-KR')}원 · {context.fee.note} · {formatOrderDateTime(context.fee.confirmedAt)}</p> : null}
    {context.history.length ? <details><summary>사유 정정 이력 {context.history.length}건</summary><ol>{context.history.map(row => <li key={row.id}>
      <time dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.fromReasonType])} → {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.toReasonType])}
      <p>정정 전: {row.fromReason}</p><p>정정 후: {row.toReason}</p><p>내부 협의 근거: {row.agreement}</p>
    </li>)}</ol></details> : null}
    {receipt ? <p role="status">{receipt.changed ? '교환 사유를 정정하고 고객에게 앱 알림을 남겼습니다.' : '기존 사유와 설명이 같아 변경하지 않았습니다. 고객 알림을 추가하지 않았습니다.'}</p>
      : !context.allowed ? <p role="status">{claimReasonError(undefined, context.blocker ?? '')}</p>
        : <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={locked}><legend>정정 내용과 고객 협의</legend>
            <label>사유 분류<select value={reasonType} onChange={event => { if (editable()) setReasonType(event.target.value as OrderWithdrawalReasonType); }}>
              {ORDER_WITHDRAWAL_REASON_TYPES.map(type => <option key={type} value={type} disabled={type !== context.reasonType && !(type === 'defect' ? context.canUseDefect : context.canUseChangeOfMind)}>{adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[type])}</option>)}
            </select></label>
            {!context.canUseChangeOfMind || !context.canUseDefect ? <p>원래 접수일에 신청 기한을 지난 분류로는 바꿀 수 없습니다.</p> : null}
            <label>고객용 설명 (1~200자)<input value={reason} minLength={1} maxLength={400} required onChange={event => { if (editable()) setReason(event.target.value); }} /></label>
            <label>내부 고객 협의 근거 (2~500자)<input value={agreement} minLength={2} maxLength={1000} required placeholder="상담 일시, 참조번호와 협의한 내용을 적어주세요." onChange={event => { if (editable()) setAgreement(event.target.value); }} /></label>
            <p>협의 근거는 운영자에게만 보입니다. 고객에게는 정정된 분류와 고객용 설명이 안내됩니다.</p>
            <label className="claim-withdrawal__agreement"><input type="checkbox" checked={confirmed} required onChange={event => { if (editable()) setConfirmed(event.target.checked); }} />고객과 사유 정정 내용을 확인했습니다.</label>
            {context.fee ? <label className="claim-withdrawal__agreement"><input type="checkbox" checked={feeReviewed} required onChange={event => { if (editable()) setFeeReviewed(event.target.checked); }} />기존 비용 기록과 정정할 사유의 정합성을 확인했습니다. 비용 정정은 별도로 처리합니다.</label> : null}
          </fieldset>
          <div className="claim-withdrawal__actions">{uncertain ? <>
            <button className="btn" type="button" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</button>
            <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</button>
          </> : conflict ? <button className="btn" type="button" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</button>
            : <button className="btn" type="submit" disabled={pending || !confirmed || Boolean(context.fee && !feeReviewed)}>{pending ? '처리 중…' : '사유 정정 확정'}</button>}</div>
        </form>}
    {error ? <p role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <button className="btn btn-ghost" type="button" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</button>
  </section>;
}
export function ClaimReasonChange({ claimId }: { claimId: string }) {
  const [context, setContext] = useState<ClaimReasonContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  async function open() {
    if (loading.current) return; loading.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimReasonContextAction(claimId);
      if ('error' in result) setError(result.error); else if ('context' in result && result.context.claimId === claimId) setContext(result.context);
      else setError('현재 요청의 상태를 읽지 못했습니다.');
    } catch { setError('최신 요청을 읽지 못했습니다.'); } finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimReasonChangePanel initial={context} onClose={() => setContext(null)} />
    : <div className="claim-withdrawal-entry"><button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : '교환 사유 정정 및 이력'}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
