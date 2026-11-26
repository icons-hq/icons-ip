'use client';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeOrderAddressAction, loadOrderAddressContextAction, readOrderAddressChangeAction } from '@/app/admin/order-address-actions';
import {
  normalizeOrderAddressRequest, orderAddressBlockerMessage, orderAddressChangeLines, orderAddressConfirmMessage, orderAddressError, orderAddressReceiptMatches,
  ORDER_ADDRESS_RELOAD_LABEL, ORDER_ADDRESS_RESEND_LABEL, type OrderAddressContext, type OrderAddressReceipt, type OrderAddressRequest,
} from '@/lib/admin/order-address';
import { reopenClosedDialog, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/goods-template-save';
import { adminConfirm } from '@/lib/admin/confirm';
import type { CheckoutAddress } from '@/lib/checkout';
import { formatOrderDateTime } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';

/* 팝업 안 입력 칸(kit Input, ADR-0028). 라벨 글자 아래 입력이 놓이고 라벨이 입력의 이름이 된다. */
const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5 [&>span]:font-medium';
const HINT_CLASS = 'text-xs leading-normal text-muted-foreground';
const REASON_HINT_ID = 'order-address-reason-hint';

const fields: { key: keyof CheckoutAddress; label: string; max: number; optional?: boolean }[] = [
  { key: 'recipientName', label: '수령인', max: 50 }, { key: 'phone', label: '연락처', max: 25 },
  { key: 'postalCode', label: '우편번호', max: 5 }, { key: 'address1', label: '기본 주소', max: 200 },
  { key: 'address2', label: '상세 주소', max: 200, optional: true }, { key: 'deliveryNote', label: '배송 메모', max: 200, optional: true },
];
function addressText(address: CheckoutAddress) {
  return `${address.recipientName} · ${address.phone} · (${address.postalCode}) ${address.address1} ${address.address2 ?? ''} · ${address.deliveryNote || '메모 없음'}`;
}
export function OrderAddressEditor({ initial, onClose }: { initial: OrderAddressContext; onClose: () => void }) {
  const router = useRouter(); const [context, setContext] = useState(initial);
  const [address, setAddress] = useState(initial.address); const [reason, setReason] = useState('');
  const [frozen, setFrozen] = useState<OrderAddressRequest | null>(null); const [pending, setPending] = useState(false);
  useClaimPreviewBusy(pending); /* 목록 위 주문 상세 팝업(S36-075)에서 기다리는 동안 팝업이 닫히지 않게 알린다. 팝업 밖에서는 아무 일도 하지 않는다. */
  const [uncertain, setUncertain] = useState(false); const [conflict, setConflict] = useState(false);
  const [receipt, setReceipt] = useState<OrderAddressReceipt | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const dispatched = useRef<OrderAddressRequest | null>(null); const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null); useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const rootRef = useRef<HTMLDivElement>(null);
  const locked = pending || Boolean(frozen) || Boolean(receipt); const busy = pending || uncertain;
  /* 적은 내용이 있으면 닫기 전에 묻는다(화면 규칙 7). 응답을 기다리는 중이거나 보낸 요청이 남은 동안은 닫지 못한다. */
  const dirty = !receipt && (reason.trim() !== '' || fields.some(field => (address[field.key] ?? '') !== (context.address[field.key] ?? '')));
  const close = () => {
    if (inFlight.current || dispatched.current) return;
    if (!dirty) { onClose(); return; }
    /* 확인창에서 돌아가는데 브라우저가 이 창을 이미 닫았으면(Esc를 거듭 누르면 생긴다) 다시 연다. */
    void adminConfirm({ ...TEMPLATE_CLOSE_DIRTY_CONFIRM, cancelLabel: '돌아가기' }).then(ok => { if (ok) onClose(); else reopenClosedDialog(rootRef.current); }, () => {});
  };
  const canEdit = () => !inFlight.current && !dispatched.current && !receipt;
  function accept(received: OrderAddressReceipt, request: OrderAddressRequest) {
    if (!orderAddressReceiptMatches(received, request)) { setError(`불러온 저장 결과가 방금 적은 내용과 맞지 않습니다. [${SAVE_CHECK_LABEL}]을 다시 누르고, 같은 안내가 반복되면 화면을 새로고침해 변경 이력을 확인해 주세요.`); setUncertain(true); return; }
    dispatched.current = null; setFrozen(null); setReceipt(received); setUncertain(false); setError(''); setMessage('배송지를 바꿨습니다.'); router.refresh();
  }
  async function save() {
    if (inFlight.current || receipt || !context.allowed || (conflict && !uncertain)) return;
    const retry = dispatched.current;
    /* 확인 체크는 없앴다. DB가 요구하는 값(고객 동의)은 늘 true로 보내고, 그 뜻은 아래 확인창 마지막 줄이 말한다. */
    const parsed = normalizeOrderAddressRequest(retry ?? { id: crypto.randomUUID(), orderId: context.orderId, revision: context.revision, address, reason, agreed: true });
    if ('error' in parsed) { setError(parsed.error); return; }
    const request = parsed.request; const wasUncertain = uncertain;
    /* 바뀐 칸이 없으면 서버에 묻지 않는다. 응답을 못 받아 다시 보내는 같은 요청은 이미 확인한 내용이라 건너뛴다. */
    if (!retry && !orderAddressChangeLines(context.address, request.address).length) { setError(orderAddressError(undefined, 'order_address_unchanged')); return; }
    inFlight.current = true;
    if (!retry) {
      let ok = false;
      try { ok = await adminConfirm({ title: '배송지를 바꿀까요?', message: orderAddressConfirmMessage(context, context.address, request.address), confirmLabel: '배송지 바꾸기', cancelLabel: '돌아가기' }); }
      catch { ok = false; }
      if (!ok) { inFlight.current = false; return; }
    }
    dispatched.current = request; setFrozen(request); setPending(true); setError(''); setMessage('');
    try {
      const result = await changeOrderAddressAction(request);
      if ('error' in result) {
        const mustStayFrozen = wasUncertain || Boolean(result.uncertain);
        setError(result.error); setConflict(!mustStayFrozen && Boolean(result.conflict)); setUncertain(mustStayFrozen);
        if (!mustStayFrozen) { dispatched.current = null; setFrozen(null); }
      } else if (result.receipt) accept(result.receipt, request);
      else { setUncertain(true); setError(SAVE_UNKNOWN_MESSAGE); }
    } catch { setUncertain(true); setError(SAVE_UNKNOWN_MESSAGE); }
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
      else setMessage(`아직 저장된 내용이 없습니다. 적은 내용은 그대로 있으니 [${ORDER_ADDRESS_RESEND_LABEL}]을 누르면 됩니다. 같은 내용이 두 번 저장되지 않습니다.`);
    } catch { setError(`저장된 결과를 불러오지 못했습니다. 잠시 뒤 [${SAVE_CHECK_LABEL}]을 다시 눌러 주세요.`); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function refreshContext() {
    if (inFlight.current || dispatched.current) return;
    inFlight.current = true;
    setPending(true); setError('');
    try {
      const result = await loadOrderAddressContextAction(context.orderId);
      if ('error' in result) setError(result.error);
      else { setContext(result.context); setFrozen(null); setConflict(false); setMessage(result.context.allowed ? '지금 배송지를 불러왔습니다. 적은 내용은 그대로 있으니 위 배송지와 비교한 뒤 다시 저장해 주세요.' : ''); }
    } catch { setError('지금 배송지를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const target = context.orderNumber ? `주문 ${context.orderNumber}` : '이 주문';
  /* 바꿀 수 없는 주문은 입력 칸 없이 이유와 이력만 보인다. 못 하는 일은 보이지 않게 한다. */
  const blocked = !context.allowed;
  return <CustomerServiceDialog title={blocked ? '배송지 변경 이력' : '배송지 수정'} wide busy={busy} onClose={close}>
    <div className="flex flex-col gap-3.5 text-sm leading-relaxed" data-order-address-editor="" ref={rootRef}>
      <p><strong className="font-medium">{target}</strong>{!blocked && context.shipmentCount > 1 ? ` · 배송 건 ${context.shipmentCount}개 모두에 적용됩니다.` : ''}</p>
      <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3.5 wrap-anywhere"><strong className="font-medium">{receipt ? '변경 전 배송지' : '현재 배송지'}</strong><p>{addressText(context.address)}</p></div>
      {blocked ? <AdminNotice role="status" tone="warning">{orderAddressBlockerMessage(context.blocker)}</AdminNotice> : null}
      {receipt ? <section className="flex flex-col items-start gap-1.5 rounded-lg border p-3.5" role="status"><h3 className="text-base font-medium">배송지를 바꿨습니다.</h3><p className="wrap-anywhere">{addressText(receipt.address)}</p><p className="text-muted-foreground">{formatOrderDateTime(receipt.changedAt)} · {receipt.reason}</p>
        {!receipt.currentMatches ? <p>그 뒤 다른 사람이 배송지를 또 바꿨습니다. 주문 상세에서 지금 배송지를 확인해 주세요.</p> : null}<Button className="mt-1" type="button" onClick={close}>닫기</Button></section>
        : blocked ? null
        : <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0" disabled={locked}>
            <legend className="mb-3 font-medium">바꿀 내용</legend>
            <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <label className={LABEL_CLASS} key={field.key}><span>{field.label}</span>
              <Input required={!field.optional} maxLength={field.max} value={address[field.key] ?? ''} inputMode={field.key === 'phone' || field.key === 'postalCode' ? 'numeric' : undefined}
                onChange={event => { if (canEdit()) setAddress(previous => ({ ...previous, [field.key]: event.target.value })); }} />
            </label>)}</div>
            <p className={HINT_CLASS}>배송비가 달라지는 주소로는 바꿀 수 없습니다.</p>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className={LABEL_CLASS}><span>변경 사유 (필수)</span>
                <Input aria-describedby={REASON_HINT_ID} required maxLength={500} value={reason} onChange={event => { if (canEdit()) setReason(event.target.value); }}
                  placeholder={context.isGift ? '예: 11/26 선물 받는 분이 전화로 배송지 변경을 요청' : '예: 11/26 고객이 전화로 배송지 변경을 요청'} /></label>
              <p className={HINT_CLASS} id={REASON_HINT_ID}>배송지 변경 이력에만 남고 고객에게는 보이지 않습니다.</p>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {uncertain ? <><Button disabled={pending} type="button" onClick={() => { void readback(); }}>{SAVE_CHECK_LABEL}</Button><Button disabled={pending} type="button" variant="outline" onClick={() => { void save(); }}>{ORDER_ADDRESS_RESEND_LABEL}</Button></>
              : conflict ? <Button disabled={pending} type="button" onClick={() => { void refreshContext(); }}>{ORDER_ADDRESS_RELOAD_LABEL}</Button>
                : <Button type="submit" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button>}
            <Button type="button" variant="outline" disabled={busy} onClick={close}>닫기</Button>
          </div>
        </form>}
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive outline-none">{error}</p> : null}{message && !receipt ? <p role="status">{message}</p> : null}
      {blocked && !context.history.length ? <p className="text-muted-foreground">바꾼 이력이 없습니다.</p> : null}
      {context.history.length ? <details className="group rounded-lg border px-3.5 py-2.5"><summary className="cursor-pointer font-medium">최근 변경 이력 {context.history.length}건</summary><ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 wrap-anywhere">{context.history.map(entry => <li key={entry.id}>
        <strong className="font-medium">{formatOrderDateTime(entry.changedAt)} · {entry.actorName}</strong><p>{entry.reason}</p><p className="text-muted-foreground">변경 전: {addressText(entry.before)}</p><p className="text-muted-foreground">변경 후: {addressText(entry.after)}</p>
      </li>)}</ol></details> : null}
      {blocked && !receipt ? <Button className="self-start" type="button" variant="outline" onClick={close}>닫기</Button> : null}
    </div>
  </CustomerServiceDialog>;
}
/** `blocker`는 화면이 이미 아는 막힘(주문 상태)이다. 비어 있으면 열기 전에 DB가 알려 주는 값을 읽어 이름을 정한다. */
export function OrderAddressButton({ orderId, blocker = null }: { orderId: string; blocker?: string | null }) {
  const [context, setContext] = useState<OrderAddressContext | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [peek, setPeek] = useState<{ allowed: boolean; blocker: string | null } | null>(null);
  const panelOpen = context !== null;
  /* 바꿀 수 없는 주문은 눌러 보기 전에 알린다: 버튼 이름이 이력으로 바뀐다. 읽지 못하면 그대로 두고 눌렀을 때 읽는다. 창을 닫으면 다시 읽는다. */
  useEffect(() => {
    if (panelOpen || blocker) return undefined;
    let alive = true;
    loadOrderAddressContextAction(orderId).then(
      result => { if (alive && 'context' in result) setPeek({ allowed: result.context.allowed, blocker: result.context.blocker }); },
      () => {},
    );
    return () => { alive = false; };
  }, [orderId, panelOpen, blocker]);
  async function open() {
    if (pending) return; setPending(true); setError('');
    try { const result = await loadOrderAddressContextAction(orderId); if ('error' in result) setError(result.error); else setContext(result.context); }
    catch { setError('배송지를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); } finally { setPending(false); }
  }
  const lockedBy = blocker ?? (peek && !peek.allowed ? (peek.blocker ?? 'unknown') : null);
  return <><Button type="button" disabled={pending} variant="outline" title={lockedBy ? orderAddressBlockerMessage(lockedBy) : undefined} onClick={() => { void open(); }}>{pending ? '배송지 확인 중…' : lockedBy ? '배송지 변경 이력' : '배송지 수정'}</Button>
    {error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}{context ? <OrderAddressEditor initial={context} onClose={() => setContext(null)} /> : null}</>;
}
