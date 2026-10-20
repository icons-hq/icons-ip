import { shippingSettingsFeeLabel, shippingSettingsMoney, type ShippingSettingsEffective } from '@/lib/admin/shipping-settings-templates';

/** Show the rule that will actually be charged before the retained base setting. */
export function ShippingSettingsDeliverySummary({ effective }: { effective: ShippingSettingsEffective }) {
  const policy = effective.delivery, active = policy?.status === 'active', quantity = active ? policy.quantityTerms : null;
  const payment = active ? policy.paymentMode : 'prepaid';
  const paymentLabel = { prepaid: '선결제', collect: '착불', buyer_choice: '구매자 선택 · 선결제 또는 착불' }[payment];
  return <div>
    <strong>{quantity ? '수량별 배송비 적용' : shippingSettingsFeeLabel(effective)} · {paymentLabel}</strong>
    {quantity?.kind === 'repeat' ? <p>{quantity.interval.toLocaleString('ko-KR')}개마다 {shippingSettingsMoney(quantity.baseFee)}씩 반복 부과</p> : null}
    {quantity?.kind === 'tier2' || quantity?.kind === 'tier3' ? <p>
      {quantity.firstLimit.toLocaleString('ko-KR')}개 이하 {shippingSettingsMoney(quantity.baseFee)} / {quantity.kind === 'tier3'
        ? `${(quantity.firstLimit + 1).toLocaleString('ko-KR')}~${quantity.secondLimit.toLocaleString('ko-KR')}개 ${shippingSettingsMoney(quantity.baseFee + quantity.extra1)} / ${(quantity.secondLimit + 1).toLocaleString('ko-KR')}개 이상 ${shippingSettingsMoney(quantity.baseFee + quantity.extra2)}`
        : `${(quantity.firstLimit + 1).toLocaleString('ko-KR')}개 이상 ${shippingSettingsMoney(quantity.baseFee + quantity.extra1)}`}
    </p> : null}
    {quantity ? <small>기본 설정 ‘{shippingSettingsFeeLabel(effective)}’은 보관하며 현재 기본 운임 계산에는 사용하지 않습니다.</small> : null}
    {policy?.status === 'draft' ? <small>확장 배송비는 초안으로 보관하며 계산에 적용하지 않습니다.</small> : null}
    {policy?.status === 'disabled' ? <small>확장 배송비 사용 안 함 · 기본 배송비 설정으로 계산합니다.</small> : null}
  </div>;
}
