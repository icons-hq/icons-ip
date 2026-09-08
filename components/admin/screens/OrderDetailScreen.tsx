import { shipmentStatusLabel, type ShipmentStatus } from '@/lib/orders/shipments';
import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import type { AdminOrderDetail, AdminOrderTimelineEntry, AdminOrderTimelineSource } from '@/lib/admin/order-detail';
import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { isOrderClaimType, ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { OrderNoteForm } from './OrderNoteForm';

const SOURCE_LABELS: Record<AdminOrderTimelineSource, string> = {
  order: '주문', payment: '결제', refund: '환불', status: '상태 변경', shipment: '배송·송장',
  claim: V.claims, inquiry: '문의', email: '메일', note: '운영자 메모',
};
const ACTION_LABELS: Record<string, string> = {
  'admin.shipment.status_updated': '배송 건 상태 변경', 'admin.shipment.tracking_updated': '배송 건 운송장 수정',
  'admin.order.status_updated': '주문 상태 변경', 'admin.order.tracking_updated': '운송장 수정',
  'admin.order.note': '운영자 메모', 'admin.order.dispatch_delay_noted': '발송 지연 기록',
  'admin.order.dispatch_delay_cleared': '발송 지연 해제',
  'admin.order.cancellation_approved': '취소 승인', 'admin.order.cancellation_rejected': '취소 거부',
  'admin.order.cancellation_completed': '취소 완료', 'admin.order.cancellation_needs_review': '취소 확인 필요',
  'admin.order.cancellation_reconcile_started': '취소 대조 시작',
  'admin.order.prepared_goods_cancellation_completed': '결제 준비 건 취소 완료',
  'admin.order.bank_transfer_canceled': '무통장 주문 취소', 'admin.order.bank_transfer_confirmed': '무통장 입금 확인',
  'admin.order.bank_transfer_extended': '무통장 입금 기한 연장',
  'admin.order.claim_approved': '요청 승인', 'admin.order.claim_collected': '반송 상품 입고',
  'admin.order.claim_held': '요청 보류', 'admin.order.claim_in_review': '요청 검토 시작',
  'admin.order.claim_refund_completed': '환불 완료', 'admin.order.claim_refund_filed': '환불 접수',
  'admin.order.claim_rejected': '요청 거부', 'admin.order.claim_reshipped': '교환 상품 발송',
  'admin.order.claim_resumed': '요청 처리 재개',
};
const STATUS_LABELS: Record<string, string> = {
  pending: '대기', paid: '결제 완료', failed: '실패', canceled: '취소', refunded: '환불',
  partial_refunded: '부분 환불', requested: '접수', done: '완료', completed: '완료',
  sent: '발송 완료', open: '미답변', answered: '답변 완료', closed: '종결',
};
const shipmentState = (status: string) => ['ready','shipping','delivered','canceled'].includes(status) ? shipmentStatusLabel(status as ShipmentStatus) : '상태 변경';
const orderStatus = (status: string) => (ADMIN_ORDER_STATUS_LABELS as Record<string, string>)[status] ?? '변경';
const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const dateTime = (value: string) => new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

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

function TimelineEntry({ entry }: { entry: AdminOrderTimelineEntry }) {
  const status = entry.status ? (entry.source === 'claim' ? (ORDER_CLAIM_STAGE_LABELS as Record<string, string>)[entry.status] : STATUS_LABELS[entry.status]) : null;
  const href = entry.relatedId && entry.source === 'inquiry' ? `/admin/cs/inquiries/${entry.relatedId}`
    : entry.relatedId && entry.source === 'claim' && isOrderClaimType(entry.claimType)
      ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[entry.claimType]}/${entry.relatedId}` : null;
  return <li className="admin-order-detail__event">
    <div className="admin-order-detail__event-meta">
      <AdminStatusBadge tone={entry.source === 'note' ? 'warning' : 'neutral'}>{SOURCE_LABELS[entry.source]}</AdminStatusBadge>
      <time dateTime={entry.occurredAt}>{dateTime(entry.occurredAt)}</time>
      {entry.actorName ? <span>{entry.actorName}</span> : null}
    </div>
    <h4>{entryTitle(entry)}</h4>
    {entry.fromStatus && entry.toStatus ? <p>{entry.shipmentId ? shipmentState(entry.fromStatus) : orderStatus(entry.fromStatus)} → {entry.shipmentId ? shipmentState(entry.toStatus) : orderStatus(entry.toStatus)}</p> : null}
    {entry.amount != null ? <p>{money(entry.amount)}{entry.provider ? ` · ${entry.provider === 'korpay' ? 'Korpay' : entry.provider === 'toss' ? 'Toss' : '결제사'}` : ''}</p> : null}
    {status ? <p className="admin-order-detail__muted">현재 상태 · {status}</p> : null}
    {entry.shipmentId ? <p>{entry.originName ?? '배송 건'} · {entry.shipmentId}</p> : null}
    {entry.trackingNumber ? <p>운송장 · {entry.carrier} {entry.trackingNumber}</p> : null}
    {entry.body ? <p className="admin-order-detail__body">{entry.body}</p> : null}
    {href ? <Link href={href}>{entry.source === 'inquiry' ? '문의 상세 열기' : '요청 상세 열기'}</Link> : null}
  </li>;
}

export function OrderDetailScreen({ detail, noteOperationId }: { detail: AdminOrderDetail; noteOperationId: string }) {
  const { order, items, timeline } = detail;
  return <div className="admin-order-detail">
    <AdminPageHeader title="주문 상세" description={order.id} actions={<>
      <Link href="/admin/sales/orders" className="admin-order-detail__button admin-order-detail__button--secondary">주문 목록</Link>
      <Link href={`/admin/sales/orders?status=all&query=${order.id}&order=${order.id}`} className="admin-order-detail__button">주문 처리</Link>
    </>} />
    <div className="admin-order-detail__overview">
      <AdminSectionCard title="주문 정보">
        <dl className="admin-order-detail__facts">
          <div><dt>현재 상태</dt><dd><AdminStatusBadge>{orderStatus(order.status)}</AdminStatusBadge></dd></div>
          <div><dt>주문 일시</dt><dd>{dateTime(order.createdAt)}</dd></div>
          <div><dt>주문자</dt><dd>{order.buyerName || '탈퇴 회원'}{order.buyerEmail ? <span>{order.buyerEmail}</span> : null}<Link href={`/admin/customers/${order.userId}`}>고객 상세 열기</Link></dd></div>
          <div><dt>주문 금액</dt><dd>{money(order.total)}</dd></div>
          <div><dt>배송비 / 할인</dt><dd>{money(order.shippingFee)} / {money(order.discountTotal)}</dd></div>
        </dl>
      </AdminSectionCard>
      <AdminSectionCard title="배송 정보">
        <dl className="admin-order-detail__facts">
          <div><dt>수령자</dt><dd>{order.address.recipientName || '정보 없음'}</dd></div>
          <div><dt>연락처</dt><dd>{order.address.phone || '정보 없음'}</dd></div>
          <div><dt>배송지</dt><dd>{order.address.postalCode ? `(${order.address.postalCode}) ` : ''}{order.address.address1 || '정보 없음'} {order.address.address2}</dd></div>
          <div><dt>배송 요청</dt><dd>{order.address.deliveryNote || '없음'}</dd></div>
        </dl>
      </AdminSectionCard>
    </div>
    <AdminSectionCard title="배송 건별 현황">
      <ShipmentDetails admin shipments={detail.shipments} items={items} />
      {detail.emailJobs.length ? <section aria-label="배송 메일 처리 상태">
        <h3>배송 안내 메일</h3>
        <ul>{detail.emailJobs.map(job=><li key={job.shipmentId}>
          <strong>{detail.shipments.find(shipment=>shipment.id===job.shipmentId)?.originName ?? '배송 건'} · {job.shipmentId}</strong>
          <p>{{pending:'발송 대기',processing:'발송 처리 중',completed:'처리 완료',review:'운영자 확인 필요'}[job.status]} · 시도 {job.attempts}회</p>
          {job.lastErrorCode ? <p>확인 코드 · {job.lastErrorCode}</p> : null}
          <time dateTime={job.updatedAt}>{dateTime(job.updatedAt)}</time>
        </li>)}</ul>
      </section> : null}
    </AdminSectionCard>
    <AdminSectionCard title="주문 상품">
      <ul className="admin-order-detail__items">{items.map((item) => <li key={item.id}>
        <div><strong>{item.name}</strong>{item.variantName ? <span>{item.variantName} · {item.variantCode}</span> : null}<span>{item.type} · {item.qty}개</span></div>
        <div><strong>{money(item.unitPrice * item.qty)}</strong><span>개당 {money(item.unitPrice)}</span></div>
      </li>)}</ul>
      {!items.length ? <p>주문 상품 기록이 없습니다.</p> : null}
    </AdminSectionCard>
    <div className="admin-order-detail__workspace">
      <AdminSectionCard title="주문 타임라인">
        <p className="admin-order-detail__muted">이른 기록부터 표시합니다. 각 원장의 현재 처리 상태를 함께 확인할 수 있습니다.</p>
        <ol className="admin-order-detail__timeline">{timeline.map((entry) => <TimelineEntry key={entry.id} entry={entry} />)}</ol>
      </AdminSectionCard>
      <AdminSectionCard title="운영자 메모">
        <OrderNoteForm key={order.id} orderId={order.id} initialOperationId={noteOperationId} />
      </AdminSectionCard>
    </div>
  </div>;
}
