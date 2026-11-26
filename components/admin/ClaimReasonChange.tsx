'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimReasonAction, loadClaimReasonContextAction, readClaimReasonChangeAction } from '@/app/admin/claim-reason-change-actions';
import {
  CLAIM_REASON_AGREEMENT_MAX, CLAIM_REASON_AGREEMENT_MIN, CLAIM_REASON_INPUT_ERROR, CLAIM_REASON_TEXT_MAX,
  claimReasonBlockedMessage, claimReasonConfirmMessage, claimReasonError, claimReasonReceiptMatches, claimReasonReturnFeeNote, claimReasonSavedMessage, normalizeClaimReasonRequest,
  type ClaimReasonContext, type ClaimReasonReceipt, type ClaimReasonRequest,
} from '@/lib/orders/claim-reason-change';
import {
  CLAIM_CHANGE_BACK_LABEL, CLAIM_CHANGE_CHECK_LABEL, CLAIM_CHANGE_LOAD_FAILED_MESSAGE, CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE, CLAIM_CHANGE_NOT_SAVED_MESSAGE,
  CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE, CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE, CLAIM_CHANGE_RELOAD_LABEL, CLAIM_CHANGE_RESEND_LABEL, CLAIM_CHANGE_UNKNOWN_MESSAGE,
  claimChangeCount,
} from '@/lib/admin/claim-change-copy';
import { formatOrderDateTime, ORDER_WITHDRAWAL_REASON_LABELS, ORDER_WITHDRAWAL_REASON_TYPES, type OrderWithdrawalReasonType } from '@/lib/orders';
import { ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS, type OrderClaimType } from '@/lib/orders/claims';
import { adminConfirm } from '@/lib/admin/confirm';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { krw } from '@/lib/format';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';

/* 템플릿 룩(ADR-0028). 칸·버튼은 kit 부품이다. 반품·교환 모두 같은 패널이고(반품은 2026-11-25 CLM-029), 확인은 저장 순간 확인창 한 번이다. */
const FIELD = 'flex min-w-0 flex-col items-start gap-1.5';
const HINT = 'text-xs text-muted-foreground';
const ACTION_LABEL = '사유 고치기';

function claimKind(claimType: OrderClaimType) {
  return ORDER_CLAIM_TYPE_LABELS[claimType];
}

