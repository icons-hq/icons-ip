'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimHoldAction, loadClaimHoldContextAction, readClaimHoldAction } from '@/app/admin/claim-hold-actions';
import {
  claimHoldReceiptMatches, normalizeClaimHoldRequest,
  type ClaimHoldContext, type ClaimHoldReceipt, type ClaimHoldRequest,
} from '@/lib/orders/claim-hold';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS, type OrderClaimType } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const CHECK = 'flex items-start gap-2 leading-relaxed';

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
      setUncertain(true); setError('불러온 저장 결과가 이 요청과 맞지 않습니다. [같은 요청 결과 확인]을 다시 누르고, 같은 안내가 반복되면 새로고침해 처리 이력을 확인해주세요.');
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
    if (!request) { setError('보류할 때는 보류 사유를 10~200자로 입력하고, 아래 확인 칸에 체크해주세요.'); return; }
    const wasUncertain = uncertain;
    dispatched.current = request; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await changeClaimHoldAction(request);
      if ('error' in result) {
        const keep = wasUncertain || Boolean(result.uncertain);
        setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error);
        if (!keep) dispatched.current = null;
      } else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장됐는지 확인하지 못했습니다. [같은 요청 결과 확인]을 눌러 먼저 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장됐는지 확인하지 못했습니다. [같은 요청 결과 확인]을 눌러 먼저 확인해주세요.'); }
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
      else setMessage('아직 저장된 결과가 없습니다. 입력한 내용 그대로 [같은 내용으로 재시도]를 누르면 됩니다(두 번 처리되지 않습니다).');
    } catch { setError('저장 결과를 불러오지 못했습니다. 잠시 뒤 [같은 요청 결과 확인]을 다시 눌러주세요.'); }
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
          ? '요청 유형이나 로그인 계정이 바뀌어 입력한 내용과 체크를 지웠습니다. 현재 요청을 확인하고 다시 입력해주세요.'
          : '최신 상태를 다시 불러왔습니다. 입력한 내용은 그대로 두었습니다. 처리 내용을 확인하고 확인 칸에 다시 체크해주세요.');
        if (changedType) {
          router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`);
          router.refresh();
        }
      } else setError('이 요청의 최신 상태를 불러오지 못했습니다. 새로고침한 뒤 다시 열어주세요.');
    } catch { setError('최신 요청을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label="요청 보류 및 해제" data-claim-panel="hold">
    <h4 className="text-base leading-snug font-medium">{typeLabel} {decisionLabel}</h4>
    {!receipt ? <p>현재 상태: {adminClaimStageLabel(context.claimType, context.stage)}. 주문 전체의 요청을 처리합니다.</p> : null}
    {context.holdReason ? <p>기존 보류 사유: {context.holdReason}</p> : null}
    {receipt ? <p role="status">{receipt.decision === 'hold' ? '보류를 설정했습니다.' : '보류를 해제했습니다.'} 현재 처리 결과: {adminClaimStageLabel(context.claimType, receipt.stage)} · {formatOrderDateTime(receipt.createdAt)}</p>
      : !available ? <p className="text-muted-foreground" role="status">이미 종결된 요청은 보류하거나 보류를 해제할 수 없습니다.</p>
        : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
            <legend className="mb-1 font-medium">{decisionLabel} 확인</legend>
            {decision === 'hold' ? <label className={FIELD}><span className="font-medium">보류 사유 (10~200자, 구매자에게 전달됩니다)</span>
              <input className="w-full" value={note} minLength={10} maxLength={200} required onChange={event => { if (editable()) setNote(event.target.value); }} />
            </label> : <p>보류 전 단계인 {adminClaimStageLabel(context.claimType, context.heldFrom ?? 'requested')}로 돌아갑니다. 환불·재출고는 해당 단계에서 별도로 확인합니다.</p>}
            <label className={CHECK}><input className="mt-0.5" type="checkbox" checked={confirmed} required onChange={event => { if (editable()) setConfirmed(event.target.checked); }} /><span>현재 {typeLabel} 요청의 {decisionLabel} 내용을 확인했습니다.</span></label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {uncertain ? <>
              <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</button>
              <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</button>
            </> : conflict ? <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</button>
              : <button className={PRIMARY} data-slot="button" type="submit" disabled={pending || !confirmed}>{pending ? '처리 중…' : `${decisionLabel} 확정`}</button>}
          </div>
        </form>}
    {error ? <p className="text-destructive outline-none" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}
    {message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</button>
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
      else setError('이 요청의 최신 상태를 불러오지 못했습니다. 새로고침한 뒤 다시 열어주세요.');
    } catch { setError('최신 요청을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.'); }
    finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimHoldPanel initial={context} onClose={() => setContext(null)} />
    : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="hold">
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void open(); }}>
        {pending ? '요청 확인 중…' : `${ORDER_CLAIM_TYPE_LABELS[claimType]} ${held ? '보류 해제' : '보류 설정'}`}
      </button>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>;
}
