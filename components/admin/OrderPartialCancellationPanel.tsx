'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadOrderPartialCancellationAction,
  previewOrderPartialCancellationAction,
  recordOrderPartialCancellationTransferAction,
  retryOrderPartialCancellationAction,
  startOrderPartialCancellationAction,
  viewOrderPartialCancellationRefundAccountAction,
} from '@/app/admin/order-partial-cancellation-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/admin/kit/ui/alert-dialog';
import { Button } from '@/components/admin/kit/ui/button';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import {
  ORDER_PARTIAL_CANCELLATION_STATE_LABELS,
  orderPartialCancellationBlockerMessage,
  orderPartialCancellationItemBlockerLabel,
} from '@/lib/admin/order-partial-cancellation';
import { statusTone } from '@/lib/admin/status-tone';
import { krw } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import {
  orderPartialCancellationItemsLabel,
  type OrderPartialCancellationContext,
  type OrderPartialCancellationPlan,
  type OrderPartialCancellationRecord,
} from '@/lib/orders/partial-cancellation';

const FIELD = 'flex min-w-0 flex-col gap-1.5';
const HINT = 'text-xs text-muted-foreground';
/* 발송 전 주문이 아니면(이미 발송·취소 등) 기록이 없는 한 패널을 그리지 않는다 — 모든 주문 상세에 막힘 안내를 띄우지 않는다. */
const HIDDEN_WHEN_ONLY = new Set(['order_not_partial_cancelable', 'shipment_already_dispatched', 'order_not_found']);

type Draft = Record<string, number>;

function HistoryEntry({ orderId, record, onChanged }: { orderId: string; record: OrderPartialCancellationRecord; onChanged: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [account, setAccount] = useState<{ bankName: string; accountNumber: string; accountHolder: string } | null>(null);
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const operationId = useRef<string | null>(null);
  useClaimPreviewBusy(pending);
  const staff = record.staff;
  async function retry() {
    setPending(true); setMessage(null);
    try {
      const result = await retryOrderPartialCancellationAction({ orderId, partialCancellationId: record.id });
      if (result.ok) onChanged(result.value.message); else setMessage(result.error);
    } catch { setMessage('결과를 확인하지 못했습니다. 새로고침해주세요.'); }
    finally { setPending(false); }
  }
  async function reveal() {
    setPending(true); setMessage(null);
    try {
      const result = await viewOrderPartialCancellationRefundAccountAction(record.id);
      if (result.ok) setAccount(result.value); else setMessage(result.error);
    } catch { setMessage('계좌 원문을 읽지 못했습니다.'); }
    finally { setPending(false); }
  }
  async function transfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    operationId.current ??= crypto.randomUUID();
    setPending(true); setMessage(null);
    try {
      const result = await recordOrderPartialCancellationTransferAction({ orderId, partialCancellationId: record.id, evidence: evidence.trim(), note: note.trim(), operationId: operationId.current });
      if (result.ok) { operationId.current = null; onChanged(result.value); } else setMessage(result.error);
    } catch { setMessage('송금 기록 결과를 확인하지 못했습니다. 새로고침해 기록을 확인한 뒤 다시 시도해주세요.'); }
    finally { setPending(false); }
  }
  return <li className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-partial-cancellation={record.id}>
    <p className="flex flex-wrap items-center gap-2">
      <strong className="font-medium">{record.sequence}차 부분 취소</strong>
      <AdminStatusBadge tone={statusTone('partialCancellation', record.state)}>{ORDER_PARTIAL_CANCELLATION_STATE_LABELS[record.state]}</AdminStatusBadge>
      <span className="text-muted-foreground">{record.provider === 'bank_transfer' ? '계좌 송금' : '토스 부분 취소'}</span>
    </p>
    <p className="wrap-anywhere">{orderPartialCancellationItemsLabel(record.items)} 취소</p>
    <p className="tabular-nums">환불 {krw(record.refundAmount)}{record.shippingRefundAmount > 0 ? ` (상품 ${krw(record.goodsRefundAmount)} + 배송비 ${krw(record.shippingRefundAmount)})` : ''}
      {record.storeCreditRestoreAmount > 0 ? ` · 적립금 ${krw(record.storeCreditRestoreAmount)} 되돌림` : ''}</p>
    {staff ? <>
      <p className="text-muted-foreground wrap-anywhere">고객 결정: {staff.customerDecision}{staff.note ? ` · 메모: ${staff.note}` : ''}</p>
      <p className={HINT}>{formatOrderDateTime(record.createdAt)}{staff.createdBy ? ` · ${staff.createdBy}` : ''}{staff.warehouseStopConfirmed ? ' · 창고 출고 중단 확인' : ''}
        {staff.closedShipments.length ? ` · 닫은 배송 건 ${staff.closedShipments.map(shipment => shipment.shipmentNumber ?? shipment.originName).join(', ')}` : ''}</p>
    </> : null}
    {record.state === 'rejected' ? <AdminNotice tone="neutral">결제사가 이 결제의 부분 취소를 받지 않아 진행하지 않았습니다. 돈·주문·재고는 그대로입니다.</AdminNotice> : null}
    {(record.state === 'processing' || record.state === 'needs_review') ? <div className="flex flex-col gap-2">
      <AdminNotice tone={record.state === 'needs_review' ? 'danger' : 'info'}>
        결제사 부분 취소 확인 전입니다. 확인이 끝날 때까지 이 주문은 출고지시·발송·다른 취소가 막힙니다.{staff?.lastErrorCode ? ` 확인 코드: ${staff.lastErrorCode}` : ''}
      </AdminNotice>
      <Button className="w-fit" disabled={pending} onClick={() => void retry()} type="button">{pending ? '확인 중…' : '결제사 확인 다시 하기'}</Button>
    </div> : null}
    {record.state === 'awaiting_transfer' && staff ? <form className="flex flex-col gap-3 border-t pt-3" onSubmit={transfer}>
      <p>송금할 환불액 <strong className="tabular-nums">{krw(record.refundAmount)}</strong>{staff.refundAccount ? ` · ${staff.refundAccount.maskedAccount} (${staff.refundAccount.maskedHolder})` : ''}</p>
      {account ? <p className="wrap-anywhere" role="status">{account.bankName} {account.accountNumber} · 예금주 {account.accountHolder}</p>
        : <Button className="w-fit" disabled={pending} onClick={() => void reveal()} type="button" variant="outline">계좌 원문 보기 (열람 기록)</Button>}
      <label className={FIELD}><span className="font-medium">송금 근거</span><input className="w-full" maxLength={300} onChange={event => setEvidence(event.target.value)} required value={evidence} /></label>
      <label className={FIELD}><span className="font-medium">확인 메모</span><input className="w-full" maxLength={300} onChange={event => setNote(event.target.value)} required value={note} /></label>
      <small className={HINT}>은행 이체 확인 번호·이체 시각 등. 계좌번호는 적지 마세요.</small>
      <Button className="w-fit" disabled={pending || evidence.trim().length < 2 || note.trim().length < 2} type="submit">{pending ? '기록 중…' : '송금 완료 기록'}</Button>
    </form> : null}
    {record.state === 'completed' && record.provider === 'bank_transfer' && staff?.transferEvidence ? <p className={HINT}>송금 완료 {record.transferredAt ? formatOrderDateTime(record.transferredAt) : ''} · {staff.transferEvidence}</p> : null}
    {message ? <p className="text-destructive" role="alert">{message}</p> : null}
  </li>;
}

