import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { shipmentStatusLabel, type ShipmentRecord } from '@/lib/orders/shipments';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { DELIVERY_METHOD_LABELS, deliveryStatusLabel } from '@/lib/shipment-delivery';
import { ShipmentReceiptConfirmation } from './ShipmentReceiptConfirmation';
import type { GoodsTransactionShippingGroup } from '@/lib/goods-transaction';
import { ShippingChargeDetailsDisplay } from './ShippingChargeDetailsDisplay';
import { shipmentGroupLabel } from '@/lib/fulfillment';
import { commerceReferenceLabel } from '@/lib/commerce-number';

export function ShipmentDetails({ shipments, items = [], admin = false, transactionShipping }: {
  shipments: readonly ShipmentRecord[];
  items?: readonly { id: string; goodId?: string; name: string; qty: number; variantName?: string | null; supplySource?: 'stock' | 'preorder'; preorderExpectedShipDate?: string | null }[];
  admin?: boolean;
  transactionShipping?: readonly GoodsTransactionShippingGroup[];
}) {
  const names = Object.fromEntries(items.flatMap(item => item.goodId ? [[item.goodId, item.name]] : []));
  /* 출고지 이름(김포·남양주)은 운영 개념이라 고객 화면에는 내지 않는다(10/14 회의 S7).
     고객은 택배 배송 건의 택배사로 부르고, 택배사를 모르면 '배송 묶음 N'이다(R26).
     어드민은 출고지별로 처리하므로 이름을 그대로 본다. */
  const carriers = shipments.map(shipment => ({ carrierLabel: shipment.delivery === undefined || shipment.delivery?.method === 'parcel' ? shipment.carrierLabel : null }));
  return <div aria-label="배송 건별 정보">{shipments.map((shipment, index) => {
    const groupName = admin ? shipment.originName : shipmentGroupLabel(carriers, index);
    const candidates = transactionShipping?.filter(group => group.originId === shipment.originId) ?? [];
    const charge = candidates.length === 1 ? candidates[0] : candidates.find(group => group.components.every(component => items.some(item => item.goodId === component.goodId && shipment.orderItemIds.includes(item.id))));
    return <section className={admin ? 'admin-order-detail__shipment' : 'order-receipt-section wc-shipment-details'} key={shipment.id}>
    <h3>{groupName} · {shipment.delivery ? deliveryStatusLabel(shipment.delivery.method, shipment.status) : shipmentStatusLabel(shipment.status)}</h3>
    <dl className={admin ? 'admin-order-detail__facts' : 'order-payment-summary'}>
      <div><dt>배송건번호</dt><dd className="mono">{commerceReferenceLabel(shipment.id, shipment.shipmentNumber)}</dd></div>
      <div><dt>{transactionShipping ? '선불 배송비' : '배송비'}</dt><dd>{krw(shipment.shippingFee)}</dd></div>
      {charge && charge.collectFee > 0 && <div><dt>착불 배송비 · 수령 시 별도</dt><dd>{krw(charge.collectFee)}</dd></div>}
      <div><dt>배송 방식</dt><dd>{shipment.delivery ? DELIVERY_METHOD_LABELS[shipment.delivery.method] : shipment.delivery === undefined ? '택배' : '확인 필요'}</dd></div>
      {shipment.regionalShipping?.regionalFee != null && shipment.regionalShipping.regionMode === 'managed' ? <div>
        <dt>포함된 지역 추가 배송비</dt><dd>{krw(shipment.regionalShipping.regionalFee)}
          {shipment.regionalShipping.regionLabel ? ` · ${shipment.regionalShipping.regionLabel}` : ''}</dd>
      </div> : null}
      {admin && shipment.regionalShipping ? <div><dt>주문 당시 지역 배송 정책</dt><dd>
        {shipment.regionalShipping.regionMode === 'legacy_base_only' ? '지역 요금표 미등록 · 기존 배송비로 확정' : `버전 ${shipment.regionalShipping.policyVersion} · ${shipment.regionalShipping.carrierCode}`}
        {shipment.regionalShipping.regionMode === 'managed' && shipment.regionalShipping.regionalContractFee != null
          ? ` · 계약 추가료 ${krw(shipment.regionalShipping.regionalContractFee)} × ${shipment.regionalShipping.unitCount}${shipment.regionalShipping.feeUnit === 'per_good' ? adminGoodsCopy('개 굿즈') : '건'}` : ''}
      </dd></div> : null}
      {shipment.originalExpectedShipDate ? <div><dt>주문 당시 발송 예정일</dt><dd>{goodsShipDateLabel(shipment.originalExpectedShipDate)}</dd></div> : null}
      {shipment.expectedShipDate && shipment.expectedShipDate !== shipment.originalExpectedShipDate ? <div><dt>변경된 발송 예정일</dt><dd>{goodsShipDateLabel(shipment.expectedShipDate)}</dd></div> : null}
      {admin && shipment.preorderReady === false ? <div><dt>예약 출고 준비</dt><dd>실제 입고 물량 할당과 발송 예정일을 확인해주세요.</dd></div> : null}
      {shipment.delivery?.providerName ? <div><dt>배송 업체·담당</dt><dd>{shipment.delivery.providerName}</dd></div> : null}
      {shipment.delivery === undefined || shipment.delivery?.method === 'parcel' ? <>
        <div><dt>택배사</dt><dd>{shipment.carrierLabel ?? (shipment.status === 'ready' ? '발송 준비 중' : '미등록')}</dd></div>
        <div><dt>운송장번호</dt><dd>{shipment.trackingNumber ?? '미등록'}</dd></div>
      </> : null}
      {shipment.shippedAt && shipment.delivery?.method !== 'digital' ? <div><dt>발송일시</dt><dd><time dateTime={shipment.shippedAt}>{formatOrderDateTime(shipment.shippedAt)}</time></dd></div> : null}
      {shipment.deliveredAt ? <div><dt>{shipment.delivery?.method === 'digital' ? '파일 제공 시작일시' : '배송 완료일시'}</dt><dd><time dateTime={shipment.deliveredAt}>{formatOrderDateTime(shipment.deliveredAt)}</time></dd></div> : null}
    </dl>
    {shipment.chargeDetails ? <ShippingChargeDetailsDisplay details={shipment.chargeDetails} names={names} admin={admin} /> : null}
    {shipment.delivery?.policy ? <div className="col" style={{ gap: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      <p style={{ margin: 0 }}><strong>인계 안내</strong><br />{shipment.delivery.policy.handoffLocation}<br />{shipment.delivery.policy.handoffInstructions}</p>
      <p style={{ margin: 0 }}>연락처: {shipment.delivery.policy.contactName} · {shipment.delivery.policy.contactPhone}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.appointmentInstructions}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.completionInstructions}<br />대리수령: {shipment.delivery.policy.allowDelegate ? '안내 조건에 따라 가능' : '불가'}</p>
      <p style={{ margin: 0 }}>{shipment.delivery.policy.cancellationInstructions}</p>
      <small className="muted">{shipment.delivery.policy.feeRule === 'checkout_prepaid' ? '주문서에서 선택한 방식과 선결제 비용을 기준으로 제공합니다.' : '고객 요청으로 배송 방식을 변경했으며 주문 당시 배송비를 유지합니다.'}</small>
      {!admin && shipment.delivery.canIssueReceipt ? <ShipmentReceiptConfirmation key={`${shipment.id}:${shipment.delivery.policy.policyId}`} shipmentId={shipment.id} /> : null}
    </div> : null}
    {items.some(item => shipment.orderItemIds.includes(item.id)) ? <ul>{items.filter(item => shipment.orderItemIds.includes(item.id)).map(item => <li key={item.id}>{item.name}{item.variantName ? ` · ${item.variantName}` : ''} × {item.qty}
      {item.supplySource === 'preorder' ? ` · 예약판매 (${goodsShipDateLabel(item.preorderExpectedShipDate)})` : ''}</li>)}</ul> : null}
    {shipment.trackingUrl && (shipment.delivery === undefined || shipment.delivery?.method === 'parcel') ? <a className={admin ? 'admin-order-detail__link' : 'btn btn-ghost order-tracking-link'} href={shipment.trackingUrl} rel="noreferrer" target="_blank">{admin || shipments.length > 1 ? `${groupName} 배송조회` : '배송조회'}</a> : null}
  </section>; })}</div>;
}
