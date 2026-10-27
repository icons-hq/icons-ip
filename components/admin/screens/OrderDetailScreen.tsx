import { OrderProductionPanel } from '@/components/admin/OrderProductionPanel';
import { AdminOrderDownloads } from '@/components/admin/AdminOrderDownloads';
import type { AdminOrderDownloads as DownloadDocument } from '@/lib/admin/order-downloads';
import type { OrderProduction } from '@/lib/order-production';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { shipmentStatusLabel, type ShipmentStatus } from '@/lib/orders/shipments';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import type { AdminOrderDetail, AdminOrderTimelineEntry, AdminOrderTimelineSource } from '@/lib/admin/order-detail';
import type { OrderItemAllocation } from '@/lib/admin/item-allocation';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { isOrderClaimType, ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { OrderNoteForm } from './OrderNoteForm';
import { PurchaseConfirmationPanel } from '@/components/orders/PurchaseConfirmationPanel';
import { ShipmentPreorderPromisePanel } from '@/components/admin/ShipmentPreorderPromisePanel';
import { ShipmentDeliveryPanel } from '@/components/admin/ShipmentDeliveryPanel';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { SellerClaimIntakeButton } from './SellerClaimIntakeForm';
import { OrderAddressButton } from './OrderAddressEditor';
import { ShippingCollectPanel } from '@/components/admin/ShippingCollectPanel';

const SOURCE_LABELS: Record<AdminOrderTimelineSource, string> = {
  order: '주문', payment: '결제', refund: '환불', status: '상태 변경', shipment: '배송·송장',
  claim: V.claims, inquiry: '문의', email: '메일', note: '운영자 메모',
};
const ACTION_LABELS: Record<string, string> = {
  'order.purchase_confirmation.request': '구매확정 요청', 'order.purchase_confirmation.hold': '구매확정 보류',
  'order.purchase_confirmation.resume': '구매확정 보류 해제', 'order.purchase_confirmation.extend': '구매자 기간 연장', 'order.purchase_confirmation.confirm': '구매자 직접 확정',
  'admin.shipment.status_updated': '배송 건 상태 변경', 'admin.shipment.tracking_updated': '배송 건 운송장 수정',
  'order.preorder_stock_allocated': '예약 재고 할당', 'order.preorder_capacity_released': '예약 물량 해제',
  'admin.shipment.preorder_promise_changed': '예약 발송 일정 변경',
  'admin.shipment.delivery_method_selected': '배송 방식 변경', 'admin.shipment.delivery_evidence_recorded': '인계·수령 근거 기록',
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
};
const STATUS_LABELS: Record<string, string> = {
  pending: '대기', paid: '결제완료', failed: '실패', canceled: '취소', refunded: '환불',
  partial_refunded: '부분 환불', requested: '접수', done: '완료', completed: '완료',
  awaiting_transfer: '환불 송금 대기',
  sent: '발송 완료', open: '미답변', answered: '답변 완료', closed: '종결',
};
const shipmentState = (status: string) => ['ready','shipping','delivered','canceled'].includes(status) ? shipmentStatusLabel(status as ShipmentStatus) : '상태 변경';
const orderStatus = (status: string) => (ADMIN_ORDER_STATUS_LABELS as Record<string, string>)[status] ?? '변경';
const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const dateTime = (value: string) => new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** 주문 할인·적립금을 품목에 나눈 값(거래확정 엑셀과 같은 규칙). 할인이 없는 주문은 표시하지 않는다. */
function ItemAllocationSummary({ allocation, discounted }: { allocation?: OrderItemAllocation; discounted: boolean }) {
  if (!discounted) return null;
  if (!allocation) return <span>할인·적립금 배분 · 주문 당시 기록이 없어 나누지 않았습니다</span>;
  const parts = [allocation.volumeDiscount ? `복수구매 −${money(allocation.volumeDiscount)}` : '', `쿠폰 −${money(allocation.couponDiscount)}`,
    `적립금 −${money(allocation.storeCreditDiscount)}`].filter(Boolean);
  return <><span>{parts.join(' · ')}</span><span>배분 후 {money(allocation.paidGoodsTotal)} · 배송비 제외</span></>;
}

function entryTitle(entry: AdminOrderTimelineEntry) {
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
  const status = entry.status ? (entry.source === 'claim' ? (ORDER_CLAIM_STAGE_LABELS as Record<string, string>)[entry.status] : STATUS_LABELS[entry.status]) : null;
  const href = entry.relatedId && entry.source === 'inquiry' ? `/admin/cs/inquiries/${entry.relatedId}`
    : entry.relatedId && entry.source === 'claim' && isOrderClaimType(entry.claimType)
      ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[entry.claimType]}/${entry.relatedId}` : null;
  const stateLabel = (value: string) => entry.action === 'admin.shipment.delivery_method_selected'
    ? (DELIVERY_METHOD_LABELS as Record<string, string>)[value] ?? '배송 방식' : entry.shipmentId ? shipmentState(value) : orderStatus(value);
  return <li className="admin-order-detail__event">
    <div className="admin-order-detail__event-meta">
      <AdminStatusBadge tone={entry.source === 'note' ? 'warning' : 'neutral'}>{digital && entry.source === 'shipment' ? '디지털 파일' : SOURCE_LABELS[entry.source]}</AdminStatusBadge>
      <time dateTime={entry.occurredAt}>{dateTime(entry.occurredAt)}</time>
      {entry.actorName ? <span>{entry.actorName}</span> : null}
    </div>
    <h4>{digital && entry.source === 'shipment' && entry.action === 'delivered' ? '파일 제공 시작' : entryTitle(entry)}</h4>
    {entry.fromStatus && entry.toStatus ? <p>{stateLabel(entry.fromStatus)} → {stateLabel(entry.toStatus)}</p> : null}
    {entry.amount != null ? <p>{money(entry.amount)}{entry.provider ? ` · ${entry.provider === 'korpay' ? 'Korpay' : entry.provider === 'toss' ? 'Toss' : '결제사'}` : ''}</p> : null}
    {status ? <p className="admin-order-detail__muted">현재 상태 · {status}</p> : null}
    {entry.shipmentId ? <p>{entry.originName ?? '배송 건'} · {entry.shipmentId}</p> : null}
    {entry.trackingNumber ? <p>운송장 · {entry.carrier} {entry.trackingNumber}</p> : null}
    {entry.body ? <p className="admin-order-detail__body">{entry.body}</p> : null}
    {href ? <Link href={href}>{entry.source === 'inquiry' ? '문의 상세 열기' : '요청 상세 열기'}</Link> : null}
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
}) {
  const { order, items } = detail;
  const orderDiscounted = order.discountTotal > 0 || order.storeCreditTotal > 0 || (order.transaction?.totals.volumeDiscountTotal ?? 0) > 0;
  const digitalShipments = new Set(detail.shipments.filter(shipment => shipment.delivery?.method === 'digital').map(shipment => shipment.id));
  const timeline = (canManage ? detail.timeline : detail.timeline.filter(entry => ['order', 'shipment'].includes(entry.source)))
    .filter(entry => !(entry.source === 'shipment' && entry.action === 'shipped' && entry.shipmentId && digitalShipments.has(entry.shipmentId)));
  const addressNotRequired = detail.shipments.length > 0 && detail.shipments.every(shipment => shipment.delivery && ['pickup', 'none', 'digital'].includes(shipment.delivery.method));
  return <div className="admin-order-detail">
    <AdminPageHeader title="주문 상세" description={order.orderNumber ?? order.id} actions={<>
      <Link href={backHref} className="admin-order-detail__button admin-order-detail__button--secondary">{backLabel}</Link>
      {canManage ? <Link href={`/admin/sales/orders?status=all&query=${order.id}&order=${order.id}`} className="admin-order-detail__button">주문 처리</Link> : null}
      {canManage && !addressNotRequired ? <OrderAddressButton orderId={order.id} /> : null}
      {canManage && ['shipping', 'delivered', 'done'].includes(order.status) ? <SellerClaimIntakeButton orderId={order.id} /> : null}
      {canManage && (order.status === 'pending' || order.status === 'paid') ? <SellerClaimIntakeButton orderId={order.id} mode="cancel" /> : null}
    </>} />
    {actorId && production !== undefined ? <OrderProductionPanel initial={production} actorId={actorId} canManage={canManage} /> : null}
    <div className="admin-order-detail__overview">
      <AdminSectionCard title="주문 정보">
        <dl className="admin-order-detail__facts">
          <div><dt>현재 상태</dt><dd><AdminStatusBadge>{orderStatus(order.status)}</AdminStatusBadge></dd></div>
          <div><dt>주문 일시</dt><dd>{dateTime(order.createdAt)}</dd></div>
          <div><dt>주문자</dt><dd>{order.buyerName || '이름 미등록'}{order.buyerEmail ? <span>{order.buyerEmail}</span> : null}{canViewCustomer ? <Link href={`/admin/customers/${order.userId}`}>고객 상세 열기</Link> : null}</dd></div>
          <div><dt>주문 금액</dt><dd>{money(order.total)}</dd></div>
          <div><dt>배송비 / 쿠폰 할인 / 적립금 사용</dt><dd>{money(order.shippingFee)} / {money(order.discountTotal)} / {money(order.storeCreditTotal)}</dd></div>
          {order.transaction && <>
            <div><dt>복수구매 할인</dt><dd>{money(order.transaction.totals.volumeDiscountTotal)}</dd></div>
            <div><dt>온라인 결제금액 / 착불 배송비</dt><dd>{money(order.transaction.totals.onlineTotal)} / {money(order.transaction.totals.collectShippingTotal)} · 착불은 별도 수납 원장으로 확인</dd></div>
          </>}
          {order.isGift && <div><dt>선물 배송</dt><dd>수령인 배송지 · 수령인용 포장 명세에는 가격·결제정보를 제외합니다.</dd></div>}
        </dl>
      </AdminSectionCard>
      <AdminSectionCard title="배송 정보">
        {order.addressNeedsReview && <p role="status">주문 당시 주소 형식 확인이 필요합니다. 배송 처리 전 원본 기록과 수령 주소를 확인해주세요.</p>}
        {addressNotRequired ? <p>배송 주소가 필요하지 않은 수령 방식입니다.</p> : <dl className="admin-order-detail__facts">
          <div><dt>수령자</dt><dd>{order.address.recipientName || '정보 없음'}</dd></div>
          <div><dt>연락처</dt><dd>{order.address.phone || '정보 없음'}</dd></div>
          <div><dt>배송지</dt><dd>{order.address.postalCode ? `(${order.address.postalCode}) ` : ''}{order.address.address1 || '정보 없음'} {order.address.address2}</dd></div>
          <div><dt>배송 요청</dt><dd>{order.address.deliveryNote || '없음'}</dd></div>
        </dl>}
      </AdminSectionCard>
    </div>
    {downloads !== undefined && <AdminOrderDownloads document={downloads} />}
    <AdminSectionCard title="배송 건별 현황">
      <ShipmentDetails admin shipments={detail.shipments} items={items} transactionShipping={order.transaction?.shipping} />
      {actorId && (order.transaction?.totals.collectShippingTotal ?? 0) > 0 ? <ShippingCollectPanel key={`${actorId}:${order.id}`} orderId={order.id} expectedActorId={actorId} canManage={canManage} /> : null}
      {canManage ? detail.shipments.map(shipment => <ShipmentDeliveryPanel orderId={order.id} shipmentId={shipment.id} shipmentNumber={shipment.shipmentNumber} originName={shipment.originName} key={shipment.id} />) : null}
      {canManage ? detail.shipments.filter(shipment => shipment.originalExpectedShipDate).map(shipment => <ShipmentPreorderPromisePanel orderId={order.id} shipmentId={shipment.id} key={shipment.id} />) : null}
      {canManage && detail.emailJobs.length ? <section aria-label="배송 메일 처리 상태">
        <h3>배송 안내 메일</h3>
        <ul>{detail.emailJobs.map(job=><li key={job.shipmentId}>
          <strong>{detail.shipments.find(shipment=>shipment.id===job.shipmentId)?.originName ?? '배송 건'} · {detail.shipments.find(shipment=>shipment.id===job.shipmentId)?.shipmentNumber ?? job.shipmentId}</strong>
          <p>{{pending:'발송 대기',processing:'발송 처리 중',completed:'처리 완료',review:'운영자 확인 필요'}[job.status]} · 시도 {job.attempts}회</p>
          {job.lastErrorCode ? <p>확인 코드 · {job.lastErrorCode}</p> : null}
          <time dateTime={job.updatedAt}>{dateTime(job.updatedAt)}</time>
        </li>)}</ul>
      </section> : null}
    </AdminSectionCard>
    <AdminSectionCard title="주문 상품">
      <ul className="admin-order-detail__items">{items.map((item) => <li key={item.id} id={`item-${item.id}`}>
        <div><strong>{item.name}</strong>{item.variantName ? <span>{item.variantName} · {item.variantCode}</span> : null}<GoodsCustomInputsSummary selection={item.customInputs} /><span>{item.type} · {item.qty}개</span></div>
        <div><strong>{money(item.unitPrice * item.qty)}</strong><span>개당 {money(item.unitPrice)}</span><ItemAllocationSummary allocation={detail.itemAllocations?.[item.id]} discounted={orderDiscounted} /></div>
      </li>)}</ul>
      {!items.length ? <p>주문 상품 기록이 없습니다.</p> : null}
    </AdminSectionCard>
    <div className="admin-order-detail__workspace">
      <AdminSectionCard title="주문 타임라인">
        <p className="admin-order-detail__muted">이른 기록부터 표시합니다. 각 원장의 현재 처리 상태를 함께 확인할 수 있습니다.</p>
        <ol className="admin-order-detail__timeline">{timeline.map((entry) => <TimelineEntry key={entry.id} entry={entry} digital={Boolean(entry.shipmentId && digitalShipments.has(entry.shipmentId))} />)}</ol>
      </AdminSectionCard>
      {canManage ? <AdminSectionCard title="구매확정·운영자 메모">
        {actorId && ['delivered', 'done'].includes(order.status) ? <PurchaseConfirmationPanel key={`confirmation:${order.id}`} orderId={order.id} actorId={actorId} admin /> : null}
        <OrderNoteForm key={order.id} orderId={order.id} initialOperationId={noteOperationId} />
      </AdminSectionCard> : null}
    </div>
  </div>;
}
