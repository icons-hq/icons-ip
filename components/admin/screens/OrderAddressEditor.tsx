'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeOrderAddressAction, loadOrderAddressContextAction, readOrderAddressChangeAction } from '@/app/admin/order-address-actions';
import { normalizeOrderAddressRequest, orderAddressError, orderAddressReceiptMatches, type OrderAddressContext, type OrderAddressReceipt, type OrderAddressRequest } from '@/lib/admin/order-address';
import type { CheckoutAddress } from '@/lib/checkout';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { CustomerServiceDialog } from './CustomerServiceDialog';

const fields: { key: keyof CheckoutAddress; label: string; max: number; optional?: boolean }[] = [
  { key: 'recipientName', label: '수령자', max: 50 }, { key: 'phone', label: '연락처', max: 25 },
  { key: 'postalCode', label: '우편번호', max: 5 }, { key: 'address1', label: '기본 주소', max: 200 },
  { key: 'address2', label: '상세 주소', max: 200, optional: true }, { key: 'deliveryNote', label: '배송 메모', max: 200, optional: true },
];
function addressText(address: CheckoutAddress) {
  return `${address.recipientName} · ${address.phone} · (${address.postalCode}) ${address.address1} ${address.address2 ?? ''} · ${address.deliveryNote || '메모 없음'}`;
}
export function OrderAddressEditor({ initial, onClose }: { initial: OrderAddressContext; onClose: () => void }) {
  const router = useRouter(); const [context, setContext] = useState(initial);
  const [address, setAddress] = useState(initial.address); const [reason, setReason] = useState(''); const [agreed, setAgreed] = useState(false);
  const [frozen, setFrozen] = useState<OrderAddressRequest | null>(null); const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<OrderAddressReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<OrderAddressRequest | null>(null); const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null); useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const locked = pending || Boolean(frozen) || Boolean(receipt); const busy = pending || uncertain;
  const close = () => { if (!inFlight.current && !dispatched.current) onClose(); };
  const canEdit = () => !inFlight.current && !dispatched.current && !receipt;
  function accept(received: OrderAddressReceipt, request: OrderAddressRequest) {
    if (!orderAddressReceiptMatches(received, request)) { setError('저장된 내용이 현재 요청과 다릅니다. 주문의 최신 배송 정보를 확인해주세요.'); setUncertain(true); return; }
    dispatched.current = null; setFrozen(null); setReceipt(received); setUncertain(false); setError(''); setMessage('배송 정보를 저장했습니다.'); router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || (conflict && !uncertain)) return;
    const parsed = normalizeOrderAddressRequest(dispatched.current ?? { id: crypto.randomUUID(), orderId: context.orderId, revision: context.revision, address, reason, agreed });
    if ('error' in parsed) { setError(parsed.error); return; }
    const request = parsed.request; const wasUncertain = uncertain;
    dispatched.current = request; inFlight.current = true; setFrozen(request); setPending(true); setError(''); setMessage('');
    try {
      const result = await changeOrderAddressAction(request);
      if ('error' in result) {
        const mustStayFrozen = wasUncertain || Boolean(result.uncertain);
        setError(result.error); setConflict(!mustStayFrozen && Boolean(result.conflict)); setUncertain(mustStayFrozen);
        if (!mustStayFrozen) { dispatched.current = null; setFrozen(null); }
      } else if (result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError('저장 결과를 확인하지 못했습니다. 같은 요청을 조회해주세요.'); }
    } catch { setUncertain(true); setError('저장 결과가 불확실합니다. 같은 요청을 조회해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function readback() {
    const request = dispatched.current; if (!request || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(''); setMessage('');
    try {
      const result = await readOrderAddressChangeAction(request.id);
      if ('error' in result) setError(result.error);
      else if (result.receipt) accept(result.receipt, request);
      else setMessage('아직 저장 결과가 없습니다. 입력은 고정한 채 같은 요청을 다시 시도할 수 있습니다.');
    } catch { setError('저장 결과를 읽지 못했습니다. 같은 요청을 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function refreshContext() {
    if (inFlight.current || dispatched.current) return;
    inFlight.current = true;
    setPending(true); setError('');
    try {
      const result = await loadOrderAddressContextAction(context.orderId);
      if ('error' in result) setError(result.error);
      else { setContext(result.context); setFrozen(null); setConflict(false); setAgreed(false); setMessage('입력은 보존했습니다. 최신 배송지와 비교하고 고객 동의를 다시 확인해주세요.'); }
    } catch { setError('최신 배송 정보를 읽지 못했습니다. 다시 확인해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <CustomerServiceDialog title="발송 전 배송지 수정" wide busy={busy} onClose={close}>
    <div className="admin-order-address">
      <p><strong>주문 {orderReferenceLabel(context.orderId, context.orderNumber)}</strong> · 연결 배송건 {context.shipmentCount}개 전체에 적용합니다.</p>
      <p>출고지시 전달·발송 전 주문만 수정합니다. 배송 지역이 바뀌면 배송 가능 여부와 각 배송비를 대조하며, 결제금액이 달라지는 변경은 저장할 수 없습니다.</p>
      <div className="admin-order-address__current"><strong>{receipt ? '변경 전 배송 정보' : '현재 배송 정보'}</strong><p>{addressText(context.address)}</p></div>
      {!context.allowed ? <p role="status">{orderAddressError(undefined, context.blocker ?? '')}</p> : null}
      {receipt ? <section role="status"><h3>배송 정보를 저장했습니다.</h3><p>{addressText(receipt.address)}</p><p>{formatOrderDateTime(receipt.changedAt)} · {receipt.reason}</p>
        {!receipt.currentMatches ? <p>이후 다른 변경이 있습니다. 주문 상세의 최신 배송지를 확인해주세요.</p> : null}<button className="btn" type="button" onClick={close}>닫기</button></section>
        : <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={locked || !context.allowed}>
            <legend>고객이 요청한 변경 정보</legend>
            <div className="admin-order-address__fields">{fields.map(field => <label key={field.key}>{field.label}
              <input required={!field.optional} maxLength={field.max} value={address[field.key] ?? ''} inputMode={field.key === 'phone' || field.key === 'postalCode' ? 'numeric' : undefined}
                onChange={event => { if (canEdit()) { setAddress(previous => ({ ...previous, [field.key]: event.target.value })); setAgreed(false); } }} />
            </label>)}</div>
            <label className="admin-order-address__reason">고객 요청 확인 근거<input required maxLength={500} value={reason} onChange={event => { if (canEdit()) setReason(event.target.value); }} placeholder="상담 경로·참조번호와 고객이 요청한 변경 내용을 적어주세요." /></label>
            <label className="admin-order-address__agreement"><input type="checkbox" checked={agreed} onChange={event => { if (canEdit()) setAgreed(event.target.checked); }} required />{context.isGift ? '선물을 받는 사람이 위 주문 전체의 배송 정보 변경에 동의했음을 확인했습니다.' : '고객이 위 주문 전체의 배송 정보 변경에 동의했음을 확인했습니다.'}</label>
          </fieldset>
          <div className="admin-order-address__actions">
            {uncertain ? <><button className="btn" disabled={pending} type="button" onClick={() => { void readback(); }}>같은 요청의 저장 결과 확인</button><button className="btn btn-ghost" disabled={pending} type="button" onClick={() => { void save(); }}>같은 내용으로 다시 저장</button></>
              : conflict ? <button className="btn" disabled={pending} type="button" onClick={() => { void refreshContext(); }}>최신 배송지와 비교</button>
                : <button className="btn" type="submit" disabled={pending || !context.allowed || !agreed}>{pending ? '저장 중…' : '주문 전체 배송지 변경'}</button>}
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={close}>닫기</button>
          </div>
        </form>}
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="admin-error">{error}</p> : null}{message && !receipt ? <p role="status">{message}</p> : null}
      {context.history.length ? <details><summary>최근 변경 이력 {context.history.length}건</summary><ol className="admin-order-address__history">{context.history.map(entry => <li key={entry.id}>
        <strong>{formatOrderDateTime(entry.changedAt)} · {entry.actorName}</strong><p>{entry.reason}</p><p>변경 전: {addressText(entry.before)}</p><p>변경 후: {addressText(entry.after)}</p>
      </li>)}</ol></details> : null}
    </div>
  </CustomerServiceDialog>;
}
export function OrderAddressButton({ orderId }: { orderId: string }) {
  const [context, setContext] = useState<OrderAddressContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function open() {
    if (pending) return; setPending(true); setError('');
    try { const result = await loadOrderAddressContextAction(orderId); if ('error' in result) setError(result.error); else setContext(result.context); }
    catch { setError('배송 정보를 읽지 못했습니다. 다시 확인해주세요.'); } finally { setPending(false); }
  }
  return <><button type="button" disabled={pending} className="admin-order-detail__button admin-order-detail__button--secondary" onClick={() => { void open(); }}>{pending ? '배송 정보 확인 중…' : '배송지 수정·이력'}</button>
    {error ? <span role="alert" className="admin-error">{error}</span> : null}{context ? <OrderAddressEditor initial={context} onClose={() => setContext(null)} /> : null}</>;
}
