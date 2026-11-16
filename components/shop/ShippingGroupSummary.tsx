import { krw, krwAmountWords } from '@/lib/format';
import type { ShippingQuoteGroup } from '@/lib/fulfillment';
import { shippingFeeLabel } from '@/lib/shipping';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import { shippingRegionStatusMessage, type RegionalShippingSnapshot } from '@/lib/shipping-regions';

/**
 * 배송 묶음의 배송비 안내. `withheld`가 있으면 금액 줄(배송비·지역 추가·개별 배송비·무료까지 남은 금액)을 그 문구로 가린다 —
 * 주문서에 판매기간이 끝난 굿즈가 섞이면 이 금액들이 그 굿즈를 포함해 계산된 값이라서다(원장 재작업 후속 7). 지역·예약 발송 안내는 그대로다.
 */
export function ShippingGroupSummary({ group, withheld }: { group: ShippingQuoteGroup & Partial<RegionalShippingSnapshot>; withheld?: string }) {
  const remainder = group.freeThreshold === null ? 0 : Math.max(0, group.freeThreshold - group.policySubtotal);
  return (
    <div className="wc-shipping-group__summary">
      <p>배송비 {withheld ?? (group.finalFee === null ? '배송지 확인 후 확정' : shippingFeeLabel(group.totalFee))}</p>
      {group.regionStatus && group.regionStatus !== 'unconfigured' ? <p>{shippingRegionStatusMessage(group.regionStatus)}</p> : null}
      {!withheld && group.regionalFee != null && group.regionalFee > 0 ? <p>지역 추가 배송비 {krw(group.regionalFee)} 포함{group.regionLabel ? ` · ${group.regionLabel}` : ''}</p> : null}
      {group.hasPreorder ? <p>{goodsShipDateLabel(group.expectedShipDate)} · 같은 배송 묶음의 굿즈는 가장 늦은 예정일에 함께 발송합니다.{group.hasStockItems ? ' 일반 굿즈도 함께 기다립니다.' : ''}</p> : null}
      {!withheld && group.individualFee > 0 ? <p>개별 배송비 {krw(group.individualFee)} 포함 · 굿즈당 1회</p> : null}
      {!withheld && group.policyFee > 0 && remainder > 0 ? (
        <p>이 배송 묶음의 정책 적용 굿즈를 {krwAmountWords(remainder)} 더 담으면 묶음 배송비가 무료예요.</p>
      ) : null}
    </div>
  );
}
