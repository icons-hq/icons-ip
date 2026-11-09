'use client';

import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { useState } from 'react';
import { AdminField, AdminFormGrid } from './console/AdminKit';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS } from './GoodEditorParts';
import { DEFAULT_FULFILLMENT_ORIGIN_ID, type GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { ShippingFeeType } from '@/lib/fulfillment';
export interface GoodsFulfillmentValue { originId?: string | null; shippingFeeType?: ShippingFeeType; individualFee?: number }
export function GoodsFulfillmentFields({ origins, value, errors = {}, regionSummaries = [] }: { origins: GoodsFulfillmentOrigin[]; regionSummaries?: GoodShippingRegionSummary[]; value?: GoodsFulfillmentValue | null; errors?: Record<string, string | undefined> }) {
  const [originId, setOriginId] = useState(value?.originId === null ? '' : value?.originId ?? DEFAULT_FULFILLMENT_ORIGIN_ID);
  const [feeType, setFeeType] = useState(value?.shippingFeeType ?? 'policy');
  const region = regionSummaries.find((item) => item.originId === originId);
  const origin = origins.find((item) => item.id === originId);
  const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
  return <AdminFormGrid>
    <AdminField inputId="good-origin" label="출고지" error={errors.originId}>
      <NativeSelect className="w-full" id="good-origin" name="originId" value={originId} onChange={(event) => setOriginId(event.target.value)} aria-invalid={Boolean(errors.originId)} aria-describedby={errors.originId ? "good-origin-error" : undefined}>
        <option value="">설정 전</option>
        {origins.map((origin) => <option key={origin.id} value={origin.id} disabled={!origin.active && origin.id !== originId}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}
      </NativeSelect>
    </AdminField>
    <AdminField inputId="good-shipping-type" label="배송비 유형" error={errors.shippingFeeType}>
      <NativeSelect className="w-full" id="good-shipping-type" name="shippingFeeType" value={feeType} onChange={(event) => setFeeType(event.target.value as ShippingFeeType)} aria-invalid={Boolean(errors.shippingFeeType)} aria-describedby={errors.shippingFeeType ? 'good-shipping-type-error' : undefined}>
        <option value="policy">출고지 정책 따름</option><option value="free">무료배송</option><option value="individual">개별 배송비</option>
      </NativeSelect>
    </AdminField>
    <div hidden={feeType !== 'individual' && !errors.individualFee}>
    <AdminField inputId="good-individual-fee" label="개별 배송비 (원)" hint="개별 배송비 유형일 때만 적용됩니다. 같은 상품의 수량·옵션이 여러 개여도 한 번만 더합니다." error={errors.individualFee}>
      <input className={`${GOOD_NUMBER_INPUT_CLASS} sm:max-w-xs`} data-slot="input" id="good-individual-fee" name="individualFee" type="number" min={0} max={1000000} step={1} defaultValue={value?.individualFee ?? 0} aria-invalid={Boolean(errors.individualFee)} aria-describedby={errors.individualFee ? 'good-individual-fee-error good-individual-fee-hint' : 'good-individual-fee-hint'} />
    </AdminField>
    </div>
    {/* 출고지·배송비 유형을 고른 결과 요약. 폼 격자의 한 줄 전체를 쓴다. */}
    <div className={`${GOOD_NOTE_CLASS} col-span-full flex min-w-0 flex-col gap-1.5`} aria-live="polite" data-good-shipping-policy="">
      {feeType === 'policy' ? <>
        <strong className="font-medium">출고지 정책 적용</strong>
        {origin ? <p className="text-muted-foreground wrap-anywhere">{origin.name} · 기본 배송비 {won(origin.baseFee)} · {origin.freeThreshold === null ? '무료배송 기준 없음' : `${won(origin.freeThreshold)} 이상 무료`}{!origin.active ? ' · 비활성 출고지, 확인 필요' : ''}</p> : <p className="text-muted-foreground">출고지 정책 확인 필요 · 출고지를 선택해주세요. 미확인 값은 0원으로 표시하지 않습니다.</p>}
        <a className="w-fit underline underline-offset-4" href="/admin/settings/origins" target="_blank" rel="noreferrer">출고지 정책 확인 (새 탭)</a>
      </> : <p className="text-muted-foreground">{feeType === 'free' ? '상품 기본 배송비 0원 · 지역 추가료는 별도 정책을 따릅니다.' : '상품 예외 배송비 · 같은 상품의 수량·옵션과 관계없이 한 번 부과합니다.'}</p>}
      <p className="text-muted-foreground wrap-anywhere">{region?.label ?? '지역 추가료 적용 상태 확인 필요'} · {region?.detail ?? '지역 정책에서 현재 적용 상태를 확인해주세요.'} <a className="text-foreground underline underline-offset-4" href="/admin/settings/shipping-regions" target="_blank" rel="noreferrer">지역 배송 정책 (새 탭)</a></p>
      <p className="text-muted-foreground">기존 주문에 확정된 배송비와 반품 주소는 바뀌지 않습니다.</p>
    </div>
  </AdminFormGrid>;
}
