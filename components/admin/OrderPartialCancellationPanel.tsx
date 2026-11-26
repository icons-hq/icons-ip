'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadOrderPartialCancellationAction,
  previewOrderPartialCancellationAction,
  recordOrderPartialCancellationTransferAction,
  resolveOrderPartialCancellationAction,
  retryOrderPartialCancellationAction,
  startOrderPartialCancellationAction,
  viewOrderPartialCancellationRefundAccountAction,
} from '@/app/admin/order-partial-cancellation-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { WarehouseStopRequirementNote } from '@/components/admin/OrderWarehouseStopPanel';
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
  ORDER_PARTIAL_CANCELLATION_RESOLUTION_LABELS,
  ORDER_PARTIAL_CANCELLATION_STATE_LABELS,
  orderPartialCancellationBlockerMessage,
  orderPartialCancellationConfirmCopy,
  orderPartialCancellationItemBlockerLabel,
  orderPartialCancellationPanelVisible,
  orderPartialCancellationReconcileMessage,
  orderPartialCancellationV1AllocationIssueMessage,
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

type Draft = Record<string, number>;

/** 마지막 결제사 확인이 막힌 이유 코드. 운영자가 읽을 말은 따로 있고, 코드는 결제 담당자에게 문의할 때만 쓴다. */
function ErrorCodeNote({ code }: { code: string }) {
  return <span className="mt-1 block text-xs text-muted-foreground" data-partial-cancellation-error-code={code}>문의할 때 알려 줄 코드: {code}</span>;
}

