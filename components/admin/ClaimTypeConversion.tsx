'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { convertClaimTypeAction, loadClaimTypeContextAction, readClaimTypeChangeAction } from '@/app/admin/claim-type-conversion-actions';
import { claimTypeError, claimTypeReceiptMatches, normalizeClaimTypeRequest, type ClaimTypeContext, type ClaimTypeRequest, type ClaimTypeReceipt } from '@/lib/orders/claim-type-conversion';
import { ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { formatOrderDateTime } from '@/lib/orders';
import { useClaimPreviewBusy } from '@/components/admin/screens/ClaimPreviewDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/* 템플릿 룩(ADR-0028). 입력은 네이티브 그대로이고(어휘 CSS가 kit 모양을 입힌다), 버튼은 kit 버튼 모양이다. */
const PRIMARY = buttonVariants({ size: 'sm' });
const OUTLINE = buttonVariants({ size: 'sm', variant: 'outline' });
const FIELD = 'flex min-w-0 flex-col gap-1.5';
const FIELD_LABEL = 'font-medium';

/** embedded: 목록 위 상세 팝업(R8)에서 열렸다. 전환 뒤에도 독립 상세가 아니라 전환된 유형의 목록 팝업으로 연다. */
export function ClaimTypeConversionPanel({ initial, onClose, embedded = false }: { initial: ClaimTypeContext; onClose: () => void; embedded?: boolean }) {
  const router = useRouter(); const [context, setContext] = useState(initial); const [agreement, setAgreement] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const [bankName, setBankName] = useState(''); const [accountNumber, setAccountNumber] = useState(''); const [accountHolder, setAccountHolder] = useState('');
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<ClaimTypeReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<ClaimTypeRequest | null>(null); const inFlight = useRef(false); const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useClaimPreviewBusy(pending); /* 목록 위 팝업(R8)에서 전환을 기다리는 동안 팝업이 닫히지 않게 한다. */
  const toType = context.claimType === 'return' ? 'exchange' : 'return'; const targetLabel = ORDER_CLAIM_TYPE_LABELS[toType]; const sourceLabel = ORDER_CLAIM_TYPE_LABELS[context.claimType];
  const locked = pending || uncertain || Boolean(receipt); const editable = () => !inFlight.current && !dispatched.current && !receipt;
  const accountRequired = toType === 'return' && context.bankRequired && !context.savedAccount;
  function accept(saved: ClaimTypeReceipt, request: ClaimTypeRequest) {
    if (!claimTypeReceiptMatches(saved, request) || saved.orderId !== context.orderId || saved.fromType !== context.claimType) { setError('현재 요청과 다른 저장 결과입니다. 같은 요청의 결과를 다시 확인해주세요.'); setUncertain(true); return; }
    dispatched.current = null; setReceipt(saved); setUncertain(false); setError(''); setMessage('');
    setBankName(''); setAccountNumber(''); setAccountHolder('');
    if (embedded) router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[saved.toType]}?claimId=${saved.claimId}`, { scroll: false });
    else router.replace(`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[saved.toType]}/${saved.claimId}`);
    router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || conflict && !uncertain) return;
    const request = normalizeClaimTypeRequest(dispatched.current ?? { id: crypto.randomUUID(), claimId: context.claimId, revision: context.revision,
      toType, agreement, confirmed, refundAccount: toType === 'return' ? { bankName, accountNumber, accountHolder } : null });
    if (!request) { setError('고객 합의 근거, 동의와 환불계좌 입력을 확인해주세요.'); return; }
    if (accountRequired && !request.refundAccount) { setError(claimTypeError(undefined, 'claim_conversion_account_required')); return; }
    const wasUncertain = uncertain; dispatched.current = request; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await convertClaimTypeAction(request);
      if ('error' in result) { const keep = wasUncertain || Boolean(result.uncertain); setUncertain(keep); setConflict(!keep && Boolean(result.conflict)); setError(result.error); if (!keep) dispatched.current = null; }
      else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return; inFlight.current = true; setPending(true); setError(''); setMessage('');
    try { const result = await readClaimTypeChangeAction(request.id); if ('error' in result) setError(result.error); else if ('receipt' in result && result.receipt) accept(result.receipt, request);
      else setMessage('확인된 저장 결과가 없습니다. 입력을 고정한 채 같은 요청을 재시도할 수 있습니다.'); }
    catch { setError('결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reload() {
    if (inFlight.current || dispatched.current) return; inFlight.current = true; setPending(true); setError('');
    try { const result = await loadClaimTypeContextAction(context.claimId); if ('error' in result) setError(result.error);
      else if ('context' in result && result.context.claimId === context.claimId && result.context.orderId === context.orderId) {
        setContext(result.context); setConflict(false); setConfirmed(false); setMessage('최신 요청을 읽었습니다. 입력은 보존했으며 전환할 유형과 고객 동의를 다시 확인해주세요.');
      } else setError('현재 요청의 상태를 읽지 못했습니다.'); }
    catch { setError('최신 요청을 읽지 못했습니다.'); } finally { inFlight.current = false; setPending(false); }
  }
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm break-words" aria-label="반품·교환 전환" data-claim-panel="type-conversion">
    <h3 className="text-base leading-snug font-medium">{sourceLabel} → {targetLabel} 전환</h3>
    <p>주문 전체의 요청 유형을 변경합니다. 기존 접수일, 수거 내역, 보류 사유와 배송비 기록은 유지됩니다. 배송비 차액은 고객과 별도로 확인해주세요.</p>
    {context.history.length ? <div className="flex flex-col gap-1.5"><h4 className="font-medium">유형 전환 이력</h4><ol className="flex flex-col gap-1.5 border-l pl-4">{context.history.map(row => <li key={row.id}><time className="text-muted-foreground tabular-nums" dateTime={row.createdAt}>{formatOrderDateTime(row.createdAt)}</time> · {ORDER_CLAIM_TYPE_LABELS[row.fromType]} → {ORDER_CLAIM_TYPE_LABELS[row.toType]}<p className="text-muted-foreground">{row.agreement}</p></li>)}</ol></div> : null}
    {receipt ? <p role="status">{targetLabel} 요청으로 전환했습니다. 전환된 요청 화면을 열고 있습니다.</p> : !context.allowed ? <p className="text-muted-foreground" role="status">{claimTypeError(undefined, context.blocker ?? '')}</p> : <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}><legend className="mb-1 font-medium">고객 합의 확인</legend>
        <label className={FIELD}><span className={FIELD_LABEL}>고객 합의 근거</span><input className="w-full" value={agreement} minLength={2} maxLength={500} required placeholder="상담 일시, 참조번호와 합의한 내용을 적어주세요." onChange={event => { if (editable()) setAgreement(event.target.value); }} /></label>
        {toType === 'return' ? <>
          {context.savedAccount ? <p>저장된 환불계좌: {context.savedAccount.account} · {context.savedAccount.holder}. 변경할 때만 아래 세 항목을 모두 입력해주세요.</p> : <p className="text-muted-foreground">{accountRequired ? '무통장 주문은 환불계좌가 필요합니다.' : '계좌 환급을 협의한 경우에만 환불계좌를 입력해주세요.'}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={FIELD}><span className={FIELD_LABEL}>은행명</span><input autoComplete="off" className="w-full" value={bankName} maxLength={40} required={accountRequired} onChange={event => { if (editable()) setBankName(event.target.value); }} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>환불계좌번호</span><input autoComplete="off" className="w-full" inputMode="numeric" value={accountNumber} maxLength={30} required={accountRequired} onChange={event => { if (editable()) setAccountNumber(event.target.value); }} /></label>
            <label className={FIELD}><span className={FIELD_LABEL}>예금주</span><input autoComplete="off" className="w-full" value={accountHolder} maxLength={40} required={accountRequired} onChange={event => { if (editable()) setAccountHolder(event.target.value); }} /></label>
          </div>
        </> : null}
        <label className="flex items-start gap-2 leading-relaxed"><input className="mt-0.5" type="checkbox" checked={confirmed} required onChange={event => { if (editable()) setConfirmed(event.target.checked); }} /><span>고객과 {targetLabel} 전환 및 배송비 처리에 합의했습니다.</span></label>
      </fieldset>
      <div className="flex flex-wrap gap-2">{uncertain ? <><button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void readback(); }}>같은 요청 결과 확인</button><button className={OUTLINE} data-slot="button" type="button" disabled={pending} onClick={() => { void save(); }}>같은 내용으로 재시도</button></>
        : conflict ? <button className={PRIMARY} data-slot="button" type="button" disabled={pending} onClick={() => { void reload(); }}>최신 요청 상태 확인</button>
          : <button className={PRIMARY} data-slot="button" type="submit" disabled={pending || !confirmed}>{pending ? '처리 중…' : `${targetLabel} 전환 확정`}</button>}</div>
    </form>}
    {error ? <p className="text-destructive outline-none" role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}{message ? <p className="text-muted-foreground" role="status">{message}</p> : null}
    <button className={`${OUTLINE} w-fit`} data-slot="button" type="button" disabled={pending || uncertain} onClick={() => { if (!inFlight.current && !dispatched.current) onClose(); }}>닫기</button>
  </section>;
}
export function ClaimTypeConversion({ claimId, embedded = false }: { claimId: string; embedded?: boolean }) {
  const [context, setContext] = useState<ClaimTypeContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const loading = useRef(false);
  async function open() { if (loading.current) return; loading.current = true; setPending(true); setError('');
    try { const result = await loadClaimTypeContextAction(claimId); if ('error' in result) setError(result.error); else if ('context' in result) setContext(result.context); }
    catch { setError('최신 요청을 읽지 못했습니다.'); } finally { loading.current = false; setPending(false); }
  }
  return context ? <ClaimTypeConversionPanel embedded={embedded} initial={context} onClose={() => setContext(null)} /> : <div className="flex min-w-0 flex-col items-start gap-2" data-claim-panel-entry="type-conversion"><button className={OUTLINE} data-slot="button" disabled={pending} type="button" onClick={() => { void open(); }}>{pending ? '요청 확인 중…' : '반품·교환 전환 및 이력'}</button>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}</div>;
}
