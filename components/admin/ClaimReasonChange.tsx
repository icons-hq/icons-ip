'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeClaimReasonAction, loadClaimReasonContextAction, readClaimReasonChangeAction } from '@/app/admin/claim-reason-change-actions';
import {
  claimReasonBlockedMessage, claimReasonConfirmMessage, claimReasonError, claimReasonReceiptMatches, claimReasonReturnFeeNote, claimReasonSavedMessage, normalizeClaimReasonRequest,
  type ClaimReasonContext, type ClaimReasonReceipt, type ClaimReasonRequest,
} from '@/lib/orders/claim-reason-change';
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
  function accept(saved: ClaimReasonReceipt, request: ClaimReasonRequest) {
    if (!claimReasonReceiptMatches(saved, request) || saved.orderId !== context.orderId || saved.fromReasonType !== context.reasonType || saved.fromReason !== context.reason) {
      setError('불러온 저장 결과가 이 요청과 맞지 않습니다. [같은 요청 결과 확인]을 다시 누르고, 같은 안내가 반복되면 새로고침해 처리 이력을 확인해주세요.'); setUncertain(true); return;
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
    if (!request) { setError(claimReasonError(undefined, 'invalid_claim_reason_change')); return; }
    const wasUncertain = uncertain; inFlight.current = true;
    if (!retry) {
      /* 같은 요청의 재시도(응답 유실)는 이미 확인한 내용이라 다시 묻지 않는다. */
      let ok = false;
      try { ok = await adminConfirm({ title: `${kind} 사유 정정`, message: claimReasonConfirmMessage(context, request), confirmLabel: '사유 정정' }); }
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
      else { setUncertain(true); setError('저장됐는지 확인하지 못했습니다. [같은 요청 결과 확인]을 눌러 먼저 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장됐는지 확인하지 못했습니다. [같은 요청 결과 확인]을 눌러 먼저 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await readClaimReasonChangeAction(request.id);
      if ('error' in result) setError(result.error);
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage('아직 저장된 결과가 없습니다. 입력한 내용 그대로 [같은 내용으로 재시도]를 누르면 됩니다(두 번 처리되지 않습니다).');
    } catch { setError('저장 결과를 불러오지 못했습니다. 잠시 뒤 [같은 요청 결과 확인]을 다시 눌러주세요.'); }
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
        setMessage(changedActor || changedType ? '로그인 계정이나 요청 유형이 바뀌어 입력한 내용을 지웠습니다. 다시 입력해주세요.' : '최신 요청을 다시 불러왔습니다. 입력한 내용은 그대로 두었습니다. 현재 사유·비용과 비교한 뒤 [사유 정정 확정]을 다시 눌러주세요(저장할 때 확인창이 뜹니다).');
        if (changedType) { router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[result.context.claimType]}/${context.claimId}`); router.refresh(); }
      } else setError('이 요청의 최신 상태를 불러오지 못했습니다. 새로고침한 뒤 다시 열어주세요.');
    } catch { setError('최신 요청을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label={`${kind} 사유 정정`} data-claim-panel="reason-change">
    <h3 className="text-base leading-snug font-medium">{kind} 사유 정정</h3>
    <p>원래 접수일 {formatOrderDateTime(context.requestedAt)} · 최초 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[context.originalReasonType])} / {context.originalReason}</p>
    <p>현재 사유: {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[receipt?.toReasonType ?? context.reasonType])} / {receipt?.toReason ?? context.reason}</p>
    <p className="text-muted-foreground">고객과 확인한 실제 사유를 기록합니다. 최초 접수일과 수거·보류·비용 기록은 유지되며, 새 분류의 기한도 원래 접수일 기준입니다.</p>
    {returnFeeNote && context.allowed && !receipt ? <p data-claim-reason-return-fee="">{returnFeeNote}</p> : null}
    {context.returnFee?.feeInvoiceOpen && context.allowed && !receipt ? <p className="text-muted-foreground">이 요청에 배송비 청구가 있습니다. 사유를 바꾸면 그 청구가 취소되고, 입금 확인된 청구는 돌려줄 금액으로 바뀝니다.</p> : null}
    {context.fee ? <p>기존 비용: {krw(context.fee.amount)} · {context.fee.note} · {formatOrderDateTime(context.fee.confirmedAt)}</p> : null}
    {context.history.length ? <details className="rounded-lg border bg-background px-3 py-2"><summary className="cursor-pointer font-medium">사유 정정 이력 {context.history.length}건</summary><ol className="mt-2 flex flex-col gap-2 border-l pl-4">{context.history.map(row => <li key={row.id}>
      <time className="text-muted-foreground tabular-nums" dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.fromReasonType])} → {adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[row.toReasonType])}
      <p>정정 전: {row.fromReason}</p><p>정정 후: {row.toReason}</p><p className="text-muted-foreground">내부 협의 근거: {row.agreement}</p>
    </li>)}</ol></details> : null}
    {receipt ? <p role="status">{claimReasonSavedMessage(receipt)}</p>
      : !context.allowed ? <p className="text-muted-foreground" role="status">{claimReasonBlockedMessage(context)}</p>
        : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}><legend className="mb-1 font-medium">정정 내용과 고객 협의</legend>
            <div className={FIELD}><Label htmlFor={`claim-reason-type-${context.claimId}`}>사유 분류</Label>
              <NativeSelect className="w-full sm:w-64" id={`claim-reason-type-${context.claimId}`} value={reasonType} onChange={event => { if (editable()) setReasonType(event.target.value as OrderWithdrawalReasonType); }}>
                {ORDER_WITHDRAWAL_REASON_TYPES.map(type => <NativeSelectOption key={type} value={type} disabled={type !== context.reasonType && !(type === 'defect' ? context.canUseDefect : context.canUseChangeOfMind)}>{adminGoodsCopy(ORDER_WITHDRAWAL_REASON_LABELS[type])}</NativeSelectOption>)}
              </NativeSelect></div>
            {!context.canUseChangeOfMind || !context.canUseDefect ? <p className="text-muted-foreground">원래 접수일에 신청 기한을 지난 분류로는 바꿀 수 없습니다.</p> : null}
            <div className={FIELD}><Label htmlFor={`claim-reason-text-${context.claimId}`}>고객용 설명 (1~200자)</Label>
              <Input id={`claim-reason-text-${context.claimId}`} value={reason} minLength={1} maxLength={400} required onChange={event => { if (editable()) setReason(event.target.value); }} /></div>
            <div className={FIELD}><Label htmlFor={`claim-reason-agreement-${context.claimId}`}>정정 사유 · 내부 고객 협의 근거 (2~500자)</Label>
              <Input id={`claim-reason-agreement-${context.claimId}`} value={agreement} minLength={2} maxLength={1000} required placeholder="예: 11/25 상담(문의 번호) 사진으로 하자 확인, 고객과 하자 반품으로 정정 합의" onChange={event => { if (editable()) setAgreement(event.target.value); }} /></div>
            <p className="text-muted-foreground">정정 사유는 처리자와 함께 정정 이력에 남고 운영자에게만 보입니다. 고객에게는 정정된 분류와 고객용 설명이 앱 알림과 주문 상세로 안내됩니다.</p>
          </fieldset>
          <div className="flex flex-wrap gap-2">{uncertain ? <>
            <Button size="sm" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</Button>
          </> : conflict ? <Button size="sm" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</Button>
            : <Button size="sm" type="submit" disabled={pending}>{pending ? '처리 중…' : '사유 정정 확정'}</Button>}</div>
        </form>}
    {error ? <p className="text-destructive outline-none" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    <Button className="w-fit" size="sm" variant="outline" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</Button>
  </section>;
}
export function ClaimReasonChange({ claimId, claimType = 'exchange' }: { claimId: string; claimType?: OrderClaimType }) {
  const [context, setContext] = useState<ClaimReasonContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  useClaimPreviewBusy(pending);
  async function open() {
    if (loading.current) return; loading.current = true; setPending(true); setError('');
    try {
      const result = await loadClaimReasonContextAction(claimId);
      if ('error' in result) setError(result.error); else if ('context' in result && result.context.claimId === claimId) setContext(result.context);
      else setError('이 요청의 최신 상태를 불러오지 못했습니다. 새로고침한 뒤 다시 열어주세요.');
    } catch { setError('최신 요청을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.'); } finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimReasonChangePanel initial={context} onClose={() => setContext(null)} />
    : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="reason-change"><Button size="sm" variant="outline" disabled={pending} onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : `${claimKind(claimType)} 사유 정정 및 이력`}</Button>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div>;
}
