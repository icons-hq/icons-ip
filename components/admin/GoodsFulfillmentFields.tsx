import { AdminField, AdminFormGrid } from './console/AdminKit';
import { DEFAULT_FULFILLMENT_ORIGIN_ID, type FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { ShippingFeeType } from '@/lib/fulfillment';
export interface GoodsFulfillmentValue { originId?: string | null; shippingFeeType?: ShippingFeeType; individualFee?: number }
export function GoodsFulfillmentFields({ origins, value, errors = {} }: { origins: FulfillmentOrigin[]; value?: GoodsFulfillmentValue | null; errors?: Record<string, string | undefined> }) {
  const originId = value?.originId === null ? '' : value?.originId ?? DEFAULT_FULFILLMENT_ORIGIN_ID;
  return <AdminFormGrid>
    <AdminField inputId="good-origin" label="출고지" error={errors.originId}>
      <select id="good-origin" name="originId" defaultValue={originId} aria-invalid={Boolean(errors.originId)} aria-describedby={errors.originId ? "good-origin-error" : undefined}>
        <option value="">설정 전</option>
        {origins.map((origin) => <option key={origin.id} value={origin.id} disabled={!origin.active && origin.id !== originId}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}
      </select>
    </AdminField>
    <AdminField inputId="good-shipping-type" label="배송비 유형" error={errors.shippingFeeType}>
      <select id="good-shipping-type" name="shippingFeeType" defaultValue={value?.shippingFeeType ?? 'policy'} aria-invalid={Boolean(errors.shippingFeeType)} aria-describedby={errors.shippingFeeType ? 'good-shipping-type-error' : undefined}>
        <option value="policy">출고지 정책 따름</option><option value="free">무료배송</option><option value="individual">개별 배송비</option>
      </select>
    </AdminField>
    <AdminField inputId="good-individual-fee" label="개별 배송비 (원)" hint="개별 배송비 유형일 때만 적용됩니다. 같은 상품의 수량·옵션이 여러 개여도 한 번만 더합니다." error={errors.individualFee}>
      <input id="good-individual-fee" name="individualFee" type="number" min={0} max={1000000} step={1} defaultValue={value?.individualFee ?? 0} aria-invalid={Boolean(errors.individualFee)} aria-describedby={errors.individualFee ? 'good-individual-fee-error good-individual-fee-hint' : 'good-individual-fee-hint'} />
    </AdminField>
  </AdminFormGrid>;
}
