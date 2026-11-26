'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeClaimFeeAction, readClaimFeesAction, readOrderClaimFeesAction } from '@/app/orders/claim-fee-actions';
import { CLAIM_FEE_ACTIONS, CLAIM_FEE_POLICY_PATH, CLAIM_FEE_STATES, normalizeClaimFeeValues, type ClaimFeeDocument, type ClaimFeeInvoice, type ClaimFeeKind, type ClaimFeeValues } from '@/lib/orders/claim-fees';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
/* 아래 셋은 운영자 분기(operator)만 쓴다. 고객 화면의 글자와 동작은 이 값들에 닿지 않는다. */
import { adminConfirm } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { CLAIM_FEE_ACTION_INPUT_ERROR, CLAIM_FEE_ISSUE_LABEL, CLAIM_FEE_LIST_LABEL, CLAIM_FEE_MODE_LABELS, CLAIM_FEE_PAYER_LABEL, CLAIM_FEE_PAYER_LABELS, CLAIM_FEE_SETTINGS_LABEL, CLAIM_FEES_PATH, adminClaimFeeErrorCopy, claimFeeActionConfirm } from '@/lib/admin/claim-fees';
type Props = {
 actorId: string; claimId: string; operator?: boolean;
 /** 운영 화면: 반품배송비 차감(ADR-0031) 판정·결정이 있을 때의 안내(returnFeeDeductionFeePanelNote). 없으면 '환불액에서 차감하지 않음' 문구 그대로다. */
 deductionNote?: string | null;
};
type Request = { invoiceId: string | null; kind: ClaimFeeKind; values: ClaimFeeValues; revision: number; claimRevision: number; operationId: string };
/* 운영자 양식의 근거 칸(저장 함수가 2자 이상을 요구한다). 이름은 무엇을 적는지, 예시는 실제로 적을 만한 한 줄이다. 운영자의 이 칸과 처리 이력에만 보인다. */
const OPERATOR_EVIDENCE: Record<Exclude<ClaimFeeKind, 'report_payment'>, { label: string; example: string }> = {
 issue: { label: '고객과 합의한 내용 (필수)', example: '예: 11/26 전화로 왕복 배송비 6,000원 입금에 동의' },
 confirm_payment: { label: '입금 확인 근거 (필수)', example: '예: 11/26 14:02 통장 입금 확인, 거래 일련번호 0123' },
 waive: { label: '면제 사유 (필수)', example: '예: 고객과 다시 합의해 받지 않기로 함' },
 cancel: { label: '취소 사유 (필수)', example: '예: 금액을 잘못 청구해 다시 청구함' },
 refund: { label: '반환 근거 (필수)', example: '예: 11/27 10:15 이체 완료, 이체 확인증 번호 0456' },
};
export function ClaimFeePanel(props: Props) {
 return <ClaimContactSession actorId={props.actorId}>{(identity, scope) => <FeePanel key={`${props.claimId}:${identity.sessionId}`} {...props} identity={identity} scope={scope} />}</ClaimContactSession>;
}
export function OrderClaimFees({ actorId, orderId }: { actorId: string; orderId: string }) {
 return <ClaimContactSession actorId={actorId}>{(identity, scope) => <OrderFees key={`${orderId}:${identity.sessionId}`} actorId={actorId} orderId={orderId} identity={identity} scope={scope} />}</ClaimContactSession>;
}
function OrderFees({ actorId, orderId, identity, scope }: { actorId: string; orderId: string; identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const [documents, setDocuments] = useState<ClaimFeeDocument[] | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
 const busy = useRef(false), alive = useRef(true);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; setPending(true); setError('');
  try { const result = await readOrderClaimFeesAction(orderId, identity); if (!alive.current || !scope.canApply(ticket)) return;
   if ('documents' in result && result.documents) setDocuments(result.documents); else setError(result.error ?? '청구 이력을 읽지 못했습니다.');
  } catch { if (alive.current && scope.canApply(ticket)) setError('청구 이력을 읽지 못했습니다.'); }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <section className="claim-fees" aria-label="주문 전체 배송비 청구 이력"><h3>반품·교환 배송비 청구 이력</h3><p>종료된 요청을 포함해 본인에게 청구된 내역과 배송비 반환 상태를 확인합니다.</p>
  <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void read(); }}>주문 전체 배송비 청구 조회</button>
  {documents?.length === 0 ? <p>본인에게 청구된 배송비가 없습니다.</p> : null}{documents?.map(d => <FeePanel key={`${d.claimId}:${d.revision}`} actorId={actorId} claimId={d.claimId} initial={d} identity={identity} scope={scope} />)}
  {error ? <p role="alert">{error}</p> : null}</section>;
}
function FeePanel({ claimId, operator = false, deductionNote = null, initial = null, identity, scope }: Props & { initial?: ClaimFeeDocument | null; identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const router = useRouter(), alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
 const [document, setDocument] = useState<ClaimFeeDocument | null>(initial), [selected, setSelected] = useState<{ kind: ClaimFeeKind; invoice: ClaimFeeInvoice | null } | null>(null);
 const [amount, setAmount] = useState(''), [payerRole, setPayerRole] = useState<'buyer' | 'requester'>('buyer'), [customerNote, setCustomerNote] = useState(''), [evidence, setEvidence] = useState(''), [occurredAt, setOccurredAt] = useState(''), [confirmed, setConfirmed] = useState(false);
 const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 useClaimPreviewBusy(pending); /* 목록 위 클레임 팝업(R8)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; setPending(true); setError('');
  try { const result = await readClaimFeesAction(claimId, identity, operator);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) setError(operator ? adminClaimFeeErrorCopy(result.error ?? '청구 내역을 읽지 못했습니다.') : result.error ?? '청구 내역을 읽지 못했습니다.'); else { setDocument(result.document); if (!dispatched.current) setSelected(null); }
  } catch { if (alive.current && scope.canApply(ticket)) setError('청구 내역을 읽지 못했습니다. 다시 확인해주세요.'); }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 function edit(kind: ClaimFeeKind, invoice: ClaimFeeInvoice | null = null) {
  if (busy.current || uncertain) return;
  setSelected({ kind, invoice }); setAmount(invoice ? String(invoice.amount) : String((document?.claimType === 'exchange' ? document?.policy?.exchangeAmount : document?.policy?.returnAmount) ?? ''));
  setPayerRole('buyer'); setCustomerNote(''); setEvidence(''); setOccurredAt(''); setConfirmed(false); setMessage(''); setError('');
 }
 async function save() {
  if (busy.current || !document || !selected) return;
  /* 운영자 양식에는 확인 체크가 없다 — 저장 전 확인창이 같은 사실을 금액과 함께 묻는다. 고객의 [입금했어요]는 체크 그대로다. */
  const kind = selected.kind, checked = operator ? true : confirmed, values = normalizeClaimFeeValues(kind, kind === 'issue' ? { amount: Number(amount), payerRole, customerNote, evidence, confirmed: checked }
   : kind === 'confirm_payment' || kind === 'refund' ? { amount: Number(amount), occurredAt: occurredAt && Number.isFinite(Date.parse(occurredAt)) ? new Date(occurredAt).toISOString() : '', evidence, confirmed: checked }
   : kind === 'report_payment' ? { confirmed } : { evidence, confirmed: checked });
  const request = dispatched.current ?? (values ? { invoiceId: selected.invoice?.id ?? null, kind, values, revision: document.revision, claimRevision: document.claimRevision, operationId: crypto.randomUUID() } : null);
  if (!request) { setError(operator ? CLAIM_FEE_ACTION_INPUT_ERROR : '금액·근거·처리시각·확인 항목을 입력해주세요.'); return; }
  const ticket = scope.capture(); if (!ticket) return;
  busy.current = true;
  if (operator && !dispatched.current && request.kind !== 'report_payment') {
   /* 같은 내용을 다시 보내는 [저장됐는지 확인]은 이미 확인한 것이라 다시 묻지 않는다. 금액은 저장에 보내는 값(청구) 또는 고치는 청구 건의 금액이다. */
   let ok = false;
   try { ok = await adminConfirm(claimFeeActionConfirm(request.kind, { amount: request.values.amount ?? selected.invoice?.amount ?? 0, payerRole: request.values.payerRole, state: selected.invoice?.state })); } catch { ok = false; }
   if (!ok || !alive.current || !scope.canApply(ticket)) { busy.current = false; return; }
  }
  dispatched.current = request; setPending(true); setError(''); setMessage('');
  try { const result = await changeClaimFeeAction(claimId, request.invoiceId, request.kind, request.values, request.revision, request.claimRevision, request.operationId, identity);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) { setError(operator ? adminClaimFeeErrorCopy(result.error ?? SAVE_UNKNOWN_MESSAGE) : result.error ?? '처리 결과를 확인하지 못했습니다.'); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) dispatched.current = null; }
   else { setDocument(result.document); setSelected(null); setUncertain(false); dispatched.current = null; setMessage(`${CLAIM_FEE_ACTIONS[request.kind]} 내용을 저장했습니다.`); router.refresh(); }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setError(operator ? SAVE_UNKNOWN_MESSAGE : '저장 결과가 불확실합니다. 같은 요청으로 결과를 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <section className="claim-fees" aria-label="반품 교환 배송비">
  <h3>반품·교환 배송비</h3>
  <p>{operator ? `고객과 합의한 배송비를 주문 환불과 따로 입금받습니다. ${deductionNote ?? '주문 환불 금액에서는 빼지 않습니다.'}` : '합의된 배송비 청구 내역입니다. 입금 알림 후 판매자가 실제 입금을 확인합니다. 주문 환불과 배송비 반환은 각각 확인해주세요.'}</p>
  <div className="claim-fees__actions"><button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void read(); }}>배송비 청구 내역 확인</button>{operator ? <><Link href={CLAIM_FEE_POLICY_PATH}>{CLAIM_FEE_SETTINGS_LABEL}</Link><Link href={CLAIM_FEES_PATH}>{CLAIM_FEE_LIST_LABEL}</Link></> : null}</div>
  {document && !document.invoices.length ? <p>청구 내역이 없습니다.</p> : null}
  {operator && document && !document.policy?.enabled ? <p>[{CLAIM_FEE_SETTINGS_LABEL}]이 &lsquo;{CLAIM_FEE_MODE_LABELS.off}&rsquo;이라 새로 청구할 수 없습니다. 이미 청구한 건의 입금 확인·취소·반환은 계속 할 수 있습니다.</p> : null}
  {document?.invoices.map(invoice => <div className="claim-fees__invoice" key={invoice.id}>
   <strong>{krw(invoice.amount)} · {CLAIM_FEE_STATES[invoice.state]}</strong><p>{invoice.customerNote}</p>
   {operator ? <p>{CLAIM_FEE_PAYER_LABEL}: {CLAIM_FEE_PAYER_LABELS[invoice.payerRole]} · 합의한 내용: {invoice.agreementEvidence}</p> : null}
   <p>청구 {formatOrderDateTime(invoice.issuedAt)}{invoice.receivedAt ? ` · 입금 확인 ${formatOrderDateTime(invoice.receivedAt)}` : ''}{invoice.refundedAt ? ` · 반환 ${formatOrderDateTime(invoice.refundedAt)}` : ''}</p>
   {invoice.bankAccount ? <p>입금 계좌: {invoice.bankAccount.bank} {invoice.bankAccount.accountNumber} · {invoice.bankAccount.holder}</p> : null}
   <div className="claim-fees__actions">
    {!operator && invoice.state === 'unpaid' ? <button className="btn btn-sm" type="button" disabled={pending || uncertain} onClick={() => edit('report_payment', invoice)}>입금했어요</button> : null}
    {operator ? <>
     {['unpaid', 'reported', 'voided', 'waived'].includes(invoice.state) ? <button className="btn btn-sm" type="button" disabled={pending || uncertain} onClick={() => edit('confirm_payment', invoice)}>{['voided', 'waived'].includes(invoice.state) ? '취소 후 입금 확인 · 반환 대기' : '실제 입금 확인'}</button> : null}
     {['unpaid', 'reported'].includes(invoice.state) ? <button className="btn btn-sm btn-ghost" type="button" disabled={pending || uncertain} onClick={() => edit('waive', invoice)}>청구 면제</button> : null}
     {['unpaid', 'reported', 'paid'].includes(invoice.state) ? <button className="btn btn-sm btn-ghost" type="button" disabled={pending || uncertain} onClick={() => edit('cancel', invoice)}>{invoice.state === 'paid' ? '청구 취소 · 반환 대기' : '청구 취소'}</button> : null}
     {invoice.state === 'refund_due' ? <button className="btn btn-sm" type="button" disabled={pending || uncertain} onClick={() => edit('refund', invoice)}>실제 반환 완료</button> : null}
    </> : null}
   </div>
  </div>)}
  {operator && document?.canIssue ? <button className="btn btn-sm" disabled={pending || uncertain} type="button" onClick={() => edit('issue')}>{CLAIM_FEE_ISSUE_LABEL}</button> : null}
  {selected ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}>
   <legend>{CLAIM_FEE_ACTIONS[selected.kind]}</legend>
   {['issue', 'confirm_payment', 'refund'].includes(selected.kind) ? <label>배송비 금액 (원)<input type="number" min={1} max={1000000} step={1} required readOnly={selected.kind !== 'issue'} value={amount} onChange={e => setAmount(e.target.value)} /></label> : null}
   {selected.kind === 'issue' ? <><label>{CLAIM_FEE_PAYER_LABEL}<select value={payerRole} onChange={e => setPayerRole(e.target.value as 'buyer' | 'requester')}><option value="buyer">{CLAIM_FEE_PAYER_LABELS.buyer}</option><option value="requester">{CLAIM_FEE_PAYER_LABELS.requester}</option></select></label>
    <label>고객 안내 (필수)<textarea rows={2} required minLength={2} maxLength={500} value={customerNote} onChange={e => setCustomerNote(e.target.value)} placeholder="예: 단순 변심 반품의 왕복 배송비 6,000원입니다. 아래 계좌로 입금해 주세요." /><small>고객 화면의 배송비 청구 내역에 그대로 보입니다.</small></label></> : null}
   {['confirm_payment', 'refund'].includes(selected.kind) ? <label>{selected.kind === 'refund' ? '실제 반환한 시각 (KST)' : '실제 입금된 시각 (KST)'}<input type="datetime-local" required value={occurredAt} onChange={e => setOccurredAt(e.target.value)} /></label> : null}
   {operator && selected.kind !== 'report_payment' ? <label>{OPERATOR_EVIDENCE[selected.kind].label}<textarea rows={2} required minLength={2} maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder={OPERATOR_EVIDENCE[selected.kind].example} /><small>운영자에게만 보입니다. 고객의 계좌번호·연락처는 적지 마세요.</small></label> : null}
   {/* 확인 체크는 고객의 [입금했어요]에만 있다(고객이 고를 수 있는 동작은 이것 하나다). */}
   {operator ? null : <label className="claim-fees__check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />안내된 계좌로 표시된 금액을 입금했습니다.</label>}
  </fieldset><button className="btn btn-sm" type="submit" disabled={pending}>{uncertain ? operator ? SAVE_CHECK_LABEL : '같은 요청으로 저장 결과 확인' : `${CLAIM_FEE_ACTIONS[selected.kind]} 저장`}</button></form> : null}
  {document?.history.length ? <details><summary>배송비 처리 이력 {document.history.length}건</summary><ol>{document.history.map(e => <li key={e.id}>{formatOrderDateTime(e.at)} · {CLAIM_FEE_ACTIONS[e.kind]}{operator && e.evidence ? <p>{e.evidence}</p> : null}</li>)}</ol></details> : null}
  {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
 </section>;
}
