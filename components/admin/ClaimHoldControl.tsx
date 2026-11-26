'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimHoldAction, loadClaimHoldContextAction, readClaimHoldAction } from '@/app/admin/claim-hold-actions';
import {
  CLAIM_HOLD_LABELS, CLAIM_HOLD_NOTE_ERROR, CLAIM_HOLD_NOTE_MAX, CLAIM_HOLD_NOTE_MIN, claimHoldConfirmMessage, claimHoldReceiptMatches, normalizeClaimHoldRequest,
  type ClaimHoldContext, type ClaimHoldReceipt, type ClaimHoldRequest,
} from '@/lib/orders/claim-hold';
import {
  CLAIM_CHANGE_BACK_LABEL, CLAIM_CHANGE_CHECK_LABEL, CLAIM_CHANGE_LOAD_FAILED_MESSAGE, CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE, CLAIM_CHANGE_NOT_SAVED_MESSAGE,
  CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE, CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE, CLAIM_CHANGE_RELOAD_LABEL, CLAIM_CHANGE_RESEND_LABEL, CLAIM_CHANGE_UNKNOWN_MESSAGE,
  claimChangeCount,
} from '@/lib/admin/claim-change-copy';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { adminConfirm } from '@/lib/admin/confirm';
import { ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS, type OrderClaimType } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다.
   [보류하기]·[보류 풀기]는 누르면 확인창이 한 번 뜬다(고객 앱 알림이 가고 처리가 멈추거나 이어진다). 확인 체크 칸은 없다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const HINT = 'text-xs text-muted-foreground';

