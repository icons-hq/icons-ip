import { productionLeadLabel } from '@/lib/order-production';
import { krw } from '@/lib/format';
import { FULFILLMENT_METHOD_LABELS } from '@/lib/goods-fulfillment';
import { componentCollectFee, componentPrepaidFee } from '@/lib/goods-transaction';
import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import { ShippingChargeDetailsDisplay } from '@/components/shop/ShippingChargeDetailsDisplay';

/** One immutable breakdown for the quote, payment receipt and order history. */
export function GoodsTransactionSummary({ display, names = {} }: { display: GoodsTransactionDisplay; names?: Record<string, string> }) {
  const totals = display.totals;
  return <>
    <dl className="checkout-totals">
      <div><dt>굿즈 금액</dt><dd>{krw(totals.subtotal)}</dd></div>
      {totals.volumeDiscountTotal > 0 && <div><dt>복수구매 할인</dt><dd>−{krw(totals.volumeDiscountTotal)}</dd></div>}
      {totals.couponDiscountTotal > 0 && <div><dt>쿠폰 할인</dt><dd>−{krw(totals.couponDiscountTotal)}</dd></div>}
      {totals.storeCreditTotal > 0 && <div><dt>적립금 사용</dt><dd>−{krw(totals.storeCreditTotal)}</dd></div>}
      {(totals.shippingCouponDiscountTotal ?? 0) > 0 && <><div><dt>할인 전 선결제 배송·설치비</dt><dd>{krw(totals.prepaidShippingTotal + totals.shippingCouponDiscountTotal!)}</dd></div><div><dt>배송비 쿠폰 할인</dt><dd>−{krw(totals.shippingCouponDiscountTotal!)}</dd></div></>}
      <div><dt>선결제 배송·설치비</dt><dd>{krw(totals.prepaidShippingTotal)}</dd></div>
      <div className="checkout-total"><dt>온라인 결제금액</dt><dd>{krw(totals.onlineTotal)}</dd></div>
      {totals.collectShippingTotal > 0 && <>
        <div><dt>착불 배송비 · 수령 시 별도</dt><dd>{krw(totals.collectShippingTotal)}</dd></div>
        <div><dt>총 부담금액</dt><dd>{krw(totals.customerTotal)}</dd></div>
      </>}
    </dl>
    {display.coupons?.length ? <ul aria-label="적용된 쿠폰">{display.coupons.map(c => <li key={c.userCouponId}>{c.applicationIndex}. {c.name} · {c.benefitKind === 'shipping' ? '배송비' : '굿즈'} −{krw(c.discount)}</li>)}</ul> : null}
    {display.lines.filter(line => line.production).map(line => <p className="checkout-collect-notice" key={`production:${line.lineId}`}>{names[line.goodId] ?? '굿즈'} · 주문 후 제작 · 결제 확인 후 {productionLeadLabel(line.production!)} 내 발송 예정. {line.production!.publicNote} 제작 시작 후 취소는 담당자 검토가 필요합니다.</p>)}
    {display.shipping.map((group, index) => <section className="wc-shipping-group" key={`${group.originId}:${group.deliveryMethod ?? 'parcel'}`} aria-label={`배송 묶음 ${index + 1}`}>
      <h3>배송 묶음 {index + 1} · {FULFILLMENT_METHOD_LABELS[group.deliveryMethod ?? 'parcel']}</h3>
      <ul>{group.components.map(component => <li key={component.goodId}>
        {names[component.goodId] ?? '굿즈'} · 선결제 {krw(componentPrepaidFee(component))}
        {componentCollectFee(component) > 0 ? ` · 착불 별도 ${krw(componentCollectFee(component))}` : ''}
        {(component.installationFee ?? 0) > 0 ? ` (설치비 ${krw(component.installationFee!)} 선결제 포함)` : ''}
        {(component.shippingCouponDiscount ?? 0) > 0 ? ` (배송비 쿠폰 ${krw(component.shippingCouponDiscount!)} 차감)` : ''}
        {component.regionalFee > 0 ? ` (지역 추가 배송비 ${krw(component.regionalFee)} 포함)` : ''}
      </li>)}</ul>
      {group.deliveryPolicy && 'handoffLocation' in group.deliveryPolicy ? <p>{group.deliveryPolicy.handoffLocation} · {group.deliveryPolicy.handoffInstructions}<br />{group.deliveryPolicy.appointmentInstructions}<br />{group.deliveryPolicy.completionInstructions}</p> : null}
      {group.chargeDetails ? <ShippingChargeDetailsDisplay details={group.chargeDetails} names={names} /> : null}
      {group.collector && <div className="checkout-collect-notice">
        <p>착불 배송비는 온라인 결제금액에 포함되지 않습니다.</p>
        <p>수납 주체: {group.collector.name} · {group.collector.method}</p>
        <p>{group.collector.instructions}</p>
        <p>착불 배송비 환불 문의: {group.collector.refundContact}</p>
      </div>}
    </section>)}
  </>;
}
