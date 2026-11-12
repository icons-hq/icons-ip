import { OrderProductionPanel } from '@/components/admin/OrderProductionPanel';
import { AdminOrderDownloads } from '@/components/admin/AdminOrderDownloads';
import type { AdminOrderDownloads as DownloadDocument } from '@/lib/admin/order-downloads';
import type { OrderProduction } from '@/lib/order-production';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { shipmentStatusLabel, type ShipmentStatus } from '@/lib/orders/shipments';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import Link from 'next/link';
import { AdminNotice, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminPageHeading } from '@/components/admin/console/admin-shell-title';
import { LARGE_STATUS_BADGE_CLASS, OrderStatusBadge } from '@/components/admin/sales/OrderStatusBadge';
import { ShortId } from '@/components/admin/sales/SalesConsole';
import { ConsoleTableHeader } from '@/components/admin/console';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import type { AdminOrderDetail, AdminOrderTimelineEntry, AdminOrderTimelineSource } from '@/lib/admin/order-detail';
import type { OrderItemAllocation } from '@/lib/admin/item-allocation';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { isParcelShipment } from '@/lib/admin/shipment-dispatch';
import { forcedDeliveryHref } from '@/lib/admin/forced-delivery';
import { statusTone } from '@/lib/admin/status-tone';
import { krw } from '@/lib/format';
import { formatOrderDateTime, refundStatusLabel } from '@/lib/orders';
import { isOpenOrderClaimStage, isOrderClaimStage, isOrderClaimType, ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { OrderNoteForm } from './OrderNoteForm';
import { PurchaseConfirmationPanel } from '@/components/orders/PurchaseConfirmationPanel';
import { ShipmentPreorderPromisePanel } from '@/components/admin/ShipmentPreorderPromisePanel';
import { ShipmentDeliveryPanel } from '@/components/admin/ShipmentDeliveryPanel';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { SellerClaimIntakeButton } from './SellerClaimIntakeForm';
import { OrderAddressButton } from './OrderAddressEditor';
import { ShippingCollectPanel } from '@/components/admin/ShippingCollectPanel';
import { OrderPartialCancellationPanel } from '@/components/admin/OrderPartialCancellationPanel';

const SOURCE_LABELS: Record<AdminOrderTimelineSource, string> = {
  order: '주문', payment: '결제', refund: '환불', status: '상태 변경', shipment: '배송·운송장',
  claim: V.claims, inquiry: '문의', email: '메일', note: '운영자 메모',
};
const ACTION_LABELS: Record<string, string> = {
  'order.purchase_confirmation.request': '구매확정 요청', 'order.purchase_confirmation.hold': '구매확정 보류',
  'order.purchase_confirmation.resume': '구매확정 보류 해제', 'order.purchase_confirmation.extend': '구매자 기간 연장', 'order.purchase_confirmation.confirm': '구매자 직접 확정',
  'admin.shipment.status_updated': '배송 건 상태 변경', 'admin.shipment.tracking_updated': '배송 건 운송장 수정',
  'admin.shipment.extra_tracking_added': '추가 운송장 등록', 'admin.shipment.extra_tracking_removed': '추가 운송장 삭제',
  'system.shipment.tracking_delivered': '배송완료 (택배 추적 자동)',
  'order.preorder_stock_allocated': '예약 재고 할당', 'order.preorder_capacity_released': '예약 물량 해제',
  'admin.shipment.preorder_promise_changed': '예약 발송 일정 변경',
  'admin.shipment.delivery_method_selected': '배송 방식 변경', 'admin.shipment.delivery_evidence_recorded': '인계·수령 근거 기록',
  'admin.order.forced_delivered': '강제 배송완료',
  'admin.order.address_changed': '배송지 변경',
  'admin.order.status_updated': '주문 상태 변경', 'admin.order.tracking_updated': '운송장 수정',
  'admin.order.note': '운영자 메모', 'admin.order.dispatch_delay_noted': '발송 지연 기록',
  'admin.order.dispatch_delay_cleared': '발송 지연 해제',
  'admin.order.cancellation_approved': '취소 승인', 'admin.order.cancellation_rejected': '취소 거부',
  'admin.order.cancellation_completed': '취소 완료', 'admin.order.cancellation_needs_review': '취소 확인 필요',
  'system.order.cancellation_completed': '취소 완료 (자동)', 'system.order.cancellation_needs_review': '취소 확인 필요 (자동)',
  'system.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (자동)',
  'order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료 (구매자 취소)',
  'admin.order.staff_cancellation_started': '운영자 전액 취소 시작',
  'admin.order.cancellation_reconcile_started': '취소 대조 시작',
  'admin.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료',
  'admin.order.bank_transfer_canceled': '무통장 주문 취소', 'admin.order.bank_transfer_confirmed': '무통장 입금 확인',
  'admin.order.bank_transfer_extended': '무통장 입금 기한 연장',
  'admin.order.claim_approved': '요청 승인', 'admin.order.claim_collected': '반송 상품 입고',
  'admin.order.claim_held': '요청 보류', 'admin.order.claim_in_review': '요청 검토 시작',
  'admin.order.claim_refund_completed': '환불 완료', 'admin.order.claim_refund_filed': '환불 접수',
  'admin.order.claim_rejected': '요청 거부', 'admin.order.claim_reshipped': '교환 상품 발송',
  'admin.order.claim_resumed': '요청 처리 재개',
  'admin.order.claim_intake_created': '판매자 대리 접수',
  'order.claim_withdrawn': '고객 요청 철회',
  'order.claim_refund_account_confirmed': '고객 환불계좌 등록',
  'admin.order.bank_refund_confirm_cancellation': '무통장 취소 확정 · 재고 복원',
  'admin.order.bank_refund_file_transfer': '계좌 송금 접수',
  'admin.order.bank_refund_complete_transfer': '계좌 송금 완료',
  'system.order.unpaid_cart_order_closed': '결제 대기 주문 자동 취소 (재주문·장바구니 복귀)',
  'system.order.cart_hold_detached': '장바구니 보류 해제 (결제 확인 필요 주문)',
};
/** 같은 감사 action이라도 시스템이 남긴 기록은 출처(trigger)로 구분한다. */
const TRIGGER_LABELS: Record<string, Record<string, string>> = {
  'admin.order.status_updated': { auto_order_confirmation: '자동 발주확인 (시스템)' },
  /* 상품 편집의 예약 주문 발송 일정 일괄 변경(QNA-040)이 남긴 배송 건 일정 변경 — 주문 상세에서 하나씩 바꾼 변경과 나눈다. */
  'admin.shipment.preorder_promise_changed': { goods_preorder_bulk: '예약 발송 일정 변경 (상품 일괄 · 고객 안내)' },
  /* 고객이 주문서·장바구니의 '결제 대기 주문 취소하고 계속'을 눌러 닫은 주문(ADR-0030). 재주문·장바구니 복귀의 자동 정리와 나눈다. */
  'system.order.unpaid_cart_order_closed': { customer_released: '고객이 진행 중인 미결제 주문을 취소하고 주문을 계속함' },
};
/** 고객이 직접 눌러 시스템이 처리한 기록(감사 action은 system.*이다). 취소 주체를 구매자로 적는다. */
const CUSTOMER_TRIGGERS = new Set(['customer_released']);
const STATUS_LABELS: Record<string, string> = {
  pending: '대기', paid: '결제완료', failed: '실패', canceled: '취소', refunded: '환불',
  partial_refunded: '부분 환불', requested: '접수', done: '완료', completed: '완료',
  awaiting_transfer: '환불 송금 대기',
  sent: '발송 완료', open: '미답변', answered: '답변 완료', closed: '종결',
};
const shipmentState = (status: string) => ['ready','shipping','delivered','canceled'].includes(status) ? shipmentStatusLabel(status as ShipmentStatus) : '상태 변경';
const orderStatus = (status: string) => (ADMIN_ORDER_STATUS_LABELS as Record<string, string>)[status] ?? '변경';
/* 배송 건별 현황(공개 부품 ShipmentDetails)과 주문 목록이 ₩로 적으므로 이 화면의 금액도 같은 표기를 쓴다. */
const money = krw;
/* 날짜는 목록·클레임 상세와 같은 표기다. */
const dateTime = formatOrderDateTime;

/* 주문 상세의 사실 목록·품목 보조 줄(템플릿 룩, ADR-0028). 배송 건별 정보(ShipmentDetails)는 공개 부품이라 그 모양은 admin-order-detail.css가 맡는다. */
const FACTS = 'grid gap-3';
const FACT_ROW = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]';
const FACT_TERM = 'text-muted-foreground';
const FACT_VALUE = 'min-w-0 wrap-anywhere';
const ITEM_NOTE = 'text-sm text-muted-foreground';
const EVENT_TEXT = 'mt-1 text-sm leading-relaxed wrap-anywhere';
const CELL_AMOUNT = 'text-right align-top tabular-nums';
/* 금액을 깎는 줄은 부호를 붙여 어느 쪽으로 더해지는지 위치로 맞춰 읽지 않게 한다. */
const minus = (value: number) => value > 0 ? `−${money(value)}` : money(0);