function HistoryEntry({ orderId, record, canManage, onChanged }: { orderId: string; record: OrderPartialCancellationRecord; canManage: boolean; onChanged: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  const [resolveReason, setResolveReason] = useState('');
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
    } catch { setMessage('결제사 확인 결과를 받지 못했습니다. 새로고침해 부분 취소 기록의 상태를 본 뒤 다시 눌러주세요.'); }
    finally { setPending(false); }
  }
  async function resolve() {
    setPending(true); setMessage(null);
    try {
      const result = await resolveOrderPartialCancellationAction({ orderId, partialCancellationId: record.id, reason: resolveReason.trim() });
      if (result.ok) onChanged(result.value); else setMessage(result.error);
    } catch { setMessage('해소됐는지 확인하지 못했습니다. 새로고침해 부분 취소 기록을 확인해주세요.'); }
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
    } catch { setMessage('송금이 기록됐는지 확인하지 못했습니다. 새로고침해 기록을 확인한 뒤 다시 시도해주세요.'); }
    finally { setPending(false); }
  }
  return <li className="flex min-w-0 flex-col gap-2 rounded-lg border p-3" data-partial-cancellation={record.id}>
    <p className="flex flex-wrap items-center gap-2">
      {/* 부분 반품(ADR-0047)도 같은 부분 환불 원장의 줄이다 — 재고 부족 부분 취소와 이름·문장을 나눈다. */}
      <strong className="font-medium">{record.sequence}차 {record.reasonCode === 'return' ? '부분 반품 환불' : '부분 취소'}</strong>
      <AdminStatusBadge tone={statusTone('partialCancellation', record.state)}>{ORDER_PARTIAL_CANCELLATION_STATE_LABELS[record.state]}</AdminStatusBadge>
      <span className="text-muted-foreground">{record.provider === 'bank_transfer' ? '무통장 입금 · 계좌 송금' : '토스 결제 · 결제사 부분 취소'}</span>
    </p>
    <p className="wrap-anywhere">{orderPartialCancellationItemsLabel(record.items)} {record.reasonCode === 'return' ? '반품' : '취소'}</p>
    <p className="tabular-nums">환불 {krw(record.refundAmount)}{record.shippingRefundAmount > 0 ? ` (상품 ${krw(record.goodsRefundAmount)} + 배송비 ${krw(record.shippingRefundAmount)})` : ''}
      {record.returnFeeDeduction > 0 ? ` · 반품배송비 ${krw(record.returnFeeDeduction)} 차감` : ''}
      {record.refundAmount === 0 ? ' (상품별 결제 금액이 0원이라 결제사에 취소를 요청하지 않고 적용)' : ''}
      {record.storeCreditRestoreAmount > 0 ? ` · 적립금 ${krw(record.storeCreditRestoreAmount)} 되돌림` : ''}</p>
    {staff ? <>
      <p className="text-muted-foreground wrap-anywhere">{record.reasonCode === 'return' ? '반품 요청' : '고객이 정한 내용'}: {staff.customerDecision}{staff.note ? ` · 메모: ${staff.note}` : ''}</p>
      <p className={HINT}>{formatOrderDateTime(record.createdAt)}{staff.createdBy ? ` · ${staff.createdBy}` : ''}{staff.warehouseStopConfirmed ? ' · 창고 출고 중단 확인' : ''}
        {staff.closedShipments.length ? ` · 남는 상품이 없어 닫힌 배송 건 ${staff.closedShipments.map(shipment => shipment.shipmentNumber ?? shipment.originName).join(', ')}` : ''}</p>
      {staff.resolution ? <p className="wrap-anywhere" data-partial-cancellation-resolution={staff.resolution}>[해소] {ORDER_PARTIAL_CANCELLATION_RESOLUTION_LABELS[staff.resolution]}
        {staff.resolvedAt ? ` · ${formatOrderDateTime(staff.resolvedAt)}` : ''}{staff.resolutionReason ? ` · 사유: ${staff.resolutionReason}` : ''}</p> : null}
    </> : null}
    {record.state === 'rejected' && !staff?.resolution ? <AdminNotice tone="neutral">{record.reasonCode === 'return'
      ? '결제사가 이 결제의 부분 취소를 받지 않아 부분 반품 환불을 진행하지 않았습니다. 돈은 움직이지 않았습니다(전액 환불로 돌리지 않습니다). 결제 담당이 반품 요청 상세의 [계좌 송금 부분 환불로 전환]으로 처리합니다.'
      : '결제사가 이 결제의 부분 취소를 받지 않아 진행하지 않았습니다. 돈·주문·재고는 그대로입니다.'}</AdminNotice> : null}
    {(record.state === 'processing' || record.state === 'needs_review') ? <div className="flex flex-col gap-2">
      {record.reasonCode === 'return' ? (
        /* 부분 반품 환불의 결제사 확인은 반품 상세의 [환불 완료 확정]이 맡는다 — 품목별 재고 처리(불량 선택)를 거쳐야 해서 여기서 다시 부르지 않는다. */
        <AdminNotice tone={record.state === 'needs_review' ? 'danger' : 'info'}>
          결제사 부분 취소 확인 전입니다. 반품 요청 상세에서 [환불 완료 확정]으로 확인합니다. 그동안 반품한 상품의 배송 건과 이 주문의 다른 취소가 막힙니다.
          {staff?.lastErrorCode ? <ErrorCodeNote code={staff.lastErrorCode} /> : null}
        </AdminNotice>
      ) : <>
        <AdminNotice tone={record.state === 'needs_review' ? 'danger' : 'info'}>
          결제사 부분 취소 확인 전입니다. 확인이 끝날 때까지 이 주문은 출고지시·발송·다른 취소가 막힙니다.
          {staff?.lastErrorCode ? <> {orderPartialCancellationReconcileMessage(staff.lastErrorCode)}<ErrorCodeNote code={staff.lastErrorCode} /></> : null}
        </AdminNotice>
        {canManage ? <Button className="w-fit" disabled={pending} onClick={() => void retry()} type="button">{pending ? '확인 중…' : '결제사 확인 다시 하기'}</Button> : null}
      </>}
    </div> : null}
    {record.state === 'needs_review' && record.provider === 'toss' && canManage ? <details className="rounded-lg border px-3 py-2.5" data-partial-cancellation-resolve="">
      <summary className="cursor-pointer text-sm font-medium">결제사 확인이 계속 안 될 때 <span className="font-normal text-muted-foreground">· 결제 담당자</span></summary>
      <form className="mt-3 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void resolve(); }}>
        <p>결제사에 취소를 새로 요청하지 않고 잔액만 조회합니다. 잔액이 그대로면 ‘진행하지 않음’으로 닫고, 이 취소 금액만큼 줄었으면 이미 취소된 것으로 보고 적용하며, 둘 다 아니면 아무것도 바꾸지 않습니다.</p>
        <label className={FIELD}><span className="font-medium">해소 사유 (필수)</span>
          <input className="w-full" disabled={pending} maxLength={500} onChange={event => setResolveReason(event.target.value)} placeholder="예: [결제사 확인 다시 하기]를 여러 번 눌러도 같은 결과여서 잔액을 조회함" required value={resolveReason} />
          <small className={HINT}>5자 이상. 부분 취소 기록의 [해소] 줄에 남습니다.</small>
        </label>
        <Button className="w-fit" disabled={pending || resolveReason.trim().length < 5} type="submit" variant="outline">{pending ? '조회 중…' : '결제사 잔액 조회해 해소'}</Button>
      </form>
    </details> : null}
    {record.state === 'awaiting_transfer' && staff && canManage ? <form className="flex flex-col gap-3 border-t pt-3" onSubmit={transfer}>
      <p>송금할 환불액 <strong className="tabular-nums">{krw(record.refundAmount)}</strong>{staff.refundAccount ? ` · ${staff.refundAccount.maskedAccount} (${staff.refundAccount.maskedHolder})` : ''}</p>
      {account ? <p className="wrap-anywhere" role="status">{account.bankName} {account.accountNumber} · 예금주 {account.accountHolder}</p>
        : <Button className="w-fit" disabled={pending} onClick={() => void reveal()} type="button" variant="outline">계좌 원문 보기 (열람 기록)</Button>}
      <label className={FIELD}><span className="font-medium">송금 근거 (필수)</span>
        <input className="w-full" maxLength={300} onChange={event => setEvidence(event.target.value)} placeholder="예: 11/25 14:10 이체 완료 (이체 확인번호 12345)" required value={evidence} />
        <small className={HINT}>2자 이상. 이체 확인 번호·시각 등을 적고 계좌번호는 적지 마세요. 이 부분 취소 기록에 남습니다.</small>
      </label>
      <label className={FIELD}><span className="font-medium">확인 메모 (필수)</span>
        <input className="w-full" maxLength={300} onChange={event => setNote(event.target.value)} placeholder="예: 은행 앱의 이체 내역으로 금액을 확인함" required value={note} />
        <small className={HINT}>2자 이상. 감사 기록에 남고 이 화면에는 다시 보이지 않습니다.</small>
      </label>
      <Button className="w-fit" disabled={pending || evidence.trim().length < 2 || note.trim().length < 2} type="submit">{pending ? '기록 중…' : '송금 완료 기록'}</Button>
    </form> : null}
    {record.state === 'completed' && record.provider === 'bank_transfer' && staff?.transferEvidence ? <p className={HINT}>송금 완료 {record.transferredAt ? formatOrderDateTime(record.transferredAt) : ''} · {staff.transferEvidence}</p> : null}
    {message ? <p className="text-destructive" role="alert">{message}</p> : null}
  </li>;
}

