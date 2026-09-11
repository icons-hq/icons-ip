import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { shipmentStatusLabel, type ShipmentRecord } from '@/lib/orders/shipments';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel } from '@/lib/shipment-delivery';
import { ShipmentReceiptConfirmation } from './ShipmentReceiptConfirmation';

export function ShipmentDetails({ shipments, items = [], admin = false }: {
  shipments: readonly ShipmentRecord[];
  items?: readonly { id: string; name: string; qty: number; variantName?: string | null; supplySource?: 'stock' | 'preorder'; preorderExpectedShipDate?: string | null }[];
  admin?: boolean;
}) {
  return <div aria-label="배송 건별 정보">{shipments.map(shipment => <section className={admin ? 'admin-order-detail__shipment' : 'order-receipt-section wc-shipment-details'} key={shipment.id}>
    <h3>{shipment.originName} · {shipment.delivery ? deliveryStatusLabel(shipment.delivery.method, shipment.status) : shipmentStatusLabel(shipment.status)}</h3>
    <dl className={admin ? 'admin-order-detail__facts' : 'order-payment-summary'}>
      <div><dt>배송 건 번호</dt><dd>{shipment.id}</dd></div>
      <div><dt>배송비</dt><dd>{krw(shipment.shippingFee)}</dd></div>
      <div><dt>배송 방식</dt><dd>{shipment.delivery ? DELIVERY_METHOD_LABELS[shipment.delivery.method] : shipment.delivery === undefined ? '택배' : '확인 필요'}</dd></div>
      {shipment.regionalShipping?.regionalFee != null && shipment.regionalShipping.regionMode === 'managed' ? <div>
        <dt>포함된 지역 추가 배송비</dt><dd>{krw(shipment.regionalShipping.regionalFee)}
          {shipment.regionalShipping.regionLabel ? ` · ${shipment.regionalShipping.regionLabel}` : ''}</dd>
      </div> : null}
      {admin && shipment.regionalShipping ? <div><dt>주문 당시 지역 배송 정책</dt><dd>
        {shipment.regionalShipping.regionMode === 'legacy_base_only' ? '지역 요금표 미등록 · 기존 배송비로 확정' : `버전 ${shipment.regionalShipping.policyVersion} · ${shipment.regionalShipping.carrierCode}`}
        {shipment.regionalShipping.regionMode === 'managed' && shipment.regionalShipping.regionalContractFee != null
          ? ` · 계약 추가료 ${krw(shipment.regionalShipping.regionalContractFee)} × ${shipment.regionalShipping.unitCount}${shipment.regionalShipping.feeUnit === 'per_good' ? '개 상품' : '건'}` : ''}
      </dd></div> : null}
      {shipment.originalExpectedShipDate ? <div><dt>주문 당시 발송 예정일</dt><dd>{goodsShipDateLabel(shipment.originalExpectedShipDate)}</dd></div> : null}
      {shipment.expectedShipDate && shipment.expectedShipDate !== shipment.originalExpectedShipDate ? <div><dt>변경된 발송 예정일</dt><dd>{goodsShipDateLabel(shipment.expectedShipDate)}</dd></div> : null}
      {admin && shipment.preorderReady === false ? <div><dt>예약 출고 준비</dt><dd>실제 입고 물량 할당과 발송 예정일을 확인해주세요.</dd></div> : null}
      {shipment.delivery?.providerName ? <div><dt>퀵 배송 업체</dt><dd>{shipment.delivery.providerName}</dd></div> : null}
      {shipment.delivery === undefined || shipment.delivery?.method === 'parcel' ? <>
        <div><dt>택배사</dt><dd>{shipment.carrierLabel ?? (shipment.status === 'ready' ? '발송 준비 중' : '미등록')}</dd></div>
        <div><dt>운송장번호</dt><dd>{shipment.trackingNumber ?? '미등록'}</dd></div>
      </> : null}
      {shipment.shippedAt ? <div><dt>발송일시</dt><dd><time dateTime={shipment.shippedAt}>{formatOrderDateTime(shipment.shippedAt)}</time></dd></div> : null}
      {shipment.deliveredAt ? <div><dt>배송 완료일시</dt><dd><time dateTime={shipment.deliveredAt}>{formatOrderDateTime(shipment.deliveredAt)}</time></dd></div> : null}
    </dl>
    {shipment.delivery?.policy ? <div className="col" style={{ gap: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <p style={{ margin: 0 }}><strong>인계 안내</strong><br />{shipment.delivery.policy.handoffLocation}<br />{shipment.delivery.policy.handoffInstructions}</p>
      <p style={{ margin: 0 }}>연락처: {shipment.delivery.policy.contactName} · {shipment.delivery.policy.contactPhone}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.appointmentInstructions}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.completionInstructions}<br />대리수령: {shipment.delivery.policy.allowDelegate ? '안내 조건에 따라 가능' : '불가'}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.cancellationInstructions}</p>
      <small className="muted">고객 요청으로 배송 방식을 변경했으며 주문 당시 배송비를 유지합니다.</small>
      {!admin && shipment.delivery.canIssueReceipt ? <ShipmentReceiptConfirmation key={`${shipment.id}:${shipment.delivery.policy.policyId}`} shipmentId={shipment.id} /> : null}
    </div> : null}
    {items.some(item => shipment.orderItemIds.includes(item.id)) ? <ul>{items.filter(item => shipment.orderItemIds.includes(item.id)).map(item => <li key={item.id}>{item.name}{item.variantName ? ` · ${item.variantName}` : ''} × {item.qty}
      {item.supplySource === 'preorder' ? ` · 예약판매 (${goodsShipDateLabel(item.preorderExpectedShipDate)})` : ''}</li>)}</ul> : null}
    {shipment.trackingUrl && (shipment.delivery === undefined || shipment.delivery?.method === 'parcel') ? <a className={admin ? 'admin-order-detail__link' : 'btn btn-ghost order-tracking-link'} href={shipment.trackingUrl} rel="noreferrer" target="_blank">{shipment.originName} 배송조회</a> : null}
  </section>)}</div>;
}
