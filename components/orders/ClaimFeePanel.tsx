'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimContactSession, type ClaimContactIdentity, type ClaimContactScope } from '@/components/claim-contact/ClaimContactSession';
import { changeClaimFeeAction, readClaimFeesAction, readOrderClaimFeesAction } from '@/app/orders/claim-fee-actions';
import { CLAIM_FEE_ACTIONS, CLAIM_FEE_POLICY_PATH, CLAIM_FEE_STATES, normalizeClaimFeeValues, type ClaimFeeDocument, type ClaimFeeInvoice, type ClaimFeeKind, type ClaimFeeValues } from '@/lib/orders/claim-fees';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
type Props = { actorId: string; claimId: string; operator?: boolean };
type Request = { invoiceId: string | null; kind: ClaimFeeKind; values: ClaimFeeValues; revision: number; claimRevision: number; operationId: string };
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
function FeePanel({ claimId, operator = false, initial = null, identity, scope }: Props & { initial?: ClaimFeeDocument | null; identity: ClaimContactIdentity; scope: ClaimContactScope }) {
 const router = useRouter(), alive = useRef(true), busy = useRef(false), dispatched = useRef<Request | null>(null);
 const [document, setDocument] = useState<ClaimFeeDocument | null>(initial), [selected, setSelected] = useState<{ kind: ClaimFeeKind; invoice: ClaimFeeInvoice | null } | null>(null);
 const [amount, setAmount] = useState(''), [payerRole, setPayerRole] = useState<'buyer' | 'requester'>('buyer'), [customerNote, setCustomerNote] = useState(''), [evidence, setEvidence] = useState(''), [occurredAt, setOccurredAt] = useState(''), [confirmed, setConfirmed] = useState(false);
 const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 async function read() {
  if (busy.current) return; const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; setPending(true); setError('');
  try { const result = await readClaimFeesAction(claimId, identity, operator);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) setError(result.error ?? '청구 내역을 읽지 못했습니다.'); else { setDocument(result.document); if (!dispatched.current) setSelected(null); }
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
  const kind = selected.kind, values = normalizeClaimFeeValues(kind, kind === 'issue' ? { amount: Number(amount), payerRole, customerNote, evidence, confirmed }
   : kind === 'confirm_payment' || kind === 'refund' ? { amount: Number(amount), occurredAt: occurredAt && Number.isFinite(Date.parse(occurredAt)) ? new Date(occurredAt).toISOString() : '', evidence, confirmed }
   : kind === 'report_payment' ? { confirmed } : { evidence, confirmed });
  const request = dispatched.current ?? (values ? { invoiceId: selected.invoice?.id ?? null, kind, values, revision: document.revision, claimRevision: document.claimRevision, operationId: crypto.randomUUID() } : null);
  if (!request) { setError('금액·근거·처리시각·확인 항목을 입력해주세요.'); return; }
  const ticket = scope.capture(); if (!ticket) return;
  busy.current = true; dispatched.current = request; setPending(true); setError(''); setMessage('');
  try { const result = await changeClaimFeeAction(claimId, request.invoiceId, request.kind, request.values, request.revision, request.claimRevision, request.operationId, identity);
   if (!alive.current || !scope.canApply(ticket)) return;
   if ('error' in result) { setError(result.error ?? '처리 결과를 확인하지 못했습니다.'); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) dispatched.current = null; }
   else { setDocument(result.document); setSelected(null); setUncertain(false); dispatched.current = null; setMessage(`${CLAIM_FEE_ACTIONS[request.kind]} 내용을 저장했습니다.`); router.refresh(); }
  } catch { if (alive.current && scope.canApply(ticket)) { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청으로 결과를 확인해주세요.'); } }
  finally { busy.current = false; if (alive.current) setPending(false); }
 }
 return <section className="claim-fees" aria-label="반품 교환 배송비">
  <h3>반품·교환 배송비</h3>
  <p>{operator ? '고객과 합의한 배송비를 별도로 청구합니다. 원 주문 환불액에서는 차감하지 않습니다. 입금·반환은 실제 거래 내역을 확인한 뒤 기록해주세요.' : '합의된 배송비 청구 내역입니다. 입금 알림 후 판매자가 실제 입금을 확인합니다. 주문 환불과 배송비 반환은 각각 확인해주세요.'}</p>
  <div className="claim-fees__actions"><button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void read(); }}>배송비 청구 내역 확인</button>{operator ? <><Link href={CLAIM_FEE_POLICY_PATH}>배송비 청구 정책</Link><Link href="/admin/sales/claims/returns/fees">입금·반환 목록</Link></> : null}</div>
  {document && !document.invoices.length ? <p>청구 내역이 없습니다.</p> : null}
  {operator && document && !document.policy?.enabled ? <p>새 배송비 청구가 꺼져 있습니다. 기존 청구의 입금 확인·취소·반환은 계속 처리할 수 있습니다.</p> : null}
  {document?.invoices.map(invoice => <div className="claim-fees__invoice" key={invoice.id}>
   <strong>{krw(invoice.amount)} · {CLAIM_FEE_STATES[invoice.state]}</strong><p>{invoice.customerNote}</p>
   {operator ? <p>납부 대상: {invoice.payerRole === 'buyer' ? '원 주문 구매자' : '반품·교환 요청자'} · 합의 근거: {invoice.agreementEvidence}</p> : null}
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
  {operator && document?.canIssue ? <button className="btn btn-sm" disabled={pending || uncertain} type="button" onClick={() => edit('issue')}>새 배송비 청구</button> : null}
  {selected ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={pending || uncertain}>
   <legend>{CLAIM_FEE_ACTIONS[selected.kind]}</legend>
   {['issue', 'confirm_payment', 'refund'].includes(selected.kind) ? <label>배송비 금액 (원)<input type="number" min={1} max={1000000} step={1} required readOnly={selected.kind !== 'issue'} value={amount} onChange={e => setAmount(e.target.value)} /></label> : null}
   {selected.kind === 'issue' ? <><label>납부 대상<select value={payerRole} onChange={e => setPayerRole(e.target.value as 'buyer' | 'requester')}><option value="buyer">원 주문 구매자</option><option value="requester">반품·교환 요청자</option></select></label>
    <label>고객 안내<textarea rows={2} required minLength={2} maxLength={500} value={customerNote} onChange={e => setCustomerNote(e.target.value)} placeholder="배송비 산정 내역과 납부 안내" /></label></> : null}
   {['confirm_payment', 'refund'].includes(selected.kind) ? <label>실제 입금·반환 시각<input type="datetime-local" required value={occurredAt} onChange={e => setOccurredAt(e.target.value)} /></label> : null}
   {operator ? <label>{selected.kind === 'issue' ? '금액·납부 대상에 대한 고객 합의 근거' : '거래 확인·처리 근거'}<textarea rows={2} required minLength={2} maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="거래 참조번호·상담 기록. 고객 계좌번호 등 개인정보는 입력하지 마세요." /></label> : null}
   <label className="claim-fees__check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{selected.kind === 'issue' ? '고객과 금액·납부 대상을 합의했습니다.' : selected.kind === 'report_payment' ? '안내된 계좌로 표시된 금액을 입금했습니다.' : selected.kind === 'confirm_payment' || selected.kind === 'refund' ? '표시된 금액 전액의 실제 입금·반환 내역을 확인했습니다.' : '청구 취소·면제 근거를 확인했습니다.'}</label>
  </fieldset><button className="btn btn-sm" type="submit" disabled={pending}>{uncertain ? '같은 요청으로 저장 결과 확인' : `${CLAIM_FEE_ACTIONS[selected.kind]} 저장`}</button></form> : null}
  {document?.history.length ? <details><summary>배송비 처리 이력 {document.history.length}건</summary><ol>{document.history.map(e => <li key={e.id}>{formatOrderDateTime(e.at)} · {CLAIM_FEE_ACTIONS[e.kind]}{operator && e.evidence ? <p>{e.evidence}</p> : null}</li>)}</ol></details> : null}
  {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
 </section>;
}
