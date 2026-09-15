'use client';

import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { useState } from 'react';
import { AdminField, AdminFormGrid } from './console/AdminKit';
import { DEFAULT_FULFILLMENT_ORIGIN_ID, type FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { ShippingFeeType } from '@/lib/fulfillment';
export interface GoodsFulfillmentValue { originId?: string | null; shippingFeeType?: ShippingFeeType; individualFee?: number }
export function GoodsFulfillmentFields({ origins, value, errors = {}, regionSummaries = [] }: { origins: FulfillmentOrigin[]; regionSummaries?: GoodShippingRegionSummary[]; value?: GoodsFulfillmentValue | null; errors?: Record<string, string | undefined> }) {
  const [originId, setOriginId] = useState(value?.originId === null ? '' : value?.originId ?? DEFAULT_FULFILLMENT_ORIGIN_ID);
  const [feeType, setFeeType] = useState(value?.shippingFeeType ?? 'policy');
  const region = regionSummaries.find((item) => item.originId === originId);
  const origin = origins.find((item) => item.id === originId);
  const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
  return <AdminFormGrid>
    <AdminField inputId="good-origin" label="출고지" error={errors.originId}>
      <select id="good-origin" name="originId" value={originId} onChange={(event) => setOriginId(event.target.value)} aria-invalid={Boolean(errors.originId)} aria-describedby={errors.originId ? "good-origin-error" : undefined}>
        <option value="">설정 전</option>
        {origins.map((origin) => <option key={origin.id} value={origin.id} disabled={!origin.active && origin.id !== originId}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}
      </select>
    </AdminField>
    <AdminField inputId="good-shipping-type" label="배송비 유형" error={errors.shippingFeeType}>
      <select id="good-shipping-type" name="shippingFeeType" value={feeType} onChange={(event) => setFeeType(event.target.value as ShippingFeeType)} aria-invalid={Boolean(errors.shippingFeeType)} aria-describedby={errors.shippingFeeType ? 'good-shipping-type-error' : undefined}>
        <option value="policy">출고지 정책 따름</option><option value="free">무료배송</option><option value="individual">개별 배송비</option>
      </select>
    </AdminField>
    <div hidden={feeType !== 'individual' && !errors.individualFee}>
    <AdminField inputId="good-individual-fee" label="개별 배송비 (원)" hint="개별 배송비 유형일 때만 적용됩니다. 같은 상품의 수량·옵션이 여러 개여도 한 번만 더합니다." error={errors.individualFee}>
      <input id="good-individual-fee" name="individualFee" type="number" min={0} max={1000000} step={1} defaultValue={value?.individualFee ?? 0} aria-invalid={Boolean(errors.individualFee)} aria-describedby={errors.individualFee ? 'good-individual-fee-error good-individual-fee-hint' : 'good-individual-fee-hint'} />
    </AdminField>
    </div>
    <div className="admin-good-workspace__policy" aria-live="polite">
      {feeType === 'policy' ? <>
        <strong>출고지 정책 적용</strong>
        {origin ? <p>{origin.name} · 기본 배송비 {won(origin.baseFee)} · {origin.freeThreshold === null ? '무료배송 기준 없음' : `${won(origin.freeThreshold)} 이상 무료`}{!origin.active ? ' · 비활성 출고지, 확인 필요' : ''}</p> : <p>출고지 정책 확인 필요 · 출고지를 선택해주세요. 미확인 값은 0원으로 표시하지 않습니다.</p>}
        <a href="/admin/settings/origins" target="_blank" rel="noreferrer">출고지 정책 확인 (새 탭)</a>
      </> : <p>{feeType === 'free' ? '상품 기본 배송비 0원 · 지역 추가료는 별도 정책을 따릅니다.' : '상품 예외 배송비 · 같은 상품의 수량·옵션과 관계없이 한 번 부과합니다.'}</p>}
      <p>{region?.label ?? '지역 추가료 적용 상태 확인 필요'} · {region?.detail ?? '지역 정책에서 현재 적용 상태를 확인해주세요.'} <a href="/admin/settings/shipping-regions" target="_blank" rel="noreferrer">지역 배송 정책 (새 탭)</a></p>
      <p>편집 중 값은 상품 저장 후 적용됩니다. 기존 주문에 확정된 배송비와 반품 주소는 바뀌지 않습니다.</p>
    </div>
  </AdminFormGrid>;
}