export function ClaimReasonChangePanel({ initial, onClose }: { initial: ClaimReasonContext; onClose: () => void }) {
  const router = useRouter(); const [context, setContext] = useState(initial);
  const [reasonType, setReasonType] = useState(initial.reasonType); const [reason, setReason] = useState(initial.reason);
  const [agreement, setAgreement] = useState('');
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [receipt, setReceipt] = useState<ClaimReasonReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimReasonRequest | null>(null); const inFlight = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const kind = claimKind(context.claimType);
  const locked = pending || uncertain || Boolean(receipt); const editable = () => !inFlight.current && !dispatched.current && !receipt;
  const returnFeeNote = context.claimType === 'return' ? claimReasonReturnFeeNote(context) : null;
  const reasonId = `claim-reason-text-${context.claimId}`; const agreementId = `claim-reason-agreement-${context.claimId}`;
  function accept(saved: ClaimReasonReceipt, request: ClaimReasonRequest) {
    if (!claimReasonReceiptMatches(saved, request) || saved.orderId !== context.orderId || saved.fromReasonType !== context.reasonType || saved.fromReason !== context.reason) {
      setError(CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE); setUncertain(true); return;
    }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    if (saved.changed) router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || conflict && !uncertain) return;
    const retry = dispatched.current;
    /* 기존 운영 확인액이 있으면 확인창이 그 금액을 함께 묻는다 — 확인하면 비용 기록을 확인한 것이다. */
    const request = normalizeClaimReasonRequest(retry ?? { id: crypto.randomUUID(), actorId: context.actorId, claimId: context.claimId,
      revision: context.revision, reasonType, reason, agreement, confirmed: true, feeReviewed: Boolean(context.fee) });
    if (!request) { setError(CLAIM_REASON_INPUT_ERROR); return; }
    const wasUncertain = uncertain; inFlight.current = true;
    if (!retry) {
      /* 같은 요청의 재시도(응답 유실)는 이미 확인한 내용이라 다시 묻지 않는다. */
      let ok = false;
      try { ok = await adminConfirm({ title: `${kind} 사유 정정`, message: claimReasonConfirmMessage(context, request), confirmLabel: ACTION_LABEL, cancelLabel: CLAIM_CHANGE_BACK_LABEL }); }
      catch { ok = false; }
      if (!ok) { inFlight.current = false; return; }
    }
    dispatched.current = request; setPending(true); setError(''); setMessage('');
    try {
      const result = await changeClaimReasonAction(request);
      if ('error' in result) {
        const keep = wasUncertain || Boolean(result.uncertain); setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error);
        if (!keep) dispatched.current = null;
      } else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
    } catch { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await readClaimReasonChangeAction(request.id);
      if ('error' in result) setError(result.error);
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage(CLAIM_CHANGE_NOT_SAVED_MESSAGE);
    } catch { setError(CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE); }
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
        setContext(result.context); setConflict(false);
        if (changedActor || changedType) { setReasonType(result.context.reasonType); setReason(result.context.reason); setAgreement(''); }
        setMessage(changedActor || changedType ? '로그인 계정이나 요청 유형이 바뀌어 적은 내용을 지웠습니다. 다시 적어 주세요.' : `최신 상태를 불러왔습니다. 적은 내용은 그대로 있습니다. 바뀐 사유와 비용을 확인한 뒤 [${ACTION_LABEL}]를 다시 눌러 주세요.`);
        if (changedType) { router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`); router.refresh(); }
      } else setError(CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE);
    } catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label={`${kind} 사유 정정`} data-claim-panel="reason-change">
    <h3 className="text-base leading-snug font-medium">{kind} 사유 정정</h3>
    <p>원래 접수일 {formatOrderDateTime(context.requestedAt)} · 최초 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[context.originalReasonType])} / {context.originalReason}</p>
    <p>현재 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[receipt?.toReasonType ?? context.reasonType])} / {receipt?.toReason ?? context.reason}</p>
    {context.allowed && !receipt ? <p className="text-muted-foreground">접수일과 보류는 그대로이고, 새 사유의 신청 기한도 원래 접수일로 따집니다.</p> : null}
    {returnFeeNote && context.allowed && !receipt ? <p data-claim-reason-return-fee="">{returnFeeNote}</p> : null}
    {context.returnFee?.feeInvoiceOpen && context.allowed && !receipt ? <p className="text-muted-foreground">이 요청에 배송비 청구가 있습니다. 사유를 바꾸면 그 청구가 취소되고, 입금 확인된 청구는 돌려줄 금액으로 바뀝니다.</p> : null}
    {context.fee ? <p>기존 비용: {krw(context.fee.amount)} · {context.fee.note} · {formatOrderDateTime(context.fee.confirmedAt)}</p> : null}
    {context.history.length ? <details className="rounded-lg border bg-background px-3 py-2"><summary className="cursor-pointer font-medium">사유 정정 이력 {context.history.length}건</summary><ol className="mt-2 flex flex-col gap-2 border-l pl-4">{context.history.map(row => <li key={row.id}>
      <time className="text-muted-foreground tabular-nums" dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.fromReasonType])} → {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.toReasonType])}
      <p>정정 전: {row.fromReason}</p><p>정정 후: {row.toReason}</p><p className="text-muted-foreground">정정 사유: {row.agreement}</p>
    </li>)}</ol></details> : null}
    {receipt ? <p role="status">{claimReasonSavedMessage(receipt)}</p>
      : !context.allowed ? <p className="text-muted-foreground" role="status">{claimReasonBlockedMessage(context)}</p>
        : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}><legend className="sr-only">사유 정정</legend>
            <div className={FIELD}><Label htmlFor={`claim-reason-type-${context.claimId}`}>사유 분류</Label>
              <NativeSelect className="w-full sm:w-64" id={`claim-reason-type-${context.claimId}`} value={reasonType} onChange={event => { if (editable()) setReasonType(event.target.value as OrderWithdrawalReasonType); }}>
                {ORDER_WITHDRAWAL_REASON_TYPES.map(type => <NativeSelectOption key={type} value={type} disabled={type !== context.reasonType && !(type === 'defect' ? context.canUseDefect : context.canUseChangeOfMind)}>{adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[type])}</NativeSelectOption>)}
              </NativeSelect></div>
            {!context.canUseChangeOfMind || !context.canUseDefect ? <p className="text-muted-foreground">원래 접수일 기준으로 신청 기한이 지난 분류는 고를 수 없습니다.</p> : null}
            <div className={FIELD}><Label htmlFor={reasonId}>고객용 설명 (필수)</Label>
              <Input aria-describedby={`${reasonId}-hint`} id={reasonId} value={reason} minLength={1} maxLength={CLAIM_REASON_TEXT_MAX} required placeholder="예: 받으신 상품에 흠집이 있어 하자로 정정합니다." onChange={event => { if (editable()) setReason(event.target.value); }} />
              <small className={HINT} id={`${reasonId}-hint`}>{claimChangeCount([...reason].length, 1, CLAIM_REASON_TEXT_MAX)} · 고객 주문 상세와 앱 알림에 그대로 보입니다.</small></div>
            <div className={FIELD}><Label htmlFor={agreementId}>정정 사유 (필수)</Label>
              <Input aria-describedby={`${agreementId}-hint`} id={agreementId} value={agreement} minLength={CLAIM_REASON_AGREEMENT_MIN} maxLength={CLAIM_REASON_AGREEMENT_MAX} required placeholder="예: 11/25 상담(문의 번호) 사진으로 하자 확인, 고객과 하자 반품으로 정정 합의" onChange={event => { if (editable()) setAgreement(event.target.value); }} />
              <small className={HINT} id={`${agreementId}-hint`}>{claimChangeCount([...agreement].length, CLAIM_REASON_AGREEMENT_MIN, CLAIM_REASON_AGREEMENT_MAX)} · 고객과 협의한 내용입니다. 운영자만 보는 정정 이력에 남고 고객에게는 보이지 않습니다.</small></div>
          </fieldset>
          <div className="flex flex-wrap gap-2">{uncertain ? <>
            <Button size="sm" disabled={pending} onClick={() => { void readback(); }}>{CLAIM_CHANGE_CHECK_LABEL}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { void save(); }}>{CLAIM_CHANGE_RESEND_LABEL}</Button>
          </> : conflict ? <Button size="sm" disabled={pending} onClick={() => { void reload(); }}>{CLAIM_CHANGE_RELOAD_LABEL}</Button>
            : <Button size="sm" type="submit" disabled={pending}>{pending ? '처리 중…' : ACTION_LABEL}</Button>}</div>
        </form>}
    {error ? <p className="text-destructive outline-none" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    <Button className="w-fit" size="sm" variant="outline" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</Button>
  </section>;
}

/** 진입 칸이 미리 읽어 두는 값. 지금 고칠 수 있는지와, 고칠 수 없는 이유만 쓴다. */
interface ReasonPeek { allowed: boolean; blocker: string | null }

export function ClaimReasonChange({ claimId, claimType = 'exchange' }: { claimId: string; claimType?: OrderClaimType }) {
  const [context, setContext] = useState<ClaimReasonContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  const [peek, setPeek] = useState<ReasonPeek | null>(null);
  useClaimPreviewBusy(pending);
  const panelOpen = context !== null;
  /* 못 고치는 단계는 눌러 보기 전에 알린다: 버튼은 이력만 여는 이름이 되고 이유가 아래에 보인다. 읽지 못하면 그대로 두고 눌렀을 때 읽는다. 창을 닫으면 다시 읽는다. */
  useEffect(() => {
    if (panelOpen) return undefined;
    let alive = true;
    loadClaimReasonContextAction(claimId).then(
      result => { if (alive && 'context' in result) setPeek({ allowed: result.context.allowed, blocker: result.context.blocker }); },
      () => {},
    );
    return () => { alive = false; };
  }, [claimId, panelOpen]);
  async function open() {
    if (loading.current) return; loading.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimReasonContextAction(claimId);
      if ('error' in result) setError(result.error); else if ('context' in result && result.context.claimId === claimId) setContext(result.context);
      else setError(CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE);
    } catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); } finally { loading.current = false; setPending(false); }
  }
  const blocked = peek !== null && !peek.allowed;
  return context ? <ClaimReasonChangePanel initial={context} onClose={() => setContext(null)} />
    : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="reason-change"><Button size="sm" variant="outline" disabled={pending} onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : `${claimKind(claimType)} 사유 정정 ${blocked ? '이력' : '및 이력'}`}</Button>
      {blocked ? <p className="text-sm text-muted-foreground" data-claim-panel-blocked="reason-change" role="status">{claimReasonError(undefined, peek?.blocker ?? '')}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div>;
}
