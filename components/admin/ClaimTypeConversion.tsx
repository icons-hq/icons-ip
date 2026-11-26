'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { convertClaimTypeAction, loadClaimTypeContextAction, readClaimTypeChangeAction } from '@/app/admin/claim-type-conversion-actions';
import {
  CLAIM_TYPE_AGREEMENT_ERROR, CLAIM_TYPE_AGREEMENT_MAX, CLAIM_TYPE_AGREEMENT_MIN, claimTypeConfirmMessage, claimTypeError, claimTypeInputError, claimTypeReceiptMatches, normalizeClaimTypeRequest,
  type ClaimTypeContext, type ClaimTypeRequest, type ClaimTypeReceipt,
} from '@/lib/orders/claim-type-conversion';
import {
  CLAIM_CHANGE_BACK_LABEL, CLAIM_CHANGE_CHECK_LABEL, CLAIM_CHANGE_LOAD_FAILED_MESSAGE, CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE, CLAIM_CHANGE_NOT_SAVED_MESSAGE,
  CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE, CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE, CLAIM_CHANGE_RELOAD_LABEL, CLAIM_CHANGE_RESEND_LABEL, CLAIM_CHANGE_UNKNOWN_MESSAGE,
  claimChangeCount,
} from '@/lib/admin/claim-change-copy';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { adminConfirm } from '@/lib/admin/confirm';
import { ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';
import { startAdminNavigation } from '@/lib/admin/navigation-pending';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다.
   [교환으로 바꾸기]·[반품으로 바꾸기]는 누르면 확인창이 한 번 뜬다(고객 알림·배송비 청구·재고 선택이 달라진다). 합의 확인 체크 칸은 없다. */
const PRIMARY = cn(buttonVariants({ size: 'sm' }));
const OUTLINE = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';
const HINT = 'text-xs text-muted-foreground';

/** embedded: 목록 위 상세 팝업(R8)에서 열렸다. 전환 뒤에도 독립 상세가 아니라 전환된 유형의 목록 팝업으로 연다. */
export function ClaimTypeConversionPanel({ initial, onClose, embedded = false }: { initial: ClaimTypeContext; onClose: () => void; embedded?: boolean }) {
  const router = useRouter(); const [context, setContext] = useState(initial); const [agreement, setAgreement] = useState('');
  const [bankName, setBankName] = useState(''); const [accountNumber, setAccountNumber] = useState(''); const [accountHolder, setAccountHolder] = useState('');
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<ClaimTypeReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimTypeRequest | null>(null); const inFlight = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useClaimPreviewBusy(pending); /* 목록 위 팝업(R8)에서 전환을 기다리는 동안 팝업이 닫히지 않게 한다. */
  const toType = context.claimType === 'return' ? 'exchange' : 'return'; const targetLabel = ORDER_CLAIM_TYPE_LABELS[toType]; const sourceLabel = ORDER_CLAIM_TYPE_LABELS[context.claimType];
  const actionLabel = `${targetLabel}으로 바꾸기`;
  const locked = pending || uncertain || Boolean(receipt); const editable = () => !inFlight.current && !dispatched.current && !receipt;
  const accountRequired = toType === 'return' && context.bankRequired && !context.savedAccount;
  const agreementId = `claim-type-agreement-${context.claimId}`;
  function accept(saved: ClaimTypeReceipt, request: ClaimTypeRequest) {
    if (!claimTypeReceiptMatches(saved, request) || saved.orderId !== context.orderId || saved.fromType !== context.claimType) { setError(CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE); setUncertain(true); return; }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    setBankName(''); setAccountNumber(''); setAccountHolder('');
    const destination = embedded ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[saved.toType]}?claimId=${saved.claimId}` : `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[saved.toType]}/${saved.claimId}`;
    startAdminNavigation(destination);
    if (embedded) router.replace(destination, { scroll: false });
    else router.replace(destination);
    router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || conflict && !uncertain) return;
    const retry = dispatched.current;
    /* 확인창을 거치면 확인한 것이다. `confirmed`는 DB가 true를 요구하는 값이라 화면이 채워 보낸다. */
    const request = normalizeClaimTypeRequest(retry ?? { id: crypto.randomUUID(), claimId: context.claimId, revision: context.revision,
      toType, agreement, confirmed: true, refundAccount: toType === 'return' ? { bankName, accountNumber, accountHolder } : null });
    if (!request) { setError(claimTypeInputError({ agreement, toType, bankName, accountNumber, accountHolder }) ?? CLAIM_TYPE_AGREEMENT_ERROR); return; }
    if (accountRequired && !request.refundAccount) { setError(claimTypeError(undefined, 'claim_conversion_account_required')); return; }
    const wasUncertain = uncertain; inFlight.current = true;
    if (!retry) {
      /* 같은 요청을 다시 보내는 경우(응답 유실)는 이미 확인한 내용이라 다시 묻지 않는다. */
      let ok = false;
      try {
        ok = await adminConfirm({ title: `${sourceLabel} → ${targetLabel} 전환`, confirmLabel: actionLabel, cancelLabel: CLAIM_CHANGE_BACK_LABEL,
          message: claimTypeConfirmMessage(context, request, adminClaimStageLabel(context.claimType, context.stage)) });
      } catch { ok = false; }
      if (!ok) { inFlight.current = false; return; }
    }
    dispatched.current = request; setPending(true); setError(''); setMessage('');
    try {
      const result = await convertClaimTypeAction(request);
      if ('error' in result) { const keep = wasUncertain || Boolean(result.uncertain); setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error); if (!keep) dispatched.current = null; }
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
    } catch { setUncertain(true); setError(CLAIM_CHANGE_UNKNOWN_MESSAGE); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try { const result = await readClaimTypeChangeAction(request.id); if ('error' in result) setError(result.error); else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage(CLAIM_CHANGE_NOT_SAVED_MESSAGE); }
    catch { setError(CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reload() {
    if (inFlight.current || dispatched.current) return; inFlight.current = true; setPending(true); setError('');
    try { const result = await loadClaimTypeContextAction(context.claimId); if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === context.claimId && result.context.orderId === context.orderId) {
        setContext(result.context); setConflict(false);
        setMessage(`최신 상태를 불러왔습니다. 적은 내용은 그대로 있습니다. 바뀐 상태를 확인한 뒤 [${ORDER_CLAIM_TYPE_LABELS[result.context.claimType === 'return' ? 'exchange' : 'return']}으로 바꾸기]를 다시 눌러 주세요.`);
      } else setError(CLAIM_CHANGE_LOAD_MISMATCH_MESSAGE); }
    catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); } finally { inFlight.current = false; setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label="반품·교환 전환" data-claim-panel="type-conversion">
    <h3 className="text-base leading-snug font-medium">{sourceLabel} → {targetLabel} 전환</h3>
    {context.allowed && !receipt ? <p>접수일과 회수 기록은 그대로 두고 요청 유형을 바꿉니다.</p> : null}
    {context.history.length ? <div className="flex flex-col gap-1.5"><h4 className="font-medium">유형 전환 이력</h4><ol className="flex flex-col gap-1.5 border-l pl-4">{context.history.map(row => <li key={row.id}><time className="text-muted-foreground tabular-nums" dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {ORDER_CLAIM_TYPE_LABELS[row.fromType]} → {ORDER_CLAIM_TYPE_LABELS[row.toType]}<p className="text-muted-foreground">{row.agreement}</p></li>)}</ol></div> : null}
    {receipt ? <p role="status">{targetLabel} 요청으로 전환했습니다. 바뀐 요청 화면을 열고 있습니다.</p> : !context.allowed ? <p className="text-muted-foreground" role="status">{claimTypeError(undefined, context.blocker ?? '')}</p> : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}><legend className="sr-only">고객 합의</legend>
        <div className={FIELD}>
          <label className={FIELD_LABEL} htmlFor={agreementId}>고객 합의 근거 (필수)</label>
          <input aria-describedby={`${agreementId}-hint`} className="w-full" id={agreementId} maxLength={CLAIM_TYPE_AGREEMENT_MAX} minLength={CLAIM_TYPE_AGREEMENT_MIN} required
            placeholder={`예: 전화 상담(문의 번호 1234)에서 ${sourceLabel} 대신 ${targetLabel}으로 하기로 합의`} value={agreement}
            onChange={event => { if (editable()) setAgreement(event.target.value); }} />
          <small className={HINT} id={`${agreementId}-hint`}>{claimChangeCount(agreement.length, CLAIM_TYPE_AGREEMENT_MIN, CLAIM_TYPE_AGREEMENT_MAX)} · 운영자만 보는 전환 이력에 남고, 고객 주문 상세에는 ‘고객 합의 확인’으로만 보입니다.</small>
        </div>
        {toType === 'return' ? <>
          {context.savedAccount ? <p>저장된 환불계좌: {context.savedAccount.account} · {context.savedAccount.holder}. 바꿀 때만 아래 세 칸을 모두 적어 주세요.</p> : <p className="text-muted-foreground">{accountRequired ? '무통장 주문이라 환불계좌가 필요합니다. 은행·계좌번호·예금주를 모두 적어 주세요.' : '계좌로 환불하기로 고객과 협의했을 때만 환불계좌를 적어 주세요.'}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={FIELD}><span className={FIELD_LABEL}>은행</span><input autoComplete="off" className="w-full" value={bankName} maxLength={40} required={accountRequired} onChange={event => { if (editable()) setBankName(event.target.value); }} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>계좌번호</span><input autoComplete="off" className="w-full" inputMode="numeric" value={accountNumber} maxLength={30} required={accountRequired} onChange={event => { if (editable()) setAccountNumber(event.target.value); }} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>예금주</span><input autoComplete="off" className="w-full" value={accountHolder} maxLength={40} required={accountRequired} onChange={event => { if (editable()) setAccountHolder(event.target.value); }} /></label>
          </div>
        </> : null}
      </fieldset>
      <div className="flex flex-wrap gap-2">{uncertain ? <><button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void readback(); }}>{CLAIM_CHANGE_CHECK_LABEL}</button><button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(); }}>{CLAIM_CHANGE_RESEND_LABEL}</button></>
        : conflict ? <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void reload(); }}>{CLAIM_CHANGE_RELOAD_LABEL}</button>
          : <button className={PRIMARY} data-slot="button" type="submit" disabled={pending}>{pending ? '처리 중…' : actionLabel}</button>}</div>
    </form>}
    {error ? <p className="text-destructive outline-none" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</button>
  </section>;
}

/** 진입 칸이 미리 읽어 두는 값. 지금 바꿀 수 있는지와, 바꿀 수 없는 이유만 쓴다. */
interface ConversionPeek { allowed: boolean; blocker: string | null }

export function ClaimTypeConversion({ claimId, embedded = false }: { claimId: string; embedded?: boolean }) {
  const [context, setContext] = useState<ClaimTypeContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  const [peek, setPeek] = useState<ConversionPeek | null>(null);
  const panelOpen = context !== null;
  /* 못 바꾸는 단계는 눌러 보기 전에 알린다: 버튼은 이력만 여는 이름이 되고 이유가 아래에 보인다. 읽지 못하면 그대로 두고 눌렀을 때 읽는다. 창을 닫으면 다시 읽는다. */
  useEffect(() => {
    if (panelOpen) return undefined;
    let alive = true;
    loadClaimTypeContextAction(claimId).then(
      result => { if (alive && 'context' in result) setPeek({ allowed: result.context.allowed, blocker: result.context.blocker }); },
      () => {},
    );
    return () => { alive = false; };
  }, [claimId, panelOpen]);
  async function open() { if (loading.current) return; loading.current = true; setPending(true); setError('');
    try { const result = await loadClaimTypeContextAction(claimId); if ('error' in result) setError(result.error); else if ('context' in result) setContext(result.context); }
    catch { setError(CLAIM_CHANGE_LOAD_FAILED_MESSAGE); } finally { loading.current = false; setPending(false); }
  }
  const blocked = peek !== null && !peek.allowed;
  return context ? <ClaimTypeConversionPanel embedded={embedded} initial={context} onClose={() => setContext(null)} /> : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="type-conversion">
    <button className={OUTLINE} data-slot="button" disabled={pending} type="button" onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : blocked ? '반품·교환 전환 이력' : '반품·교환 전환 및 이력'}</button>
    {blocked ? <p className="text-sm text-muted-foreground" data-claim-panel-blocked="type-conversion" role="status">{claimTypeError(undefined, peek?.blocker ?? '')}</p> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}
