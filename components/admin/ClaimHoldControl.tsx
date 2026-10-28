'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimHoldAction, loadClaimHoldContextAction, readClaimHoldAction } from '@/app/admin/claim-hold-actions';
import {
  claimHoldReceiptMatches, normalizeClaimHoldRequest,
  type ClaimHoldContext, type ClaimHoldReceipt, type ClaimHoldRequest,
} from '@/lib/orders/claim-hold';
import { ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS, type OrderClaimType } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';

export function ClaimHoldPanel({ initial, onClose }: { initial: ClaimHoldContext; onClose: () => void }) {
  const router = useRouter();
  const [context, setContext] = useState(initial);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<ClaimHoldReceipt | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimHoldRequest | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const decision = context.canResume ? 'resume' : 'hold';
  const decisionLabel = decision === 'hold' ? '보류 설정' : '보류 해제';
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[context.claimType];
  const available = context.canHold || context.canResume;
  const locked = pending || uncertain || Boolean(receipt);
  const editable = () => !inFlight.current && !dispatched.current && !receipt;

  function accept(saved: ClaimHoldReceipt, request: ClaimHoldRequest) {
    if (!claimHoldReceiptMatches(saved, request) || saved.orderId !== context.orderId) {
      setUncertain(true); setError('현재 요청과 다른 저장 결과입니다. 같은 요청의 결과를 다시 확인해주세요.');
      return;
    }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    setNote(''); setConfirmed(false); router.refresh();
  }

  async function save() {
    if (inFlight.current || receipt || !available || conflict && !uncertain) return;
    const request = normalizeClaimHoldRequest(dispatched.current ?? {
      id: crypto.randomUUID(), actorId: context.actorId, claimId: context.claimId,
      claimType: context.claimType, revision: context.revision, decision,
      note: decision === 'hold' ? note : null, confirmed,
    });
    if (!request) { setError('보류 사유는 10~200자로 입력하고 현재 요청의 처리 내용을 확인해주세요.'); return; }
    const wasUncertain = uncertain;
    dispatched.current = request; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await changeClaimHoldAction(request);
      if ('error' in result) {
        const keep = wasUncertain || Boolean(result.uncertain);
        setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error);
        if (!keep) dispatched.current = null;
      } else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  async function readback() {
    const request = dispatched.current;
    if (!request || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await readClaimHoldAction(request.id);
      if ('error' in result) setError(result.error);
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage('확인된 저장 결과가 없습니다. 같은 내용으로 재시도할 수 있습니다.');
    } catch { setError('결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  async function reload() {
    if (inFlight.current || dispatched.current) return;
    inFlight.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimHoldContextAction(context.claimId);
      if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === context.claimId && result.context.orderId === context.orderId) {
        const changedType = result.context.claimType !== context.claimType;
        const changedActor = result.context.actorId !== context.actorId;
        setContext(result.context); setConflict(false); setConfirmed(false);
        if (changedType || changedActor) setNote('');
        setMessage(changedType || changedActor
          ? '요청 유형 또는 계정이 바뀌어 이전 입력과 확인을 초기화했습니다. 현재 요청을 다시 확인해주세요.'
          : '최신 상태를 읽었습니다. 입력은 보존했으며 처리 내용을 다시 확인해주세요.');
        if (changedType) {
          router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`);
          router.refresh();
        }
      } else setError('현재 요청의 상태를 읽지 못했습니다.');
    } catch { setError('최신 요청을 읽지 못했습니다.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <section className="claim-withdrawal" aria-label="요청 보류 및 해제">
    <h4>{typeLabel} {decisionLabel}</h4>
    {!receipt ? <p>현재 상태: {ORDER_CLAIM_STAGE_LABELS[context.stage]}. 주문 전체의 요청을 처리합니다.</p> : null}
    {context.holdReason ? <p>기존 보류 사유: {context.holdReason}</p> : null}
    {receipt ? <p role="status">{receipt.decision === 'hold' ? '보류를 설정했습니다.' : '보류를 해제했습니다.'} 현재 처리 결과: {ORDER_CLAIM_STAGE_LABELS[receipt.stage]} · {formatOrderDateTime(receipt.createdAt)}</p>
      : !available ? <p role="status">이미 종결된 요청은 보류하거나 보류를 해제할 수 없습니다.</p>
        : <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={locked}>
            <legend>{decisionLabel} 확인</legend>
            {decision === 'hold' ? <label>보류 사유 (10~200자, 구매자에게 전달됩니다)
              <input value={note} minLength={10} maxLength={200} required onChange={event => { if (editable()) setNote(event.target.value); }} />
            </label> : <p>보류 전 단계인 {ORDER_CLAIM_STAGE_LABELS[context.heldFrom ?? 'requested']}로 돌아갑니다. 환불·재출고는 해당 단계에서 별도로 확인합니다.</p>}
            <label className="claim-withdrawal__agreement"><input type="checkbox" checked={confirmed} required onChange={event => { if (editable()) setConfirmed(event.target.checked); }} />현재 {typeLabel} 요청의 {decisionLabel} 내용을 확인했습니다.</label>
          </fieldset>
          <div className="claim-withdrawal__actions">
            {uncertain ? <>
              <button className="btn" type="button" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</button>
              <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</button>
            </> : conflict ? <button className="btn" type="button" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</button>
              : <button className="btn" type="submit" disabled={pending || !confirmed}>{pending ? '처리 중…' : `${decisionLabel} 확정`}</button>}
          </div>
        </form>}
    {error ? <p role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <button className="btn btn-ghost" type="button" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</button>
  </section>;
}

export function ClaimHoldControl({ claimId, claimType, held }: { claimId: string; claimType: OrderClaimType; held: boolean }) {
  const [context, setContext] = useState<ClaimHoldContext | null>(null);
  const [pending, setPending] = useState(false);
  useClaimPreviewBusy(pending);
  const [error, setError] = useState('');
  const loading = useRef(false);
  async function open() {
    if (loading.current) return;
    loading.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimHoldContextAction(claimId);
      if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === claimId) setContext(result.context);
      else setError('현재 요청의 상태를 읽지 못했습니다.');
    } catch { setError('최신 요청을 읽지 못했습니다.'); }
    finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimHoldPanel initial={context} onClose={() => setContext(null)} />
    : <div className="claim-withdrawal-entry">
      <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void open(); }}>
        {pending ? '요청 확인 중…' : `${ORDER_CLAIM_TYPE_LABELS[claimType]} ${held ? '보류 해제' : '보류 설정'}`}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>;
}