function VisiblePanel({ orderId, context, onReload }: { orderId: string; context: OrderPartialCancellationContext; onReload: (message?: string) => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [decision, setDecision] = useState('');
  const [note, setNote] = useState('');
  const [warehouseStop, setWarehouseStop] = useState(false);
  const [bank, setBank] = useState({ bankName: '', accountNumber: '', accountHolder: '' });
  const [plan, setPlan] = useState<OrderPartialCancellationPlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  useClaimPreviewBusy(pending);
  const open = context.enabled && context.blockers.length === 0;
  const bankTransfer = context.provider === 'bank_transfer';
  const selection = useMemo(() => Object.entries(draft).filter(([, qty]) => qty > 0).map(([orderItemId, qty]) => ({ orderItemId, qty })), [draft]);
  const exportedSelected = context.items.some(item => (draft[item.orderItemId] ?? 0) > 0 && item.exported);
  const ready = selection.length > 0 && decision.trim().length >= 2
    && (!bankTransfer || (bank.bankName.trim() && /^[0-9-]{8,30}$/.test(bank.accountNumber.replace(/\s+/g, '')) && bank.accountHolder.trim()));
  function setQty(orderItemId: string, qty: number) {
    setDraft(current => ({ ...current, [orderItemId]: qty }));
    setPlan(null);
  }
  async function preview() {
    setPending(true); setError(null);
    try {
      const result = await previewOrderPartialCancellationAction({ orderId, items: selection });
      if (result.ok) { operationId.current = crypto.randomUUID(); setPlan(result.value); } else setError(result.error);
    } catch { setError('부분 취소 금액을 확인하지 못했습니다. 다시 시도해주세요.'); }
    finally { setPending(false); }
  }
  async function start() {
    if (!plan || !operationId.current) return;
    setPending(true); setError(null);
    try {
      const result = await startOrderPartialCancellationAction({
        orderId, items: selection, customerDecision: decision.trim(), note: note.trim() || null,
        warehouseStopConfirmed: warehouseStop, expectedRefundAmount: plan.refundAmount, operationId: operationId.current,
        refundAccount: bankTransfer ? bank : null,
      });
      if (!result.ok) { setError(result.error); setPlan(null); return; }
      setPlan(null); setDraft({}); setDecision(''); setNote(''); setWarehouseStop(false); setBank({ bankName: '', accountNumber: '', accountHolder: '' });
      operationId.current = null;
      onReload(result.value.message);
    } catch {
      setError('처리 결과를 확인하지 못했습니다. 새로고침해 아래 기록을 확인한 뒤 같은 내용으로 다시 시도해주세요.');
    } finally { setPending(false); }
  }
  return <section aria-label="재고 부족 부분 취소" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground" data-partial-cancellation-panel="">
    <div className="flex flex-col gap-1">
      <h3 className="text-base leading-snug font-medium">재고 부족 부분 취소</h3>
      <p className="text-muted-foreground">창고 재고가 모자란 상품을 고객이 결정한 대로 일부만 취소하고 나머지를 출고합니다. 그 상품·수량의 결제 배분액(할인·쿠폰·적립금 반영)만 환불하고, 남는 상품이 없어진 배송 건의 배송비는 함께 환불합니다.</p>
    </div>
    {context.enabled && context.blockers.length ? <AdminNotice role="status" tone="warning">{orderPartialCancellationBlockerMessage(context.blockers[0])}</AdminNotice> : null}
    {open ? <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void preview(); }}>
      <ul className="flex flex-col gap-2">{context.items.map(item => {
        const blocked = orderPartialCancellationItemBlockerLabel(item.blocker);
        const value = draft[item.orderItemId] ?? 0;
        return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2" key={item.orderItemId}>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <input checked={value > 0} disabled={Boolean(blocked) || pending} onChange={event => setQty(item.orderItemId, event.target.checked ? Math.min(1, item.activeQty) : 0)} type="checkbox" />
            <span className="min-w-0 wrap-anywhere">{item.goodName}{item.variantName ? ` · ${item.variantName}` : ''}</span>
          </label>
          <span className="text-muted-foreground tabular-nums">남은 {item.activeQty}개{item.canceledQty ? ` (취소 ${item.canceledQty}개)` : ''}{item.shipmentNumber ? ` · 배송 건 ${item.shipmentNumber}` : ''}{item.exported ? ' · 출고지시 전달됨' : ''}</span>
          {blocked ? <AdminStatusBadge>{blocked}</AdminStatusBadge> : value > 0 ? <label className="flex items-center gap-1.5">
            <span>취소 수량</span>
            <input aria-label={`${item.goodName} 취소 수량`} className="w-20 tabular-nums" disabled={pending} max={item.activeQty} min={1} onChange={event => setQty(item.orderItemId, Math.max(1, Math.min(item.activeQty, Number.parseInt(event.target.value, 10) || 1)))} type="number" value={value} />
          </label> : null}
        </li>;
      })}</ul>
      <label className={FIELD}><span className="font-medium">고객 결정 기록 (필수)</span>
        <textarea className="w-full" disabled={pending} maxLength={500} onChange={event => { setDecision(event.target.value); setPlan(null); }} required rows={2} value={decision} />
        <small className={HINT}>언제 어떤 경로로 고객이 무엇을 결정했는지 적습니다. 예: 11/12 14:00 통화 — 품절 상품은 취소하고 나머지를 먼저 받기로 함.</small>
      </label>
      <label className={FIELD}><span className="font-medium">메모 (선택)</span><input className="w-full" disabled={pending} maxLength={500} onChange={event => setNote(event.target.value)} value={note} /></label>
      {bankTransfer ? <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={pending}>
        <legend className="p-0 font-medium">환불받을 계좌 (무통장 주문)</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="은행" maxLength={40} onChange={event => setBank(current => ({ ...current, bankName: event.target.value }))} placeholder="은행" value={bank.bankName} />
          <input aria-label="계좌번호" inputMode="numeric" maxLength={30} onChange={event => setBank(current => ({ ...current, accountNumber: event.target.value }))} placeholder="계좌번호" value={bank.accountNumber} />
          <input aria-label="예금주" maxLength={40} onChange={event => setBank(current => ({ ...current, accountHolder: event.target.value }))} placeholder="예금주" value={bank.accountHolder} />
        </div>
        <small className={HINT}>고객이 알려준 계좌입니다. 마스킹해 보관하고 송금 완료 30일 뒤 원문을 지웁니다.</small>
      </fieldset> : null}
      {exportedSelected ? <label className="flex items-start gap-2">
        <input checked={warehouseStop} disabled={pending} onChange={event => setWarehouseStop(event.target.checked)} type="checkbox" />
        <span>출고지시가 나간 배송 건입니다. 창고에 그 상품·수량의 출고 중단을 확인했습니다.</span>
      </label> : null}
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      <Button className="w-fit" disabled={!ready || pending || (exportedSelected && !warehouseStop)} type="submit">{pending && !plan ? '확인 중…' : '취소 내용 확인'}</Button>
    </form> : null}
    {context.history.length ? <div className="flex flex-col gap-2">
      <h4 className="font-medium">부분 취소 기록</h4>
      <ol className="flex flex-col gap-2">{[...context.history].reverse().map(record => <HistoryEntry key={`${record.id}:${record.state}`} onChanged={onReload} orderId={orderId} record={record} />)}</ol>
    </div> : null}
    <AlertDialog onOpenChange={next => { if (!next && !pending) setPlan(null); }} open={plan !== null}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>이 상품만 취소하고 {plan ? krw(plan.refundAmount) : ''}을 환불할까요?</AlertDialogTitle>
          <AlertDialogDescription>되돌릴 수 없습니다. {plan?.provider === 'bank_transfer' ? '확정하면 바로 재고를 되돌리고 배송 건에서 빼며, 환불은 송금 대기로 남습니다.' : '확정하면 토스에서 이 금액만 부분 취소하고, 결제사 확인 뒤 재고를 되돌리고 배송 건에서 뺍니다. 결제사가 부분 취소를 받지 않는 결제면 아무것도 바꾸지 않습니다.'}</AlertDialogDescription>
        </AlertDialogHeader>
        {plan ? <div className="flex flex-col gap-2 text-sm">
          <ul className="flex flex-col gap-1">{plan.lines.map(line => <li className="flex flex-wrap justify-between gap-2" key={line.orderItemId}>
            <span className="wrap-anywhere">{line.goodName}{line.variantName ? ` · ${line.variantName}` : ''} {line.qty}개 취소 (남는 수량 {line.remainingQtyAfter}개)</span>
            <span className="tabular-nums">{krw(line.goodsRefundAmount)}</span>
          </li>)}</ul>
          {plan.closedShipments.map(shipment => <p className="flex flex-wrap justify-between gap-2" key={shipment.shipmentId}>
            <span>배송비 함께 환불 · {shipment.originName} {shipment.shipmentNumber ?? ''} (남는 상품 없음)</span><span className="tabular-nums">{krw(shipment.shippingFeeRefund)}</span>
          </p>)}
          <p className="flex justify-between gap-2 border-t pt-2 font-semibold"><span>환불액</span><span className="tabular-nums">{krw(plan.refundAmount)}</span></p>
          <p className="text-muted-foreground">결제 {krw(plan.paymentAmount)} · 환불 전 남은 금액 {krw(plan.balanceBefore)} → 환불 뒤 {krw(plan.balanceAfter)}{plan.storeCreditRestoreAmount > 0 ? ` · 적립금 ${krw(plan.storeCreditRestoreAmount)}은 적립금으로 되돌림` : ''}</p>
          <p className="text-muted-foreground">남은 주문의 쿠폰 조건은 다시 판정하지 않습니다.{plan.warehouseStopRequired ? ' 출고지시가 나간 배송 건이라 창고 출고 중단 확인이 필요합니다.' : ''}</p>
        </div> : null}
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>닫기</AlertDialogCancel>
          <Button disabled={pending} onClick={() => void start()} type="button" variant="danger">{pending ? '처리 중…' : plan?.provider === 'bank_transfer' ? '부분 취소 확정 (송금 대기)' : '부분 취소 확정 (토스 부분 취소)'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

/**
 * 주문 상세의 재고 부족 부분 취소(ADR-0032). 스위치가 꺼져 있고 기록이 없으면 아무것도 그리지 않는다(지금과 같은 화면).
 * 발송 전이 아닌 주문도 기록이 없으면 그리지 않는다.
 */
export function OrderPartialCancellationPanel({ orderId }: { orderId: string }) {
  const [context, setContext] = useState<OrderPartialCancellationContext | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadOrderPartialCancellationAction(orderId).then(result => { if (active && result.ok) setContext(result.value); }, () => undefined);
    return () => { active = false; };
  }, [orderId, refresh]);
  if (!context) return null;
  if (!context.history.length && (!context.enabled || context.blockers.every(code => HIDDEN_WHEN_ONLY.has(code)) && context.blockers.length > 0)) return null;
  return <div className="flex min-w-0 flex-col gap-2">
    {message ? <AdminNotice role="status" tone="info">{message}</AdminNotice> : null}
    <VisiblePanel context={context} key={`${orderId}:${refresh}`} onReload={next => { setMessage(next ?? null); setRefresh(value => value + 1); }} orderId={orderId} />
  </div>;
}
