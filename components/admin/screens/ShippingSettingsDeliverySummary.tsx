import { shippingSettingsFeeLabel, shippingSettingsFeeText, shippingSettingsMoney, type ShippingSettingsEffective } from '@/lib/admin/shipping-settings-templates';
import { FIELD_HINT } from '@/components/admin/settings-kit';

/**
 * 실제로 받는 배송비 규칙을 먼저 보인다. 수량별 배송비를 쓰는 상품은 그 금액이 배송비 유형보다 먼저다.
 * `origin`을 주면 '출고지 정책 따름'에 그 출고지의 금액을 붙인다.
 */
export function ShippingSettingsDeliverySummary({ effective, origin }: { effective: ShippingSettingsEffective; origin?: { baseFee: number; freeThreshold: number | null } | null }) {
  const policy = effective.delivery, active = policy?.status === 'active', quantity = active ? policy.quantityTerms : null;
  const payment = active ? policy.paymentMode : 'prepaid';
  const paymentLabel = { prepaid: '선결제', collect: '착불', buyer_choice: '구매자 선택 · 선결제 또는 착불' }[payment];
  const fee = shippingSettingsFeeText(effective, origin);
  return <div className="flex min-w-0 flex-col gap-0.5 [&>strong]:font-medium" data-shipping-delivery-summary="">
    <strong>{quantity ? '수량별 배송비' : fee} · {paymentLabel}</strong>
    {quantity?.kind === 'repeat' ? <p className={FIELD_HINT}>{quantity.interval.toLocaleString('ko-KR')}개마다 {shippingSettingsMoney(quantity.baseFee)}씩 받습니다</p> : null}
    {quantity?.kind === 'tier2' || quantity?.kind === 'tier3' ? <p className={FIELD_HINT}>
      {quantity.firstLimit.toLocaleString('ko-KR')}개 이하 {shippingSettingsMoney(quantity.baseFee)} / {quantity.kind === 'tier3'
        ? `${(quantity.firstLimit + 1).toLocaleString('ko-KR')}~${quantity.secondLimit.toLocaleString('ko-KR')}개 ${shippingSettingsMoney(quantity.baseFee + quantity.extra1)} / ${(quantity.secondLimit + 1).toLocaleString('ko-KR')}개 이상 ${shippingSettingsMoney(quantity.baseFee + quantity.extra2)}`
        : `${(quantity.firstLimit + 1).toLocaleString('ko-KR')}개 이상 ${shippingSettingsMoney(quantity.baseFee + quantity.extra1)}`}
    </p> : null}
    {quantity ? <small className={FIELD_HINT}>수량별 배송비를 쓰는 동안 ‘{shippingSettingsFeeLabel(effective)}’은 쓰지 않습니다.</small> : null}
    {policy?.status === 'draft' ? <small className={FIELD_HINT}>수량별·착불 설정은 저장만 해 두고 아직 쓰지 않습니다.</small> : null}
    {policy?.status === 'disabled' ? <small className={FIELD_HINT}>수량별·착불 설정 사용 안 함</small> : null}
  </div>;
}
