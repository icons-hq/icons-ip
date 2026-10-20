'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadSellerClaimContextAction, readSellerClaimIntakeAction, submitSellerClaimIntakeAction } from '@/app/admin/seller-claim-intake-actions';
import { SELLER_CLAIM_COLLECTION_METHODS, SELLER_CLAIM_SOURCES, sellerClaimBlockMessage, sellerClaimReceiptHref,
  sellerClaimReceiptMatchesInput,
  type SellerClaimAddress, type SellerClaimContext, type SellerClaimInput, type SellerClaimReceipt } from '@/lib/admin/seller-claim-intake';
import { formatOrderDateTime, ORDER_WITHDRAWAL_REASON_LABELS, orderReferenceLabel } from '@/lib/orders';
import { ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_SLUGS, ORDER_CLAIM_TYPE_LABELS } from '@/lib/orders/claims';
import { selectableShippingCarriers, type ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { formatKrwExact } from '@/components/admin/format';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const ADDRESS_FIELDS: { key: keyof SellerClaimAddress; label: string; max: number }[] = [
  { key: 'recipientName', label: '수거지 이름', max: 50 }, { key: 'phone', label: '수거지 연락처', max: 20 },
  { key: 'postalCode', label: '수거지 우편번호', max: 5 }, { key: 'address1', label: '수거지 기본 주소', max: 200 }, { key: 'address2', label: '수거지 상세 주소', max: 200 },
];

export function SellerClaimIntakeForm({ context, carriers, onClose }: {
  context: SellerClaimContext; carriers: ShippingCarrierRegistry; onClose: () => void;
}) {
  const router = useRouter();
  const cancellation = context.orderStatus === 'pending' || context.orderStatus === 'paid'
    || context.digitalExchangeBlocked && context.cancelBlockedReason === null;
  const [input, setInput] = useState<SellerClaimInput>(() => ({ requestId: crypto.randomUUID(), orderId: context.orderId,
    claimType: cancellation ? 'cancel' : 'return', reasonType: 'change_of_mind', reason: '', source: 'phone', inquiryId: null,
    customerRequestedAt: '', agreementEvidence: '', agreementConfirmed: false, collectionAddress: cancellation ? null : context.address,
    collections: cancellation ? [] : context.collections.map(target => ({ shipmentId: target.shipmentId, method: 'not_requested', carrier: null, trackingNumber: null, note: '' })), refundAccount: null }));
  const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [receipt, setReceipt] = useState<SellerClaimReceipt | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dispatched = useRef<SellerClaimInput | null>(null);
  const busy = useRef(false);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const blocked = sellerClaimBlockMessage(input.claimType === 'exchange' && context.digitalExchangeBlocked ? 'digital_exchange_unavailable'
    : input.claimType === 'cancel' ? context.cancelBlockedReason : context.blockedReasons[input.reasonType]);
  const claimLabel = ORDER_CLAIM_TYPE_LABELS[input.claimType];
  const locked = pending || uncertain || Boolean(receipt);
  const close = () => { if (!busy.current && !dispatched.current) onClose(); };
  const update = (next: Partial<SellerClaimInput>) => {
    if (busy.current || dispatched.current || receipt) return;
    setInput(previous => ({ ...previous, ...next })); setError(''); setMessage('');
  };
  const change = <K extends keyof SellerClaimInput>(key: K, value: SellerClaimInput[K]) => update({ [key]: value });
  function acceptReceipt(saved: SellerClaimReceipt, original: SellerClaimInput) {
    if (!sellerClaimReceiptMatchesInput(saved, original)) {
      setUncertain(true); setError('접수 결과와 처음 전송한 내용이 일치하지 않습니다. 담당자에게 확인해주세요.'); return;
    }
    dispatched.current = null; setReceipt(saved); setUncertain(false);
    setInput(previous => ({ ...previous, refundAccount: null })); router.refresh();
  }
  async function submit(retry = false) {
    if (busy.current || receipt || (dispatched.current && !retry) || (uncertain ? !retry : Boolean(blocked))) return;
    const original = dispatched.current ?? structuredClone(input);
    dispatched.current = original; busy.current = true;
    const wasUncertain = uncertain;
    setPending(true); setError(''); setMessage('');
    try {
      const result = await submitSellerClaimIntakeAction(original);
      if ('error' in result) {
        setError(result.error);
        if (wasUncertain || result.uncertain) setUncertain(true);
        else {
          // A definite first-attempt rejection may be edited, under a fresh key.
          dispatched.current = null; setInput(previous => ({ ...previous, requestId: crypto.randomUUID() }));
        }
      } else acceptReceipt(result.receipt, original);
    } catch { setUncertain(true); setError('접수 결과가 불확실합니다. 같은 요청의 저장 결과부터 확인해주세요.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function readback() {
    const original = dispatched.current;
    if (busy.current || !original) return;
    busy.current = true;
    setPending(true); setError(''); setMessage('');
    try {
      const result = await readSellerClaimIntakeAction(original);
      if ('error' in result) { setError(result.error); return; }
      if (result.receipt) acceptReceipt(result.receipt, original);
      else setMessage('아직 저장된 접수를 확인하지 못했습니다. 처음 전송한 내용을 보존하며, 같은 내용으로 다시 접수할 수 있습니다.');
    } catch { setError('접수 결과를 확인하지 못했습니다. 같은 요청을 다시 조회해주세요.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <CustomerServiceDialog title={cancellation ? "판매자 직접 취소 접수" : "판매자 직접 반품·교환 접수"} onClose={close} busy={pending || uncertain} wide>
    <div className="admin-seller-claim-intake">
      <div className="admin-seller-claim-intake__order">
        <strong>주문 {orderReferenceLabel(context.orderId)} · {context.buyerName || '고객'}</strong>
        <span>주문 전체 {formatKrwExact(context.orderTotal)} · 최초 배송비 포함 전액 기준</span>
        <small>{context.digitalExchangeBlocked ? '디지털 파일 포함 · 재다운로드 및 문의·취소·환불 심사' : cancellation ? '발주확인·출고지시서 출력 전 주문' : context.deliveredAt ? `원주문 배송완료 ${formatOrderDateTime(context.deliveredAt)}` : context.orderStatus === 'shipping' ? '배송 중 접수 · 전체 실물 회수 후 환불/재배송' : '배송 상태 확인 필요'}</small>
      </div>
      <p>{cancellation ? '고객과 확인한 주문 전체의 취소 요청을 접수합니다. 승인과 결제 취소·환급은 접수 후 별도로 진행합니다.' : '고객과 확인한 주문 전체의 요청을 접수합니다. 승인·수거완료·환급·재배송은 접수 후 별도로 진행합니다.'}</p>
      {receipt ? <div className="admin-seller-claim-intake__result" role="status">
        <h3>{ORDER_CLAIM_TYPE_LABELS[receipt.claimType]} 요청을 저장했습니다.</h3>
        <p>접수번호 #{receipt.reference} · 현재 단계 {ORDER_CLAIM_STAGE_LABELS[receipt.stage]}</p>
        <p>접수 시각 {formatOrderDateTime(receipt.requestedAt)} · 담당자 {receipt.actorName || receipt.actorId}</p>
        <Link className="btn" href={sellerClaimReceiptHref(receipt)}>접수 내용과 후속 처리 열기</Link>
        <button className="btn btn-ghost" type="button" onClick={close}>닫기</button>
      </div> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={locked}>
          <legend>요청 내용</legend>
          <div className="admin-seller-claim-intake__fields">
            <label htmlFor="seller-claim-type">접수 유형<select id="seller-claim-type" value={input.claimType} onChange={event => update({ claimType: event.target.value as SellerClaimInput['claimType'], refundAccount: null, agreementConfirmed: false })}>{cancellation ? <option value="cancel">취소 · 주문 전체</option> : <><option value="return">반품 · 주문 전체</option>{!context.digitalExchangeBlocked ? <option value="exchange">교환 · 주문 전체</option> : null}</>}</select></label>
            <label htmlFor="seller-claim-reason-type">신청 사유 구분<select id="seller-claim-reason-type" value={input.reasonType} onChange={event => change('reasonType', event.target.value as SellerClaimInput['reasonType'])}>{Object.entries(ORDER_WITHDRAWAL_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{adminGoodsCopy(label)}</option>)}</select></label>
            <label className="admin-seller-claim-intake__wide" htmlFor="seller-claim-reason">접수 사유<textarea id="seller-claim-reason" required maxLength={200} rows={3} value={input.reason} onChange={event => change('reason', event.target.value)} /></label>
          </div>
          {blocked ? <p className="admin-seller-claim-intake__error" role="status">{blocked}</p> : null}
          {context.activeClaim ? <Link href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[context.activeClaim.claimType]}/${context.activeClaim.id}`}>현재 진행 중인 요청 열기</Link> : null}
        </fieldset>
        <fieldset disabled={locked}>
          <legend>고객 요청 확인</legend>
          <div className="admin-seller-claim-intake__fields">
            <label htmlFor="seller-claim-source">요청을 확인한 경로<select id="seller-claim-source" value={input.source} onChange={event => update({ source: event.target.value as SellerClaimInput['source'], inquiryId: null })}>{SELLER_CLAIM_SOURCES.map(source => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>
            <label htmlFor="seller-claim-customer-time">고객 요청 시각 (한국 시간)<input id="seller-claim-customer-time" type="datetime-local" required value={input.customerRequestedAt} onChange={event => change('customerRequestedAt', event.target.value)} /></label>
            {input.source === 'inquiry' ? <label className="admin-seller-claim-intake__wide" htmlFor="seller-claim-inquiry">이 주문에 연결된 고객문의<select id="seller-claim-inquiry" required value={input.inquiryId ?? ''} onChange={event => change('inquiryId', event.target.value || null)}><option value="">고객문의를 선택해주세요</option>{context.inquiries.map(inquiry => <option key={inquiry.id} value={inquiry.id}>#{inquiry.reference} · {inquiry.title}</option>)}</select>{!context.inquiries.length ? <small>이 주문과 구매자가 일치하는 문의가 없습니다. 실제 확인한 다른 경로를 선택해주세요.</small> : null}</label> : null}
            <label className="admin-seller-claim-intake__wide" htmlFor="seller-claim-evidence">고객 합의 근거<textarea id="seller-claim-evidence" required maxLength={1000} rows={3} value={input.agreementEvidence} onChange={event => change('agreementEvidence', event.target.value)} placeholder="상담 참조번호와 고객이 동의한 주문 전체 처리 내용을 적어주세요." /></label>
          </div>
          <p className="faint">고객 요청 시각은 근거로 보관합니다. 실제 접수 시각과 신청 기한을 소급하지 않습니다.</p>
        </fieldset>
        {input.claimType !== 'cancel' ? <><fieldset disabled={locked}>
          <legend>수거 주소</legend>
          <div className="admin-seller-claim-intake__fields">{ADDRESS_FIELDS.map(field => <label key={field.key} htmlFor={`seller-claim-${field.key}`} className={field.key.startsWith('address') ? 'admin-seller-claim-intake__wide' : undefined}>{field.label}<input id={`seller-claim-${field.key}`} required={field.key !== 'address2'} maxLength={field.max} inputMode={field.key === 'phone' || field.key === 'postalCode' ? 'numeric' : undefined} value={(input.collectionAddress ?? context.address)[field.key]} onChange={event => change('collectionAddress', { ...(input.collectionAddress ?? context.address), [field.key]: event.target.value })} /></label>)}</div>
          <p className="faint">수거 안내용 주소입니다. 원주문 배송지와 교환 재배송지는 바꾸지 않습니다.</p>
        </fieldset>
        <fieldset disabled={locked}>
          <legend>출고지별 수거 계획</legend>
          <p>택배사 예약이나 입고 확인을 실행하지 않습니다. 승인 이후 실제 수거와 출고지별 입고를 별도로 확인해주세요.</p>
          {context.collections.map((target, index) => {
            const row = input.collections[index];
            return <div className="admin-seller-claim-intake__collection" key={target.shipmentId}>
              <h4>{target.originName}</h4><p>{target.items.map(item => `${item.name} ${item.qty}개`).join(' · ')}</p>
              <p className="faint">현재 반송지: {target.returnAddress || '미설정 · 승인 전에 출고지 반송 주소를 등록해주세요.'}</p>
              <div className="admin-seller-claim-intake__fields">
                <label htmlFor={`seller-claim-method-${index}`}>수거 방법<select id={`seller-claim-method-${index}`} value={row.method} onChange={event => change('collections', input.collections.map((entry, position) => position === index ? { ...entry, method: event.target.value as SellerClaimInput['collections'][number]['method'], ...(event.target.value === 'not_requested' ? { carrier: null, trackingNumber: null } : {}) } : entry))}>{SELLER_CLAIM_COLLECTION_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
                {row.method !== 'not_requested' ? <>
                  <label htmlFor={`seller-claim-carrier-${index}`}>수거 택배사<select id={`seller-claim-carrier-${index}`} required={row.method === 'customer_sent'} value={row.carrier ?? ''} onChange={event => change('collections', input.collections.map((entry, position) => position === index ? { ...entry, carrier: event.target.value || null } : entry))}><option value="">택배사 선택</option>{selectableShippingCarriers(carriers).map(carrier => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}</select></label>
                  <label htmlFor={`seller-claim-tracking-${index}`}>수거 송장번호<input id={`seller-claim-tracking-${index}`} required={row.method === 'customer_sent' || Boolean(row.carrier)} maxLength={40} value={row.trackingNumber ?? ''} onChange={event => change('collections', input.collections.map((entry, position) => position === index ? { ...entry, trackingNumber: event.target.value || null } : entry))} /></label>
                </> : null}
                <label className="admin-seller-claim-intake__wide" htmlFor={`seller-claim-note-${index}`}>수거 메모{row.method === 'seller_arranged' ? ' (필수)' : ' (선택)'}<textarea id={`seller-claim-note-${index}`} rows={2} maxLength={500} required={row.method === 'seller_arranged'} value={row.note} onChange={event => change('collections', input.collections.map((entry, position) => position === index ? { ...entry, note: event.target.value } : entry))} /></label>
              </div>
            </div>;
          })}
        </fieldset>
        </> : null}
        {input.claimType !== 'exchange' ? <fieldset disabled={locked}>
          <legend>환불계좌 (선택)</legend>
          <p className="faint">고객에게 확인한 계좌만 입력해주세요. 원 결제수단으로 환급하지 못할 때 사용하며, 처리 종결 후 기존 보관 기한에 따라 원문을 파기합니다.</p>
          <div className="admin-seller-claim-intake__fields">{([{ key: 'bankName', label: '은행', max: 40 }, { key: 'accountNumber', label: '환불계좌 번호', max: 30 }, { key: 'accountHolder', label: '예금주', max: 40 }] as const).map(field => <label key={field.key} htmlFor={`seller-claim-${field.key}`}>{field.label}<input id={`seller-claim-${field.key}`} autoComplete="off" maxLength={field.max} value={input.refundAccount?.[field.key] ?? ''} onChange={event => change('refundAccount', { bankName: input.refundAccount?.bankName ?? '', accountNumber: input.refundAccount?.accountNumber ?? '', accountHolder: input.refundAccount?.accountHolder ?? '', [field.key]: event.target.value })} /></label>)}</div>
        </fieldset> : null}
        <label className="admin-seller-claim-intake__confirmation"><input type="checkbox" required disabled={locked} checked={input.agreementConfirmed} onChange={event => change('agreementConfirmed', event.target.checked)} />고객이 주문 전체의 {claimLabel}{input.claimType === 'cancel' ? '를' : '을'} 요청했고, 입력한 사유{input.claimType === 'cancel' ? '' : '와 수거 계획'}에 동의했음을 확인했습니다.</label>
        <div className="admin-seller-claim-intake__actions">
          {uncertain ? <><button className="btn" type="button" disabled={pending} onClick={() => { void readback(); }}>같은 요청의 저장 결과 확인</button>
            <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => { void submit(true); }}>같은 내용으로 다시 접수</button></>
            : <button className="btn" type="submit" disabled={pending || Boolean(blocked) || !input.agreementConfirmed}>{pending ? '접수 중…' : `${claimLabel} 요청 접수`}</button>}
          <button className="btn btn-ghost" type="button" disabled={pending || uncertain} onClick={close}>닫기</button>
        </div>
      </form>}
      {error ? <p ref={errorRef} tabIndex={-1} className="admin-seller-claim-intake__error" role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {uncertain ? <p>확인 전까지 처음 전송한 내용과 요청 번호를 보존합니다. 저장 결과를 확인하거나 같은 내용으로 재시도해주세요.</p> : null}
    </div>
  </CustomerServiceDialog>;
}

export function SellerClaimIntakeButton({ orderId, mode = 'return-exchange' }: { orderId: string; mode?: 'cancel' | 'return-exchange' }) {
  const [context, setContext] = useState<SellerClaimContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function open() {
    if (pending) return; setPending(true); setError('');
    try { const result = await loadSellerClaimContextAction(orderId); if ('error' in result) setError(result.error); else setContext(result.context); }
    catch { setError('접수 가능 여부를 확인하지 못했습니다. 다시 열어주세요.'); }
    finally { setPending(false); }
  }
  return <div className="admin-seller-claim-intake-entry">
    <button className="btn btn-sm btn-ghost" type="button" disabled={pending} onClick={() => { void open(); }}>{pending ? '접수 가능 여부 확인 중…' : mode === 'cancel' ? '판매자 직접 취소 접수' : '판매자 직접 반품·교환 접수'}</button>
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    {context ? <SellerClaimIntakeForm key={context.orderId} context={context} carriers={context.carriers} onClose={() => setContext(null)} /> : null}
  </div>;
}