export function ClaimHoldPanel({ initial, onClose }: { initial: ClaimHoldContext; onClose: () => void }) {
  const router = useRouter();
  const [context, setContext] = useState(initial);
  const [note, setNote] = useState('');
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
  const labels = CLAIM_HOLD_LABELS[decision];
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[context.claimType];
  const available = context.canHold || context.canResume;
  const locked = pending || uncertain || Boolean(receipt);
  const editable = () => !inFlight.current && !dispatched.current && !receipt;
  const noteId = `claim-hold-note-${context.claimId}`;

  function accept(saved: ClaimHoldReceipt, request: ClaimHoldRequest) {
    if (!claimHoldReceiptMatches(saved, request) || saved.orderId !== context.orderId) {
      setUncertain(true); setError(CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE);
      return;
    }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    setNote(''); router.refresh();
  }

  async function save() {
    if (inFlight.current || receipt || !available || conflict && !uncertain) return;
    const retry = dispatched.current;
    /* 확인창을 거치면 확인한 것이다. `confirmed`는 저장되지 않고 요청 모양만 지킨다(DB 함수에는 보내지 않는다). */
    const request = normalizeClaimHoldRequest(retry ?? {
      id: crypto.randomUUID(), actorId: context.actorId, claimId: context.claimId,
      claimType: context.claimType, revision: context.revision, decision,
      note: decision === 'hold' ? note : null, confirmed: true,
    });
    if (!request) { setError(CLAIM_HOLD_NOTE_ERROR); return; }
    const wasUncertain = uncertain; inFlight.current = true;
    if (!retry) {
      /* 같은 요청을 다시 보내는 경우(응답 유실)는 이미 확인한 내용이라 다시 묻지 않는다. */
      let ok = false;
      try {
        ok = await adminConfirm({
          title: `${typeLabel} ${labels.title}`, confirmLabel: labels.action, cancelLabel: CLAIM_CHANGE_BACK_LABEL,
          message: claimHoldConfirmMessage({
            decision, typeLabel, stageLabel: adminClaimStageLabel(context.claimType, context.stage),
            resumeLabel: adminClaimStageLabel(context.claimType, context.heldFrom ?? 'requested'), note: request.note,
          }),
        });
      } catch { ok = false; }
      if (!ok) { inFlight.current = false; return; }
    }
    dispatched.current = request; setPending(true); setError(''); setMessage('');
    try {
      const result = await changeClaimHoldAction(request);
      if ('error' in result) {
        const keep = wasUncertain || Boolean(result.uncertain);
        setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error);
        if (!keep) dispatched.current = null;
      } else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
    } catch { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
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
      else setMessage(CLAIM_CHANGE_NOT_SAVED_MESSAGE);
    } catch { setError(CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE); }
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
        setContext(result.context); setConflict(false);
        if (changedType || changedActor) setNote('');
        setMessage(changedType || changedActor
          ? '요청 유형이나 로그인 계정이 바뀌어 적은 내용을 지웠습니다. 지금 요청을 확인하고 다시 적어 주세요.'
          : `최신 상태를 불러왔습니다. 적은 내용은 그대로 있습니다. 바뀐 상태를 확인한 뒤 [${CLAIM_HOLD_LABELS[result.context.canResume ? 'resume' : 'hold'].action}]를 다시 눌러 주세요.`);
        if (changedType) {
          router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`);
          router.refresh();
        }
      } else setError(CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE);
    } catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label="요청 보류 및 해제" data-claim-panel="hold">
    <h4 className="text-base leading-snug font-medium">{typeLabel} {labels.title}</h4>
    {!receipt ? <p>현재 상태: {adminClaimStageLabel(context.claimType, context.stage)}</p> : null}
    {context.holdReason ? <p>기존 보류 사유: {context.holdReason}</p> : null}
    {receipt ? <p role="status">{receipt.decision === 'hold' ? '보류했습니다. 고객에게 앱 알림을 남겼습니다.' : '보류를 풀었습니다. 고객에게 앱 알림을 남겼습니다.'} 지금 상태: {adminClaimStageLabel(context.claimType, receipt.stage)} · {formatOrderDateTime(receipt.createdAt)}</p>
      : !available ? <p className="text-muted-foreground" role="status">끝난 요청은 보류하거나 보류를 풀 수 없습니다.</p>
        : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
            <legend className="sr-only">{labels.title}</legend>
            {decision === 'hold' ? <div className={FIELD}>
              <label className="font-medium" htmlFor={noteId}>보류 사유 (필수)</label>
              <input aria-describedby={`${noteId}-hint`} className="w-full" id={noteId} maxLength={CLAIM_HOLD_NOTE_MAX} minLength={CLAIM_HOLD_NOTE_MIN} placeholder="예: 상품 상태를 확인하는 동안 처리를 잠시 보류합니다." required
                value={note} onChange={event => { if (editable()) setNote(event.target.value); }} />
              <small className={HINT} id={`${noteId}-hint`}>{claimChangeCount(note.length, CLAIM_HOLD_NOTE_MIN, CLAIM_HOLD_NOTE_MAX)} · 고객 앱 알림에 담겨 가고, 요청 상세의 ‘보류 사유’에 남습니다.</small>
            </div> : <p>보류 전 단계({adminClaimStageLabel(context.claimType, context.heldFrom ?? 'requested')})로 돌아갑니다. 환불·재출고는 돌아간 단계에서 따로 처리합니다.</p>}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {uncertain ? <>
              <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void readback(); }}>{CLAIM_CHANGE_CHECK_LABEL}</button>
              <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(); }}>{CLAIM_CHANGE_RESEND_LABEL}</button>
            </> : conflict ? <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void reload(); }}>{CLAIM_CHANGE_RELOAD_LABEL}</button>
              : <button className={PRIMARY} data-slot="button" type="submit" disabled={pending}>{pending ? '처리 중…' : labels.action}</button>}
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
      else setError(CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE);
    } catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); }
    finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimHoldPanel initial={context} onClose={() => setContext(null)} />
    : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="hold">
      <button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void open(); }}>
        {pending ? '요청 확인 중…' : `${ORDER_CLAIM_TYPE_LABELS[claimType]} ${CLAIM_HOLD_LABELS[held ? 'resume' : 'hold'].title}`}
      </button>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>;
}
