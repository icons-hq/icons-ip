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
import { krw, krwAmountWords } from '@/lib/format';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { useAdminLeaveGuard } from '@/components/admin/useAdminLeaveGuard';
import { adminConfirm } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { cn } from 'cn';
import { returnFeeDeductionBasisLabel, returnFeeDeductionSkippedNotice } from '@/lib/claims/return-fee-deduction';
import {
  BANK_REFUND_ABANDON_LABEL, BANK_REFUND_ACCOUNT_FAILED, BANK_REFUND_CUSTOM_TIME_LABEL, BANK_REFUND_LABELS, BANK_REFUND_LOAD_FAILED,
  BANK_REFUND_RECOVERY_PREFIX, BANK_REFUND_RELOAD_LABEL, BANK_REFUND_RESEND_LABEL, BANK_REFUND_VIEW_ACCOUNT_LABEL,
  bankRefundBlockedMessage, bankRefundConfirm, bankRefundFields, bankRefundMetadata, bankRefundNotBefore, bankRefundOccurredAt, bankRefundReceiptMatches, bankRefundRecordedMessage,
  bankRefundRecoveryKey, bankRefundSteps, bankRefundTimeInputMin, bankRefundTransferAmount, bankRefundWithoutTransfer, normalizeBankRefundRequest, parseBankRefundRecovery,
  type BankRefundAccountView, type BankRefundContext, type BankRefundFailure, type BankRefundIdentity,
  type BankRefundReceipt, type BankRefundRecovery, type BankRefundRequest, type BankRefundStep,
} from '@/lib/admin/bank-transfer-refund';

type Scope = ReturnType<typeof createGoodsDescriptionToolScope>;
/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
/* 시각은 '지금'(누른 시각)이 기본이다. 다른 시각은 [다른 시각 적기]를 눌렀을 때만 적는다(customTime). */
const empty = { customTime: false, occurredAt: '', evidence: '', note: '' };

function AccountView({ account, onClose }: { account: BankRefundAccountView; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const timeout = window.setTimeout(onClose, 60_000);
    const hide = () => { if (document.visibilityState !== 'visible') onClose(); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', hide); };
  }, [onClose]);
  /* 네이티브 모달 dialog(showModal) 그대로 — 60초·탭 이동 시 닫기와 원문 해제가 이 요소의 수명에 묶여 있다. 모양만 kit Dialog와 같게 그린다. */
  return <dialog ref={dialog} aria-labelledby="bank-refund-account-title" onCancel={onClose} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-xl bg-popover p-5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 backdrop:bg-black/20">
    <div className="flex flex-col gap-3">
      <h3 className="text-base leading-snug font-medium" id="bank-refund-account-title">환불계좌</h3>
      <p className="text-muted-foreground">계좌를 본 기록이 남았습니다. 60초가 지나거나 다른 탭으로 가면 이 창이 닫힙니다.</p>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border bg-muted/40 p-3 break-all" data-private="true">
        <dt className="text-muted-foreground">은행</dt><dd className="m-0">{account.bankName}</dd><dt className="text-muted-foreground">계좌번호</dt><dd className="m-0 tabular-nums">{account.accountNumber}</dd><dt className="text-muted-foreground">예금주</dt><dd className="m-0">{account.accountHolder}</dd>
      </dl>
      <button className={`${cn(buttonVariants({ size: 'sm' }))} w-fit`} data-slot="button" type="button" onClick={onClose}>닫기</button>
    </div>
  </dialog>;
}

/* 순서 표시. 이 화면은 돈을 보내지 않고 단계마다 기록만 남긴다 — 은행에서 직접 송금하는 자리를 마지막 단계 이름이 말한다. */
function Steps({ steps }: { steps: BankRefundStep[] }) {
  return <ol aria-label="무통장 환불 순서" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" data-bank-refund-steps="">
    {steps.map((step, index) => <li key={step.kind} aria-current={step.state === 'current' ? 'step' : undefined} data-bank-refund-step={step.state}
      className={step.state === 'current' ? 'font-medium' : step.state === 'waiting' ? 'text-muted-foreground' : undefined}>
      {`${index + 1}. ${step.label}${step.state === 'done' ? ` · ${step.at ? formatOrderDateTime(step.at) : '완료'}` : step.state === 'current' ? ' · 지금 할 일' : ''}`}
    </li>)}
  </ol>;
}