/** 주문 할인·적립금을 품목에 나눈 값(거래확정 엑셀과 같은 규칙). 할인이 없는 주문은 표시하지 않는다.
 * 조회 실패(`unavailable`)는 나눌 수 없는 주문과 다르게 안내한다 — 기록이 없다고 잘못 알리지 않는다. */
function ItemAllocationSummary({ allocation, discounted, unavailable = false }: { allocation?: OrderItemAllocation; discounted: boolean; unavailable?: boolean }) {
  if (!discounted) return null;
  if (unavailable) return <span className={ITEM_NOTE}>할인·적립금 배분 · 배분을 불러오지 못했습니다. 잠시 후 새로고침해 다시 확인해주세요</span>;
  if (!allocation) return <span className={ITEM_NOTE}>할인·적립금 배분 · 주문 당시 기록이 없어 나누지 않았습니다</span>;
  const parts = [allocation.volumeDiscount ? `복수구매 −${money(allocation.volumeDiscount)}` : '', `쿠폰 −${money(allocation.couponDiscount)}`,
    `적립금 −${money(allocation.storeCreditDiscount)}`].filter(Boolean);
  return <><span className={ITEM_NOTE}>{parts.join(' · ')}</span><span className={ITEM_NOTE}>배분 후 {money(allocation.paidGoodsTotal)} · 배송비 제외</span></>;
}

