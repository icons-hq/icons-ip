import { krw, krwAmountWords } from '@/lib/format';
import type { ShippingQuoteGroup } from '@/lib/fulfillment';
import { shippingFeeLabel } from '@/lib/shipping';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { shippingRegionStatusMessage, type RegionalShippingSnapshot } from '@/lib/shipping-regions';

export function ShippingGroupSummary({ group }: { group: ShippingQuoteGroup & Partial<RegionalShippingSnapshot> }) {
  const remainder = group.freeThreshold === null ? 0 : Math.max(0, group.freeThreshold - group.policySubtotal);
  return (
    <div className="wc-shipping-group__summary">
      <p>배송비 {group.finalFee === null ? '배송지 확인 후 확정' : shippingFeeLabel(group.totalFee)}</p>
      {group.regionStatus && group.regionStatus !== 'unconfigured' ? <p>{shippingRegionStatusMessage(group.regionStatus)}</p> : null}
      {group.regionalFee != null && group.regionalFee > 0 ? <p>지역 추가 배송비 {krw(group.regionalFee)} 포함{group.regionLabel ? ` · ${group.regionLabel}` : ''}</p> : null}
      {group.hasPreorder ? <p>{goodsShipDateLabel(group.expectedShipDate)} · 같은 출고지의 상품은 가장 늦은 예정일에 함께 발송합니다.{group.hasStockItems ? ' 일반 상품도 함께 기다립니다.' : ''}</p> : null}
      {group.individualFee > 0 ? <p>개별 배송비 {krw(group.individualFee)} 포함 · 상품당 1회</p> : null}
      {group.policyFee > 0 && remainder > 0 ? (
        <p>{group.originName} 출고의 정책 적용 굿즈를 {krwAmountWords(remainder)} 더 담으면 묶음 배송비가 무료예요.</p>
      ) : null}
    </div>
  );
}
