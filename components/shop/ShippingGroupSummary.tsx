import { krw, krwAmountWords } from '@/lib/format';
import type { ShippingQuoteGroup } from '@/lib/fulfillment';
import { shippingFeeLabel } from '@/lib/shipping';

export function ShippingGroupSummary({ group }: { group: ShippingQuoteGroup }) {
  const remainder = group.freeThreshold === null ? 0 : Math.max(0, group.freeThreshold - group.policySubtotal);
  return (
    <div className="wc-shipping-group__summary">
      <p>배송비 {shippingFeeLabel(group.totalFee)}</p>
      {group.individualFee > 0 ? <p>개별 배송비 {krw(group.individualFee)} 포함 · 상품당 1회</p> : null}
      {group.policyFee > 0 && remainder > 0 ? (
        <p>{group.originName} 출고의 정책 적용 굿즈를 {krwAmountWords(remainder)} 더 담으면 묶음 배송비가 무료예요.</p>
      ) : null}
    </div>
  );
}