/** 주문 콘솔 패널(sections/Orders)에서 지금 이어서 할 일. '주문 처리'만으로는 어떤 처리인지 알 수 없다. 운송장이 빠진 배송 건이 있으면 그것부터다. */
function orderNextStep(status: AdminOrderStatus, hasOpenClaim: boolean, hasParcel: boolean, trackingMissing: boolean) {
  if (hasOpenClaim) return '요청 확인';
  if (status === 'paid') return '발주확인';
  if (status === 'confirmed' && hasParcel) return '운송장 등록';
  if (status === 'shipping' && hasParcel) return trackingMissing ? '운송장 등록' : '배송완료';
  return null;
}

/* 취소 주문에서 제일 궁금한 돈 이야기. 결제된 적이 없는 주문의 '환불 없음'과 결제했는데 환불 기록이 없는 주문을 다르게 말한다. */
function canceledMoneySummary(timeline: AdminOrderTimelineEntry[]) {
  const refund = [...timeline].reverse().find(entry => entry.source === 'refund') ?? null;
  const payments = timeline.filter(entry => entry.source === 'payment');
  /* 결제사에서 취소된 결제와 결제가 끝나지 않은 시도를 '결제 전'으로 뭉뚱그리지 않는다. */
  return { refund, charged: payments.some(entry => entry.status === 'paid'), reversed: payments.some(entry => entry.status === 'canceled' || entry.status === 'refunded' || entry.status === 'partial_refunded') };
}
/* 취소를 만든 기록. 감사 로그에 남은 경우에만 언제·누가를 적고, 없으면 지어내지 않는다. */
const CANCEL_ACTIONS = /(cancellation_completed|bank_transfer_canceled|unpaid_cart_order_closed)$/;
function canceledEntry(timeline: AdminOrderTimelineEntry[]) {
  return [...timeline].reverse().find(entry => entry.toStatus === 'canceled' || CANCEL_ACTIONS.test(entry.action)) ?? null;
}
function cancelActor(entry: AdminOrderTimelineEntry) {
  if (entry.actorName) return entry.actorName;
  if (entry.trigger && CUSTOMER_TRIGGERS.has(entry.trigger)) return '구매자';
  if (entry.action.startsWith('system.')) return '시스템 자동 처리';
  if (entry.action.startsWith('order.')) return '구매자';
  return null;
}