/**
 * 부분 취소 확인창 본문. 어느 주문의 어느 상품이 몇 개 취소되고, 얼마가 환불되며, 무엇이 남는지를 말한다.
 * 금액은 확인창을 열 때 서버가 시작과 같은 계산으로 돌려준 값이라 실제 처리와 같다.
 */
export function PartialCancellationPlanSummary({ plan, orderNumber, needsAccount, bankReady }: {
  plan: OrderPartialCancellationPlan; orderNumber?: string | null; needsAccount: boolean; bankReady: boolean;
}) {
  return <div className="flex flex-col gap-2 text-sm" data-partial-cancellation-plan="">
    {orderNumber ? <p className="text-muted-foreground tabular-nums">주문 {orderNumber}</p> : null}
    <ul className="flex flex-col gap-1">{plan.lines.map(line => <li className="flex flex-wrap justify-between gap-2" key={line.orderItemId}>
      <span className="wrap-anywhere">{line.goodName}{line.variantName ? ` · ${line.variantName}` : ''} {line.qty}개 취소 (남는 수량 {line.remainingQtyAfter}개)</span>
      <span className="tabular-nums">{krw(line.goodsRefundAmount)}</span>
    </li>)}</ul>
    {plan.closedShipments.map(shipment => <p className="flex flex-wrap justify-between gap-2" key={shipment.shipmentId}>
      <span>배송비 함께 환불 · {shipment.originName} {shipment.shipmentNumber ?? ''} (남는 상품 없음)</span><span className="tabular-nums">{krw(shipment.shippingFeeRefund)}</span>
    </p>)}
    <p className="flex justify-between gap-2 border-t pt-2 font-semibold"><span>환불액</span><span className="tabular-nums">{krw(plan.refundAmount)}</span></p>
    <p className="text-muted-foreground">결제 {krw(plan.paymentAmount)} · 환불 전 남은 금액 {krw(plan.balanceBefore)} → 환불 뒤 {krw(plan.balanceAfter)}{plan.storeCreditRestoreAmount > 0 ? ` · 사용한 적립금 ${krw(plan.storeCreditRestoreAmount)}은 적립금으로 돌려줌` : ''}</p>
    <p className="text-muted-foreground">주문에 남는 상품은 {plan.remainingQty}개입니다. 발송 전인 상품은 그대로 출고합니다.{plan.balanceAfter === 0 && plan.refundAmount > 0 ? ' 이 취소로 남은 결제 금액이 0원이 됩니다.' : ''}</p>
    <p className="text-muted-foreground">남은 주문이 쿠폰 사용 조건을 채우는지는 따로 확인하지 않습니다.{plan.warehouseStopRequired ? ' 출고지시가 나간 배송 건이라 창고 회신 기록(출고 중단 확인)이 있어야 확정할 수 있습니다. 그 회신은 이 부분 취소에 한 번 쓰이고, 다른 취소에는 다시 쓸 수 없습니다.' : ''}</p>
    {needsAccount && !bankReady ? <p className="text-destructive" role="alert">환불받을 계좌(은행·계좌번호·예금주)를 모두 적어야 확정할 수 있습니다. 이 창을 닫고 ‘환불받을 계좌’를 적은 뒤 [취소 내용 확인]을 다시 눌러주세요.</p> : null}
  </div>;
}

