import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { shipmentStatusLabel, type ShipmentRecord } from '@/lib/orders/shipments';

export function ShipmentDetails({ shipments, items = [], admin = false }: {
  shipments: readonly ShipmentRecord[];
  items?: readonly { id: string; name: string; qty: number; variantName?: string | null }[];
  admin?: boolean;
}) {
  return <div aria-label="배송 건별 정보">{shipments.map(shipment => <section className={admin ? 'admin-order-detail__shipment' : 'order-receipt-section wc-shipment-details'} key={shipment.id}>
    <h3>{shipment.originName} · {shipmentStatusLabel(shipment.status)}</h3>
    <dl className={admin ? 'admin-order-detail__facts' : 'order-payment-summary'}>
      <div><dt>배송 건 번호</dt><dd>{shipment.id}</dd></div>
      <div><dt>배송비</dt><dd>{krw(shipment.shippingFee)}</dd></div>
      <div><dt>택배사</dt><dd>{shipment.carrierLabel ?? '발송 준비 중'}</dd></div>
      <div><dt>운송장번호</dt><dd>{shipment.trackingNumber ?? '미등록'}</dd></div>
      {shipment.shippedAt ? <div><dt>발송일시</dt><dd><time dateTime={shipment.shippedAt}>{formatOrderDateTime(shipment.shippedAt)}</time></dd></div> : null}
      {shipment.deliveredAt ? <div><dt>배송 완료일시</dt><dd><time dateTime={shipment.deliveredAt}>{formatOrderDateTime(shipment.deliveredAt)}</time></dd></div> : null}
    </dl>
    {items.some(item => shipment.orderItemIds.includes(item.id)) ? <ul>{items.filter(item => shipment.orderItemIds.includes(item.id)).map(item => <li key={item.id}>{item.name}{item.variantName ? ` · ${item.variantName}` : ''} × {item.qty}</li>)}</ul> : null}
    {shipment.trackingUrl ? <a className={admin ? 'admin-order-detail__link' : 'btn btn-ghost order-tracking-link'} href={shipment.trackingUrl} rel="noreferrer" target="_blank">{shipment.originName} 배송조회</a> : null}
  </section>)}</div>;
}