function RefundPanel({ identity, scope, stage }: { identity: BankRefundIdentity; scope: Scope; stage?: string }) {
  const router = useRouter(), key = bankRefundRecoveryKey(identity);
  const [context, setContext] = useState<BankRefundContext | null>(null);
  const [draft, setDraft] = useState(empty), [pending, setPending] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  /* 기록을 서버에 보내고 응답을 기다리는 중. 복구 기록(recovery)은 호출 전에 남기지만, 복구 안내는 응답을 모를 때만 그린다. */
  const [sending, setSending] = useState(false);
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
  /* 복구 화면(결과를 모를 때의 문장과 두 버튼)은 응답을 기다리는 동안이 아니라, 응답을 못 받았거나 결과를 모를 때·탭을 다시 열었을 때만 그린다. */
  const showRecovery = Boolean(recovery) && !sending;
  const dirty = Boolean(recovery || draft.customTime || draft.evidence || draft.note);
  const closeAccount = useMemo(() => () => setAccount(null), []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; dispatched.current = null; }; }, []);
  /* 요청의 단계(stage)가 바뀌면 다시 읽는다 — 같은 화면에서 요청을 승인하면 이 칸이 승인 전 상태('지금 단계에서는 기록할 수 없습니다')로 남지 않고 1단계 양식을 연다. */
  useEffect(() => {
    let active = true; const ticket = scope.capture(); if (!ticket) return;
    startTransition(async () => {
      try {
        const result = await loadBankRefundContextAction(identity);
        if (!active || !alive.current || !scope.canApply(ticket)) return;
        if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
        else { setContext(result.context); setNeedsRefresh(false); }
      } catch { if (active && alive.current && scope.canApply(ticket)) setError(BANK_REFUND_LOAD_FAILED); }
    });
    return () => { active = false; };
  }, [identity, reload, scope, stage]);
  useAdminLeaveGuard({ dirty, message: '적던 근거와 메모는 저장되지 않고 사라집니다. 화면을 나갈까요?' });

  function clearRecovery() { try { sessionStorage.removeItem(key); } catch {} setRecovery(null); dispatched.current = null; setCanRetry(false); }
  function accept(receipt: BankRefundReceipt, original: BankRefundRecovery, notice?: string) {
    if (!bankRefundReceiptMatches(receipt, original)) { setError(`불러온 결과가 이 기록과 맞지 않습니다. [${SAVE_CHECK_LABEL}]을 다시 눌러주세요.`); return; }
    const recorded = bankRefundRecordedMessage(receipt.kind, context);
    clearRecovery(); setDraft(empty); setAccount(null); setError(''); setNeedsRefresh(true); setReload(value => value + 1);
    setMessage(receipt.state === 'sealed' ? '앞서 누른 기록은 저장되지 않았습니다. 다시 적어 주세요.' : recorded);
    if (notice) setError(notice);
    router.refresh();
  }
  function fail(failure: BankRefundFailure, uncertain: boolean) {
    setError(failure.error);
    if (failure.authChanged) { clearRecovery(); setDraft(empty); setAccount(null); scope.authenticate(null, null); return; }
    if (!failure.uncertain && !uncertain) { clearRecovery(); if (failure.conflict) setNeedsRefresh(true); }
  }
  /*
   * 새 기록: 확인창을 먼저, 전환(startTransition) 밖에서 받는다. 비동기 전환 안에서 건 상태 갱신은 전환이 끝날 때까지 보류되는데,
   * 확인창 호스트가 창을 여는 갱신도 그 안에 들어가면 창이 뜨지 않은 채 확인을 영영 기다린다(세 단계 버튼이 모두 멈추던 원인).
   * 그래서 승인된 뒤에만 record()를 불러 전환을 시작한다. 확인을 기다리는 동안은 busy로 거듭 제출을 막고, 승인이든 돌아가기든 확인이 끝나면 푼다.
   */
  async function submit() {
    if (busy.current || !scope.capture() || locked || !context || !nextKind) return;
    /* 시각은 버튼을 누른 이때 정한다. 확인창은 이 시각과 금액을 보여 주고, 다시 보낼 때도 같은 값을 보낸다. */
    const occurredAt = bankRefundOccurredAt({ custom: draft.customTime ? draft.occurredAt : null, now: new Date(), notBefore: bankRefundNotBefore(context, nextKind) });
    /* 확인 체크는 없앴다 — 화면이 true를 보낸다(DB 인자 p_confirmed 그대로). 체크가 하던 말은 아래 확인창이 한다. */
    const original = normalizeBankRefundRequest({ ...identity, version: 1, operationId: crypto.randomUUID(),
      revision: context.revision, amount: context.amount, kind: nextKind, evidence: draft.evidence.trim(), note: draft.note.trim(),
      occurredAt: occurredAt ?? '', confirmed: true });
    if (!original) { setError(bankRefundFields(nextKind, context).missing); return; }
    busy.current = true;
    let confirmed = false;
    try { confirmed = await adminConfirm(bankRefundConfirm(context, nextKind, original.occurredAt)); } catch { confirmed = false; }
    busy.current = false;
    if (confirmed && alive.current) record(original);
  }
  /*
   * 기록을 서버에 보낸다. 새 기록(submit, 확인을 받은 뒤)과 다시 보내기(앞서 보낸 내용 그대로, 이미 확인한 일이라 확인창 없음)가 함께 쓴다.
   * 화면을 '기록하는 중'으로 바꾸는 갱신은 전환 밖에서 하고 서버 호출만 전환 안에서 한다 — 전환 안의 갱신은 호출이 끝날 때까지 보류돼
   * 처리 중 표시와 팝업 닫힘 방지(useClaimPreviewBusy)가 늦어진다.
   * 복구에 쓸 값(같은 작업 번호·보낸 내용)은 호출 전에 recovery·탭 저장소에 남긴다(응답이 끊겨도 [저장됐는지 확인]이 같은 작업을 보게). 다만 복구 화면은
   * 기다리는 동안(sending)에는 그리지 않는다 — 처리 중에 '저장됐는지 확인하지 못했습니다'가 보이면 느린 응답이 매번 실패처럼 읽힌다.
   */
  function record(original: BankRefundRequest) {
    const ticket = scope.capture(); if (busy.current || !ticket) return;
    const metadata = bankRefundMetadata(original), wasUncertain = Boolean(recovery);
    try { sessionStorage.setItem(key, JSON.stringify(metadata)); } catch { setError('브라우저가 이 사이트의 저장을 막고 있어 기록하지 않았습니다. 시크릿 창이면 일반 창에서 다시 열고, 아니면 브라우저 설정에서 사이트 데이터 저장을 허용해주세요.'); return; }
    dispatched.current = original; setRecovery(metadata); setCanRetry(true); busy.current = true; setPending(true); setSending(true); setAccount(null); setError(''); setMessage('');
    startTransition(async () => {
      try {
        const result = await recordBankRefundAction(original);
        if (!alive.current || !scope.canApply(ticket)) return;
        if ('error' in result) fail(result, wasUncertain);
        else if (result.receipt?.state === 'recorded') accept(result.receipt, original, result.notice);
        else setError(SAVE_UNKNOWN_MESSAGE);
      } catch { if (alive.current && scope.canApply(ticket)) setError(SAVE_UNKNOWN_MESSAGE); }
      finally { busy.current = false; if (alive.current && scope.canApply(ticket)) { setPending(false); setSending(false); } }
    });
  }
  async function check(seal = false) {
    if (busy.current || !recovery) return;
    const original = recovery, ticket = scope.capture(); if (!ticket) return;
    busy.current = true; setPending(true); setAccount(null); setError(''); setMessage('');
    try {
      const result = await readBankRefundAction(original, seal);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) fail(result, true);
      else if (result.receipt) accept(result.receipt, original, result.notice);
      else setMessage(dispatched.current ? `아직 저장되지 않았습니다. [${BANK_REFUND_RESEND_LABEL}]을 누르면 됩니다(두 번 저장되지 않습니다).` : `아직 저장되지 않았습니다. [${BANK_REFUND_ABANDON_LABEL}]를 누른 뒤 다시 적어 주세요.`);
    } catch { if (alive.current && scope.canApply(ticket)) setError(`저장됐는지 확인하지 못했습니다. 잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러주세요.`); }
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
    } catch { if (alive.current && scope.canApply(ticket)) setError(BANK_REFUND_ACCOUNT_FAILED); }
    finally { busy.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  /* 반품배송비 차감(ADR-0031): 송금액 = 결제액 − 차감액. 판정·결정이 없으면 지금처럼 전액이다. */
  const deduction = context?.refundDeduction?.applicable && context.refundDeduction.refundAmount !== null ? context.refundDeduction : null;
  const deductionSkipped = context?.refundDeduction && context.phase !== 'completed' ? returnFeeDeductionSkippedNotice(context.refundDeduction) : null;
  /* 재고 부족 부분 취소(ADR-0032) 뒤의 송금액은 남은 잔액이다. 0원이면 송금 없이 닫힌다(송금 원장에는 '송금 없이 완료'로 남는다). */
  const partial = context?.partialRefund ?? null;
  const transferAmount = context ? bankRefundTransferAmount(context) : 0;
  const withoutTransfer = context ? bankRefundWithoutTransfer(context) : false;
  const phaseLabel = !context ? '' : context.phase === 'completed' ? withoutTransfer ? '송금 없이 완료' : '송금 완료'
    : context.phase === 'awaiting_transfer' ? '송금 대기' : '취소 확정 전';
  const blocked = context && !nextKind ? bankRefundBlockedMessage(context) : null;
  const fields = kind ? bankRefundFields(kind, context) : null;

  return <section aria-label="무통장 환불 처리" className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" data-claim-panel="bank-refund">
    <h4 className="text-base leading-snug font-medium">무통장 환불</h4>
    {context ? <><p className="flex flex-wrap items-center gap-2"><strong className="font-semibold tabular-nums">{`${context.phase === 'completed' ? '송금한 금액' : '송금할 금액'}: ${krw(transferAmount)}`}</strong> <AdminStatusBadge tone={statusTone('refundTransfer', context.phase)}>{phaseLabel}</AdminStatusBadge></p>
      {partial ? <p className="text-muted-foreground" data-bank-refund-partial="">{withoutTransfer
        ? `앞선 재고 부족 부분 취소로 결제 ${krwAmountWords(context.amount)}을 모두 따로 환불합니다. 돌려줄 잔액이 없어 취소를 확정하면 송금 없이 환불 0원으로 마칩니다.`
        : `앞선 재고 부족 부분 취소분 ${krwAmountWords(partial.refundedAmount)}은 이 요청과 따로 환불합니다. 송금할 금액은 남은 잔액입니다.`}</p> : null}
      {deduction ? <p className="text-muted-foreground" data-bank-refund-deduction="">{`결제 ${krw(deduction.paymentAmount ?? context.amount)} − 반품배송비 ${krw(deduction.deductionAmount)}(단순 변심 반품, ${returnFeeDeductionBasisLabel(deduction)})${deduction.source === 'plan' ? ` · [${BANK_REFUND_LABELS.file_transfer}]을 남길 때 이 금액으로 정해집니다.` : ''}`}</p> : null}
      {deductionSkipped ? <AdminNotice tone="warning">{deductionSkipped}</AdminNotice> : null}
      {context.gift ? <AdminNotice tone="warning">선물 주문은 선물 받는 분이 요청했더라도 결제한 분에게 환불합니다.</AdminNotice> : null}
      <Steps steps={bankRefundSteps(context, nextKind)} />
      {context.maskedAccount ? <p>등록된 환불계좌: {context.maskedAccount} · {context.maskedHolder}</p> : null}
    </> : !error ? <p className="text-muted-foreground" role="status">환불 상태를 불러오고 있습니다.</p> : null}
    {blocked ? <p className="text-muted-foreground">{blocked}</p> : null}
    {context?.viewBlocker === null ? <button className={`${OUTLINE} w-fit`} data-slot="button" disabled={pending || Boolean(recovery) || needsRefresh} type="button"
      onClick={() => startTransition(async () => { await viewAccount(); })}>{BANK_REFUND_VIEW_ACCOUNT_LABEL}</button> : null}
    {showRecovery ? <p className="text-destructive" role="alert">{SAVE_UNKNOWN_MESSAGE}</p> : null}
    {kind && fields ? <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-1 font-medium">{BANK_REFUND_LABELS[kind]}</legend>
        {draft.customTime ? <div className="flex flex-wrap items-end gap-2">
          <label className={`${FIELD} w-full sm:w-auto`}><span className={FIELD_LABEL}>{fields.time}</span><input className="w-full sm:w-64" type="datetime-local" required
            min={context ? bankRefundTimeInputMin(bankRefundNotBefore(context, kind)) : undefined} value={draft.occurredAt} onChange={event => setDraft(previous => ({ ...previous, occurredAt: event.target.value }))} /></label>
          <button className={OUTLINE} data-slot="button" type="button" onClick={() => setDraft(previous => ({ ...previous, customTime: false, occurredAt: '' }))}>지금으로</button>
        </div> : <div className={FIELD}><span className={FIELD_LABEL}>{fields.time}</span>
          <div className="flex flex-wrap items-center gap-2"><span>지금</span>
            <button className={OUTLINE} data-slot="button" type="button" onClick={() => setDraft(previous => ({ ...previous, customTime: true }))}>{BANK_REFUND_CUSTOM_TIME_LABEL}</button></div>
        </div>}
        <label className={FIELD}><span className={FIELD_LABEL}>{fields.evidence}</span><input className="w-full" required minLength={2} maxLength={300} value={draft.evidence} onChange={event => setDraft(previous => ({ ...previous, evidence: event.target.value }))} placeholder={fields.evidenceExample} /></label>
        <label className={FIELD}><span className={FIELD_LABEL}>{fields.note}</span><input className="w-full" required minLength={2} maxLength={300} value={draft.note} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} placeholder={fields.noteExample} /></label>
        <p className="text-xs text-muted-foreground">{fields.kept} 계좌번호·예금주는 적지 마세요.</p>
      </fieldset>
      {!showRecovery ? <button className={`${PRIMARY} w-fit`} data-slot="button" type="submit" disabled={locked}>{sending ? '기록하는 중…' : BANK_REFUND_LABELS[kind]}</button> : null}
    </form> : null}
    {showRecovery ? <div className="flex flex-wrap gap-2">
      <button className={PRIMARY} data-slot="button" disabled={pending} type="button" onClick={() => startTransition(async () => { await check(); })}>{SAVE_CHECK_LABEL}</button>
      {canRetry ? <button className={OUTLINE} data-slot="button" disabled={pending} type="button" onClick={() => { const original = dispatched.current; if (original) record(original); }}>{BANK_REFUND_RESEND_LABEL}</button>
        : <button className={OUTLINE} data-slot="button" disabled={pending} type="button" onClick={() => startTransition(async () => { await check(true); })}>{BANK_REFUND_ABANDON_LABEL}</button>}
    </div> : <button className={`${OUTLINE} w-fit`} data-slot="button" disabled={pending || dirty && !needsRefresh} type="button" onClick={() => { setError(''); setAccount(null); if (needsRefresh) setDraft(empty); setNeedsRefresh(true); setReload(value => value + 1); }}>{BANK_REFUND_RELOAD_LABEL}</button>}
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    {account ? <AccountView account={account} onClose={closeAccount} /> : null}
  </section>;
}

export function BankTransferRefund({ actorId, orderId, claimId, stage }: { actorId: string; orderId: string; claimId: string; stage?: string }) {
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
  if (!auth.ready) return <p className="text-sm text-muted-foreground" role="status">무통장 환불 처리를 위해 로그인 상태를 확인하고 있습니다.</p>;
  if (auth.blocked || !identity) return <p className="text-sm text-destructive" role="alert">로그인 계정이나 로그인 상태가 바뀌었습니다. 새로고침해 현재 계정으로 요청을 다시 열어주세요.</p>;
  return <RefundPanel key={`${orderId}:${claimId}:${sessionId}`} identity={identity} scope={scope} stage={stage} />;
}