export function OrderPartialCancellationPanelView({ orderId, orderNumber, context, onReload }: { orderId: string; orderNumber?: string | null; context: OrderPartialCancellationContext; onReload: (message?: string) => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [decision, setDecision] = useState('');
  const [note, setNote] = useState('');
  const [bank, setBank] = useState({ bankName: '', accountNumber: '', accountHolder: '' });
  const [plan, setPlan] = useState<OrderPartialCancellationPlan | null>(null);
  /* 확인창이 닫히는 동안(퇴장 애니메이션)에도 마지막 내용을 그대로 보여 제목 금액이 비는 깜박임을 없앤다. */
  const [lastPlan, setLastPlan] = useState<OrderPartialCancellationPlan | null>(null);
  if (plan && plan !== lastPlan) setLastPlan(plan);
  const shown = plan ?? lastPlan;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  useClaimPreviewBusy(pending);
  const open = context.enabled && context.canManage && context.blockers.length === 0;
  const bankTransfer = context.provider === 'bank_transfer';
  const selection = useMemo(() => Object.entries(draft).filter(([, qty]) => qty > 0).map(([orderItemId, qty]) => ({ orderItemId, qty })), [draft]);
  const exportedSelected = context.items.some(item => (draft[item.orderItemId] ?? 0) > 0 && item.exported);
  /* 출고지시가 나간 배송 건의 상품이면 그 배송 건의 창고 '출고 중단' 회신 기록이 근거다(ADR-0046) — 확인란이 아니다. */
  const exportedShipmentIds = [...new Set(context.items.filter(item => (draft[item.orderItemId] ?? 0) > 0 && item.exported && item.shipmentId)
    .map(item => item.shipmentId as string))];
  const ready = selection.length > 0 && decision.trim().length >= 2;
  /* [취소 내용 확인]이 잠겨 있으면 이유를 버튼 옆에 보인다. */
  const lockReason = ready ? null : selection.length === 0 ? '취소할 상품을 먼저 골라주세요.' : '고객이 정한 내용을 2자 이상 적어주세요.';
  // 무통장 환불계좌는 환불액이 있을 때만 받는다(0원이면 송금이 없어 DB가 계좌를 받지 않는다).
  const bankReady = Boolean(bank.bankName.trim() && /^[0-9-]{8,30}$/.test(bank.accountNumber.replace(/\s+/g, '')) && bank.accountHolder.trim());
  const needsAccount = bankTransfer && plan !== null && plan.refundAmount > 0;
  const confirmCopy = shown ? orderPartialCancellationConfirmCopy(shown) : null;
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
        warehouseStopConfirmed: exportedSelected, expectedRefundAmount: plan.refundAmount, operationId: operationId.current,
        refundAccount: needsAccount ? bank : null,
      });
      if (!result.ok) { setError(result.error); setPlan(null); return; }
      setPlan(null); setDraft({}); setDecision(''); setNote(''); setBank({ bankName: '', accountNumber: '', accountHolder: '' });
      operationId.current = null;
      onReload(result.value.message);
    } catch {
      setError('처리됐는지 확인하지 못했습니다. 새로고침해 아래 부분 취소 기록을 확인한 뒤, 기록이 없으면 같은 내용으로 다시 확정해주세요.');
    } finally { setPending(false); }
  }
  return <section aria-label="재고 부족 부분 취소" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-sm text-card-foreground" data-partial-cancellation-panel="" id="partial-cancellation">
    <div className="flex flex-col gap-1">
      <h3 className="text-base leading-snug font-medium">재고 부족 부분 취소</h3>
      <p className="text-muted-foreground">창고 재고가 모자란 상품만 고객이 정한 대로 취소하고, 나머지는 평소대로 출고합니다.</p>
    </div>
    {context.enabled && context.canManage && context.gift ? <AdminNotice role="status" tone="info">선물 주문입니다. 환불은 결제한 분에게 돌아가고, 고객이 정한 내용도 결제한 분의 결정으로 기록합니다.</AdminNotice> : null}
    {context.enabled && context.canManage && context.blockers.length ? <AdminNotice role="status" tone="warning">
      {orderPartialCancellationBlockerMessage(
        context.blockers[0],
        context.blockers[0]?.startsWith('partial_cancel_v1_allocation_') ? orderPartialCancellationV1AllocationIssueMessage(context.v1Allocation?.issue) : null,
      )}
    </AdminNotice> : null}
    {open ? <form className="flex min-w-0 flex-col gap-3" onSubmit={event => { event.preventDefault(); void preview(); }}>
      <ul className="flex flex-col gap-2">{context.items.map(item => {
        const blocked = orderPartialCancellationItemBlockerLabel(item.blocker);
        const value = draft[item.orderItemId] ?? 0;
        return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2" key={item.orderItemId}>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <input checked={value > 0} disabled={Boolean(blocked) || pending} onChange={event => setQty(item.orderItemId, event.target.checked ? Math.min(1, item.activeQty) : 0)} type="checkbox" />
            <span className="min-w-0 wrap-anywhere">{item.goodName}{item.variantName ? ` · ${item.variantName}` : ''}</span>
          </label>
          <span className="text-muted-foreground tabular-nums">남은 {item.activeQty}개{item.canceledQty ? ` (취소 ${item.canceledQty}개)` : ''}{item.shipmentNumber ? ` · 배송 건 ${item.shipmentNumber}` : ''}{item.exported ? ' · 출고지시 보냄' : ''}</span>
          {blocked ? <AdminStatusBadge>{blocked}</AdminStatusBadge> : value > 0 ? <label className="flex items-center gap-1.5">
            <span>취소 수량</span>
            <input aria-label={`${item.goodName} 취소 수량`} className="w-20 tabular-nums" disabled={pending} max={item.activeQty} min={1} onChange={event => setQty(item.orderItemId, Math.max(1, Math.min(item.activeQty, Number.parseInt(event.target.value, 10) || 1)))} type="number" value={value} />
          </label> : null}
        </li>;
      })}</ul>
      <label className={FIELD}><span className="font-medium">고객이 정한 내용 (필수)</span>
        <textarea className="w-full" disabled={pending} maxLength={500} onChange={event => { setDecision(event.target.value); setPlan(null); }} placeholder="예: 11/12 14:00 통화 — 품절 상품은 취소하고 나머지를 먼저 받기로 함" required rows={2} value={decision} />
        <small className={HINT}>언제 어떤 경로로 고객이 무엇을 정했는지 적습니다. 이 주문의 부분 취소 기록과 감사 기록에 남고 고객에게는 보이지 않습니다.</small>
      </label>
      <label className={FIELD}><span className="font-medium">메모 (선택)</span><input className="w-full" disabled={pending} maxLength={500} onChange={event => setNote(event.target.value)} value={note} /></label>
      {bankTransfer ? <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={pending}>
        <legend className="p-0 font-medium">환불받을 계좌 (무통장 주문)</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="은행" maxLength={40} onChange={event => setBank(current => ({ ...current, bankName: event.target.value }))} placeholder="은행" value={bank.bankName} />
          <input aria-label="계좌번호" inputMode="numeric" maxLength={30} onChange={event => setBank(current => ({ ...current, accountNumber: event.target.value }))} placeholder="계좌번호" value={bank.accountNumber} />
          <input aria-label="예금주" maxLength={40} onChange={event => setBank(current => ({ ...current, accountHolder: event.target.value }))} placeholder="예금주" value={bank.accountHolder} />
        </div>
        <small className={HINT}>고객이 알려 준 계좌를 적습니다. 화면에는 일부만 보이고, 송금을 마친 30일 뒤 계좌번호가 지워집니다. 환불액이 0원이면 적지 않습니다.</small>
      </fieldset> : null}
      {exportedSelected ? <WarehouseStopRequirementNote detailHref={`/admin/sales/orders/${orderId}`} orderId={orderId} shipmentIds={exportedShipmentIds} /> : null}
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button aria-describedby={lockReason ? `partial-cancellation-missing-${orderId}` : undefined} className="w-fit" disabled={!ready || pending} type="submit">{pending && !plan ? '확인 중…' : '취소 내용 확인'}</Button>
        {lockReason ? <span className={HINT} data-partial-cancellation-missing="" id={`partial-cancellation-missing-${orderId}`}>{lockReason}</span> : null}
      </div>
    </form> : null}
    {context.history.length ? <div className="flex flex-col gap-2">
      <h4 className="font-medium">부분 취소 기록</h4>
      <ol className="flex flex-col gap-2">{[...context.history].reverse().map(record => <HistoryEntry canManage={context.canManage} key={`${record.id}:${record.state}`} onChanged={onReload} orderId={orderId} record={record} />)}</ol>
    </div> : null}
    <AlertDialog onOpenChange={next => { if (!next && !pending) setPlan(null); }} open={plan !== null}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmCopy?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {shown ? <PartialCancellationPlanSummary bankReady={bankReady} needsAccount={needsAccount} orderNumber={orderNumber} plan={shown} /> : null}
        {error ? <p className="text-destructive" role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>돌아가기</AlertDialogCancel>
          <Button disabled={pending || (needsAccount && !bankReady)} onClick={() => void start()} type="button" variant="danger">{pending ? '처리 중…' : confirmCopy?.confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

/**
 * 주문 상세의 재고 부족 부분 취소(ADR-0032). 스위치가 꺼져 있고 기록이 없으면 아무것도 그리지 않는다(지금과 같은 화면).
 * 발송 전이 아닌 주문도 기록이 없으면 그리지 않는다.
 * `orderNumber`는 확인창 맨 위에 어느 주문인지 보이려는 선택값이다. 주지 않아도 처리는 같고 확인창에 주문번호 줄만 빠진다.
 */
export function OrderPartialCancellationPanel({ orderId, orderNumber }: { orderId: string; orderNumber?: string | null }) {
  const [context, setContext] = useState<OrderPartialCancellationContext | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadOrderPartialCancellationAction(orderId).then(result => { if (active && result.ok) setContext(result.value); }, () => undefined);
    return () => { active = false; };
  }, [orderId, refresh]);
  if (!context || !orderPartialCancellationPanelVisible(context)) return null;
  return <div className="flex min-w-0 flex-col gap-2">
    {message ? <AdminNotice role="status" tone="info">{message}</AdminNotice> : null}
    <OrderPartialCancellationPanelView context={context} key={`${orderId}:${refresh}`} onReload={next => { setMessage(next ?? null); setRefresh(value => value + 1); }} orderId={orderId} orderNumber={orderNumber} />
  </div>;
}