function entryTitle(entry: AdminOrderTimelineEntry) {
  const triggered = entry.trigger ? TRIGGER_LABELS[entry.action]?.[entry.trigger] : undefined;
  if (triggered) return triggered;
  if (ACTION_LABELS[entry.action]) return ACTION_LABELS[entry.action];
  switch (entry.source) {
    case 'order': return '주문 생성';
    case 'payment': return '결제 기록';
    case 'refund': return entry.action === 'completed' ? '환불 처리 완료' : '환불 접수';
    case 'shipment': return entry.action === 'delivered' ? '배송 완료' : '상품 발송';
    case 'claim': return `${isOrderClaimType(entry.claimType) ? ORDER_CLAIM_TYPE_LABELS[entry.claimType] : V.claimRequest} 접수`;
    case 'inquiry': return entry.title || '문의 접수';
    case 'email': return ({ order_confirmation: '주문 확인 메일', order_shipped: '배송 안내 메일', inquiry_answered: '문의 답변 메일' } as Record<string, string>)[entry.action] ?? '메일 발송 기록';
    default: return '주문 운영 변경';
  }
}

function TimelineEntry({ entry, digital = false }: { entry: AdminOrderTimelineEntry; digital?: boolean }) {
  const status = entry.status ? (entry.source === 'claim'
    ? isOrderClaimType(entry.claimType) && isOrderClaimStage(entry.status) ? adminClaimStageLabel(entry.claimType, entry.status) : (ORDER_CLAIM_STAGE_LABELS as Record<string, string>)[entry.status]
    : STATUS_LABELS[entry.status]) : null;
  const href = entry.relatedId && entry.source === 'inquiry' ? `/admin/cs/inquiries/${entry.relatedId}`
    : entry.relatedId && entry.source === 'claim' && isOrderClaimType(entry.claimType)
      ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[entry.claimType]}/${entry.relatedId}` : null;
  const stateLabel = (value: string) => entry.action === 'admin.shipment.delivery_method_selected'
    ? (DELIVERY_METHOD_LABELS as Record<string, string>)[value] ?? '배송 방식' : entry.shipmentId ? shipmentState(value) : orderStatus(value);
  return <li className="relative ml-1.5 border-l pb-7 pl-6 last:pb-0 before:absolute before:top-2 before:-left-[5px] before:size-[9px] before:rounded-full before:border before:border-foreground before:bg-background before:content-['']" data-order-timeline-entry="">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <AdminStatusBadge tone={entry.source === 'note' ? 'warning' : 'neutral'}>{digital && entry.source === 'shipment' ? '디지털 파일' : SOURCE_LABELS[entry.source]}</AdminStatusBadge>
      <time className="tabular-nums" dateTime={entry.occurredAt}>{dateTime(entry.occurredAt)}</time>
      {entry.actorName ? <span>{entry.actorName}</span> : null}
    </div>
    <h3 className="mt-2.5 mb-1 text-sm font-medium text-foreground wrap-anywhere">{digital && entry.source === 'shipment' && entry.action === 'delivered' ? '파일 제공 시작' : entryTitle(entry)}</h3>
    {entry.fromStatus && entry.toStatus ? <p className={EVENT_TEXT}>{stateLabel(entry.fromStatus)} → {stateLabel(entry.toStatus)}</p> : null}
    {entry.amount != null ? <p className={`${EVENT_TEXT} tabular-nums`}>{money(entry.amount)}{entry.provider ? ` · ${entry.provider === 'korpay' ? 'Korpay' : entry.provider === 'toss' ? 'Toss' : entry.provider === 'nicepay' ? 'NICEPAY' : '결제사'}` : ''}</p> : null}
    {status ? <p className={`${EVENT_TEXT} text-muted-foreground`}>현재 상태 · {status}</p> : null}
    {entry.shipmentId ? <p className={EVENT_TEXT}>{entry.originName ?? '배송 건'} · <ShortId value={entry.shipmentId} /></p> : null}
    {entry.trackingNumber ? <p className={EVENT_TEXT}>운송장 · {entry.carrier} {entry.trackingNumber}</p> : null}
    {entry.body ? <p className={`${EVENT_TEXT} whitespace-pre-wrap`}>{entry.body}</p> : null}
    {href ? <Link className="inline-flex min-h-10 items-center text-sm underline underline-offset-4" href={href}>{entry.source === 'inquiry' ? '문의 상세 열기' : '요청 상세 열기'}</Link> : null}
  </li>;
}

export function OrderDetailScreen({
  backHref = '/admin/sales/orders',
  backLabel = '주문 목록',
  detail,
  noteOperationId,
  production,
  downloads,
  canManage = true,
  canViewCustomer = true,
  actorId,
  embedded = false,
}: {
  backHref?: string;
  backLabel?: string;
  detail: AdminOrderDetail;
  noteOperationId: string;
  production?: OrderProduction | null;
  downloads?: DownloadDocument | null;
  canManage?: boolean;
  canViewCustomer?: boolean;
  actorId?: string;
  /** 목록 위 상세 팝업(S36-075) 안. 목록 돌아가기 버튼은 팝업 닫기와 겹치고 기록을 쌓으며 스크롤을 올리므로 숨긴다. */
  embedded?: boolean;
}) {
  const { order, items } = detail;
  const orderDiscounted = order.discountTotal > 0 || order.storeCreditTotal > 0 || (order.transaction?.totals.volumeDiscountTotal ?? 0) > 0;
  const digitalShipments = new Set(detail.shipments.filter(shipment => shipment.delivery?.method === 'digital').map(shipment => shipment.id));
  const timeline = (canManage ? detail.timeline : detail.timeline.filter(entry => ['order', 'shipment'].includes(entry.source)))
    .filter(entry => !(entry.source === 'shipment' && entry.action === 'shipped' && entry.shipmentId && digitalShipments.has(entry.shipmentId)));
  const addressNotRequired = detail.shipments.length > 0 && detail.shipments.every(shipment => shipment.delivery && ['pickup', 'none', 'digital'].includes(shipment.delivery.method));
  const hasOpenClaim = detail.timeline.some(entry => entry.source === 'claim' && isOrderClaimStage(entry.status) && isOpenOrderClaimStage(entry.status));
  const trackingMissing = detail.shipments.filter(shipment => isParcelShipment(shipment) && shipment.status === 'shipping' && !shipment.trackingNumber).length;
  const nextStep = orderNextStep(order.status, hasOpenClaim, !detail.shipments.length || detail.shipments.some(isParcelShipment), trackingMissing > 0);
  /* 취소 주문에서 제일 궁금한 것은 환불이 됐는지다. 타임라인의 환불 기록을 머리 아래로 올린다. 사유는 요청 상세에 있어 그리로 잇는다. */
  const canceled = order.status === 'canceled';
  const { refund: latestRefund, charged, reversed } = canceledMoneySummary(canceled ? timeline : []);
  const canceledClaim = canceled ? [...timeline].reverse().find(entry => entry.source === 'claim' && entry.relatedId && isOrderClaimType(entry.claimType)) ?? null : null;
  const cancelRecord = canceled ? canceledEntry(timeline) : null;
  const cancelBy = cancelRecord ? cancelActor(cancelRecord) : null;
  const consoleHref = `/admin/sales/orders?status=all&query=${order.id}&order=${order.id}`;
  /* 상품 금액은 저장돼 있지 않아 품목으로 더한다. 더한 값이 결제금액과 맞을 때만 적어 틀린 합계를 보이지 않는다. */
  const goodsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const volumeDiscount = order.transaction?.totals.volumeDiscountTotal ?? 0;
  const goodsTotalMatches = goodsTotal + order.shippingFee - order.discountTotal - order.storeCreditTotal - volumeDiscount === order.total;
  /* 배송 건이 하나면 품목 줄이 맨 위 주문 상품과 겹친다. 여러 건일 때만 어떤 상품이 어느 건에 있는지 남긴다. */
  const shipmentItemsRedundant = detail.shipments.length === 1;
  return <div className="flex min-w-0 flex-col gap-6" data-order-detail-screen="">
    {/* 이 주문의 번호와 지금 상태를 맨 위 한 줄에서 먼저 읽고, 같은 줄 오른쪽에서 처리한다. */}
    <header className="flex flex-wrap items-center justify-between gap-3" data-admin-kit="page-header">
      <section aria-label="주문 현재 상태" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-order-status-strip="">
        <AdminPageHeading title="주문 상세" />
        <strong className="text-base font-semibold tabular-nums">{order.orderNumber ?? order.id}</strong>
        <OrderStatusBadge className={LARGE_STATUS_BADGE_CLASS} status={order.status} />
        <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">{canceled && !charged && !reversed && !latestRefund ? '주문금액' : '결제금액'}</span><strong className="text-base font-semibold tabular-nums">{money(order.total)}</strong></span>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {embedded ? null : <Link href={backHref} className={buttonVariants({ variant: 'outline' })} data-slot="button">{backLabel}</Link>}
        {canManage ? <Link href={trackingMissing ? `${consoleHref}#sales-order-detail` : consoleHref} className={buttonVariants({ variant: nextStep ? 'default' : 'outline' })} data-slot="button">{nextStep ? `주문 처리 · ${nextStep}` : canceled ? '주문 통합검색에서 보기' : '주문 처리'}</Link> : null}
        {/* 끝난 주문의 배송지는 바꿀 일이 없다. 바뀐 이력은 아래 타임라인에 남아 있다. */}
        {canManage && !addressNotRequired && !canceled ? <OrderAddressButton orderId={order.id} /> : null}
        {canManage && ['shipping', 'delivered', 'done'].includes(order.status) ? <SellerClaimIntakeButton orderId={order.id} /> : null}
        {canManage && (order.status === 'pending' || order.status === 'paid') ? <SellerClaimIntakeButton orderId={order.id} mode="cancel" /> : null}
        {/* QA1 S-T04-05: 발주확인 뒤 발송 전·배송 중 주문은 발주·발송 화면의 강제 배송완료 카드를 이 주문번호로 바로 연다(사유·확인창·감사는 카드에서). */}
        {canManage && order.orderNumber && (order.status === 'confirmed' || order.status === 'shipping')
          ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={forcedDeliveryHref(order.orderNumber)}>강제 배송완료</Link> : null}
      </div>
    </header>
    {canceled && canManage ? <div data-order-cancel-result="">
      <AdminNotice role="status" tone={!latestRefund && charged ? 'warning' : 'neutral'} title={latestRefund
        ? <span className="flex flex-wrap items-center gap-2">환불 <AdminStatusBadge tone={statusTone('refund', latestRefund.status)}>{latestRefund.status ? refundStatusLabel(latestRefund.status) : '환불 기록'}</AdminStatusBadge>{latestRefund.amount != null ? <span className="tabular-nums">{money(latestRefund.amount)}</span> : null}</span>
        : charged ? '결제 기록은 있는데 환불 기록이 없습니다' : reversed ? '결제가 취소된 주문입니다. 별도 환불 기록은 없습니다' : '결제 전에 취소된 주문이라 환불할 금액이 없습니다'}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {cancelRecord ? <span className="tabular-nums">취소 {dateTime(cancelRecord.occurredAt)}{cancelBy ? ` · ${cancelBy}` : ''}</span> : null}
          {canceledClaim?.relatedId && isOrderClaimType(canceledClaim.claimType) ? <Link className="underline underline-offset-4" href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[canceledClaim.claimType]}/${canceledClaim.relatedId}`}>취소 사유 보기</Link> : !cancelRecord ? <span>취소 경위는 아래 주문 타임라인에서 확인할 수 있습니다.</span> : null}
        </div>
      </AdminNotice>
    </div> : null}
    {/* 운송장이 빠졌다는 경고는 눌러야 할 일이라 머리 바로 아래에 둔다. 등록은 바로 위 주 버튼 하나로 간다 — 같은 일을 하는 버튼이 둘이면 다른 일인지 망설인다. */}
    {trackingMissing ? <AdminNotice role="status" tone="warning" title={`배송 중인데 운송장이 없는 배송 건이 ${trackingMissing}건 있습니다`}>
      배송완료로 처리하기 전에 택배사와 운송장번호를 등록해주세요.
    </AdminNotice> : null}
    {actorId && production !== undefined ? <OrderProductionPanel initial={production} actorId={actorId} canManage={canManage} /> : null}
    {/* 무엇을 샀는지가 주문을 읽는 출발점이라 맨 위에 표로 둔다. */}
    <AdminSectionCard title="주문 상품">
      {items.length ? <div className="min-w-0 overflow-x-auto rounded-lg border"><Table>
        <caption className="sr-only">주문 상품</caption>
        <ConsoleTableHeader><TableRow>
          <TableHead scope="col">상품명</TableHead><TableHead scope="col">옵션</TableHead>
          <TableHead className="text-right" scope="col">수량</TableHead><TableHead className="text-right" scope="col">개당</TableHead><TableHead className="text-right" scope="col">금액</TableHead>
        </TableRow></ConsoleTableHeader>
        <TableBody>{items.map((item) => <TableRow className="scroll-mt-4" key={item.id} id={`item-${item.id}`}>
          <TableCell className="align-top whitespace-normal"><div className="flex min-w-48 flex-col gap-0.5 wrap-anywhere"><strong className="font-medium">{item.name}</strong><span className={ITEM_NOTE}>{item.type}</span><GoodsCustomInputsSummary selection={item.customInputs} /></div></TableCell>
          <TableCell className="align-top whitespace-normal">{item.variantName ? <span className="inline-flex min-w-28 flex-wrap items-center gap-1.5">{item.variantName} · {item.variantCode}{item.optionSaleMode === 'random' ? <AdminStatusBadge>랜덤 배정</AdminStatusBadge> : null}</span> : item.optionSaleMode === 'random' ? <AdminStatusBadge>랜덤 배정</AdminStatusBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className={CELL_AMOUNT}>{item.qty}개</TableCell>
          <TableCell className={CELL_AMOUNT}>{money(item.unitPrice)}</TableCell>
          <TableCell className={`${CELL_AMOUNT} whitespace-normal`}><div className="flex min-w-24 flex-col items-end gap-0.5"><strong className="font-semibold">{money(item.unitPrice * item.qty)}</strong><ItemAllocationSummary allocation={detail.itemAllocations?.[item.id]} discounted={orderDiscounted} unavailable={detail.itemAllocationsUnavailable} /></div></TableCell>
        </TableRow>)}</TableBody>
      </Table></div> : <p className="text-muted-foreground">주문 상품 기록이 없습니다.</p>}
    </AdminSectionCard>
    {/* 기록은 조회 권한(sales.read)에도 보인다 — 처리 버튼은 DB가 알려주는 canManage로만 그린다. */}
    <OrderPartialCancellationPanel key={order.id} orderId={order.id} />
    {/* 두 칸은 lg부터다 — 768에서는 사이드바 옆 본문이 좁아 값 칸이 글자 단위로 끊긴다. */}
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <AdminSectionCard title="주문 정보">
        <dl className={FACTS}>
          <div className={FACT_ROW}><dt className={FACT_TERM}>현재 상태</dt><dd className={FACT_VALUE}><OrderStatusBadge status={order.status} /></dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>주문 일시</dt><dd className={FACT_VALUE}>{dateTime(order.createdAt)}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>주문자</dt><dd className={FACT_VALUE}>{order.buyerName || '이름 미등록'}{order.buyerEmail ? <span className="mt-1 block text-xs text-muted-foreground">{order.buyerEmail}</span> : null}{canViewCustomer ? <Link className="mt-1 block w-fit underline underline-offset-4" href={`/admin/customers/${order.userId}`}>고객 상세</Link> : null}</dd></div>
          {goodsTotalMatches ? <div className={FACT_ROW}><dt className={FACT_TERM}>상품 금액</dt><dd className={`${FACT_VALUE} tabular-nums`}>{money(goodsTotal)}</dd></div> : null}
          <div className={FACT_ROW}><dt className={FACT_TERM}>배송비</dt><dd className={`${FACT_VALUE} tabular-nums`}>{money(order.shippingFee)}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>쿠폰 할인</dt><dd className={`${FACT_VALUE} tabular-nums`}>{minus(order.discountTotal)}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>적립금 사용</dt><dd className={`${FACT_VALUE} tabular-nums`}>{minus(order.storeCreditTotal)}</dd></div>
          {order.transaction && <>
            <div className={FACT_ROW}><dt className={FACT_TERM}>복수구매 할인</dt><dd className={`${FACT_VALUE} tabular-nums`}>{minus(order.transaction.totals.volumeDiscountTotal)}</dd></div>
            <div className={FACT_ROW}><dt className={FACT_TERM}>온라인 결제금액 / 착불 배송비</dt><dd className={FACT_VALUE}>{money(order.transaction.totals.onlineTotal)} / {money(order.transaction.totals.collectShippingTotal)} · 착불은 별도 수납 원장으로 확인</dd></div>
          </>}
          <div className={`${FACT_ROW} border-t pt-3`}><dt className="font-medium">최종 결제금액</dt><dd className={`${FACT_VALUE} text-base font-semibold tabular-nums`}>{money(order.total)}</dd></div>
          {order.isGift && <div className={FACT_ROW}><dt className={FACT_TERM}>선물 배송</dt><dd className={FACT_VALUE}>수령인 배송지 · 수령인용 포장 명세에는 가격·결제정보를 제외합니다.</dd></div>}
        </dl>
      </AdminSectionCard>
      <AdminSectionCard title="배송 정보">
        {order.addressNeedsReview && <AdminNotice role="status" tone="warning">주문 당시 주소 형식 확인이 필요합니다. 배송 처리 전 원본 기록과 수령 주소를 확인해주세요.</AdminNotice>}
        {addressNotRequired ? <p className="text-muted-foreground">배송 주소가 필요하지 않은 수령 방식입니다.</p> : <dl className={FACTS}>
          <div className={FACT_ROW}><dt className={FACT_TERM}>수령자</dt><dd className={FACT_VALUE}>{order.address.recipientName || '정보 없음'}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>연락처</dt><dd className={FACT_VALUE}>{order.address.phone || '정보 없음'}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>배송지</dt><dd className={FACT_VALUE}>{order.address.postalCode ? `(${order.address.postalCode}) ` : ''}{order.address.address1 || '정보 없음'} {order.address.address2}</dd></div>
          <div className={FACT_ROW}><dt className={FACT_TERM}>배송 요청</dt><dd className={FACT_VALUE}>{order.address.deliveryNote || '없음'}</dd></div>
        </dl>}
      </AdminSectionCard>
    </div>
    {downloads !== undefined && <AdminOrderDownloads document={downloads} />}
    <AdminSectionCard title="배송 건별 현황">
      <div className={shipmentItemsRedundant ? '[&_section>ul]:hidden' : undefined}><ShipmentDetails admin shipments={detail.shipments} items={items} transactionShipping={order.transaction?.shipping} /></div>
      {actorId && (order.transaction?.totals.collectShippingTotal ?? 0) > 0 ? <ShippingCollectPanel key={`${actorId}:${order.id}`} orderId={order.id} expectedActorId={actorId} canManage={canManage} /> : null}
      {canManage ? detail.shipments.map(shipment => <ShipmentDeliveryPanel orderId={order.id} shipmentId={shipment.id} shipmentNumber={shipment.shipmentNumber} originName={shipment.originName} key={shipment.id} />) : null}
      {canManage ? detail.shipments.filter(shipment => shipment.originalExpectedShipDate).map(shipment => <ShipmentPreorderPromisePanel orderId={order.id} shipmentId={shipment.id} key={shipment.id} />) : null}
      {canManage && detail.emailJobs.length ? <section className="flex flex-col gap-2 border-t pt-4" aria-label="배송 메일 처리 상태">
        <h3 className="text-sm font-medium text-foreground">배송 안내 메일</h3>
        <ul className="flex flex-col gap-2">{detail.emailJobs.map(job=><li className="flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 wrap-anywhere" key={job.shipmentId}>
          <strong className="font-medium">{detail.shipments.find(shipment=>shipment.id===job.shipmentId)?.originName ?? '배송 건'} · {detail.shipments.find(shipment=>shipment.id===job.shipmentId)?.shipmentNumber ?? job.shipmentId}</strong>
          <p className="flex flex-wrap items-center gap-2"><AdminStatusBadge tone={statusTone('shipmentEmail', job.status)}>{{pending:'발송 대기',processing:'발송 처리 중',completed:'처리 완료',review:'운영자 확인 필요'}[job.status]}</AdminStatusBadge> 시도 {job.attempts}회</p>
          {job.lastErrorCode ? <p className="text-muted-foreground">확인 코드 · {job.lastErrorCode}</p> : null}
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={job.updatedAt}>{dateTime(job.updatedAt)}</time>
        </li>)}</ul>
      </section> : null}
    </AdminSectionCard>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(17.5rem,1fr)]">
      <AdminSectionCard title="주문 타임라인">
        <p className="text-sm text-muted-foreground">이른 기록부터 표시합니다. 각 원장의 현재 처리 상태를 함께 확인할 수 있습니다.</p>
        <ol className="mt-2 flex flex-col">{timeline.map((entry) => <TimelineEntry key={entry.id} entry={entry} digital={Boolean(entry.shipmentId && digitalShipments.has(entry.shipmentId))} />)}</ol>
      </AdminSectionCard>
      {canManage ? <AdminSectionCard title="구매확정·운영자 메모">
        {actorId && ['delivered', 'done'].includes(order.status) ? <PurchaseConfirmationPanel key={`confirmation:${order.id}`} orderId={order.id} actorId={actorId} admin /> : null}
        <OrderNoteForm key={order.id} orderId={order.id} initialOperationId={noteOperationId} />
      </AdminSectionCard> : null}
    </div>
  </div>;
}
