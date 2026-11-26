'use client';

import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { useState } from 'react';
import { AdminField, AdminFormGrid } from './console/AdminKit';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { ErrorText } from './fields';
import { GOOD_NOTE_CLASS, GOOD_NUMBER_INPUT_CLASS, GoodChoiceCard, GoodChoiceCards } from './GoodEditorParts';
import { DEFAULT_FULFILLMENT_ORIGIN_ID, type GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { ShippingFeeType } from '@/lib/fulfillment';
export interface GoodsFulfillmentValue { originId?: string | null; shippingFeeType?: ShippingFeeType; individualFee?: number }

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

/**
 * 고른 출고지·배송비 유형·개별 금액으로 이 상품의 배송비를 한 줄로 되읽는다('글보다 화면' 3).
 * 출고지를 아직 안 골랐으면 0원으로 쓰지 않고 고르라고 한다.
 */
export function goodShippingFeeReadback({ feeType, origin, individualFee }: { feeType: ShippingFeeType; origin?: GoodsFulfillmentOrigin; individualFee: number }): string {
  if (feeType === 'free') return '배송비 무료';
  if (feeType === 'individual') return `배송비 ${won(individualFee)}`;
  if (!origin) return '출고지를 고르면 배송비가 정해집니다';
  return `배송비 ${won(origin.baseFee)} · ${origin.freeThreshold === null ? '무료 기준 없음' : `${won(origin.freeThreshold)} 이상 무료`}${origin.active ? '' : ' · 사용 안 함인 출고지 (확인 필요)'}`;
}

export function GoodsFulfillmentFields({ origins, value, errors = {}, regionSummaries = [] }: { origins: GoodsFulfillmentOrigin[]; regionSummaries?: GoodShippingRegionSummary[]; value?: GoodsFulfillmentValue | null; errors?: Record<string, string | undefined> }) {
  const [originId, setOriginId] = useState(value?.originId === null ? '' : value?.originId ?? DEFAULT_FULFILLMENT_ORIGIN_ID);
  const [feeType, setFeeType] = useState(value?.shippingFeeType ?? 'policy');
  /* 개별 배송비 칸은 값을 폼이 그대로 제출한다. 되읽기에 쓰려고 입력값만 따라 적는다. */
  const [fee, setFee] = useState(String(value?.individualFee ?? 0));
  const region = regionSummaries.find((item) => item.originId === originId);
  const origin = origins.find((item) => item.id === originId);
  const typeError = errors.shippingFeeType;
  const choice = (type: ShippingFeeType, title: string, description: string) => (
    <GoodChoiceCard name="shippingFeeType" value={type} checked={feeType === type} onChange={() => setFeeType(type)} title={title} description={description}
      aria-invalid={typeError ? 'true' : undefined} aria-describedby={typeError ? 'good-shipping-type-error' : undefined} />
  );
  return <div className="flex min-w-0 flex-col gap-5">
    <AdminFormGrid>
      <AdminField inputId="good-origin" label="출고지 (필수)" error={errors.originId}>
        <NativeSelect className="w-full" id="good-origin" name="originId" value={originId} onChange={(event) => setOriginId(event.target.value)} aria-invalid={Boolean(errors.originId)} aria-describedby={errors.originId ? "good-origin-error" : undefined}>
          <option value="">고르지 않음</option>
          {origins.map((origin) => <option key={origin.id} value={origin.id} disabled={!origin.active && origin.id !== originId}>{origin.name}{origin.active ? '' : ' · 사용 안 함'}</option>)}
        </NativeSelect>
      </AdminField>
    </AdminFormGrid>
    <div className="flex min-w-0 flex-col gap-2">
      <GoodChoiceCards legend="배송비 유형">
        {choice('policy', '출고지 정책 따름', '출고지에 정해 둔 배송비를 받습니다')}
        {choice('free', '무료배송', '배송비를 받지 않습니다')}
        {choice('individual', '개별 배송비', '이 상품에만 따로 정한 배송비를 받습니다')}
      </GoodChoiceCards>
      <ErrorText id="good-shipping-type-error">{typeError}</ErrorText>
    </div>
    <div hidden={feeType !== 'individual' && !errors.individualFee}>
      <AdminFormGrid>
        <AdminField inputId="good-individual-fee" label="개별 배송비 (원)" error={errors.individualFee}>
          <input className={`${GOOD_NUMBER_INPUT_CLASS} sm:max-w-xs`} data-slot="input" id="good-individual-fee" name="individualFee" type="number" min={0} max={1000000} step={1} defaultValue={value?.individualFee ?? 0} onChange={(event) => setFee(event.target.value)} aria-invalid={Boolean(errors.individualFee)} aria-describedby={errors.individualFee ? 'good-individual-fee-error' : undefined} />
        </AdminField>
      </AdminFormGrid>
    </div>
    {/* 지금 고른 값으로 계산되는 배송비. 지역별 추가배송비는 출고지 설정이라 이 상품의 선택과 따로 보인다. */}
    <div className={`${GOOD_NOTE_CLASS} flex min-w-0 flex-col gap-1.5`} aria-live="polite" data-good-shipping-policy="">
      <strong className="font-medium">{goodShippingFeeReadback({ feeType, origin, individualFee: Number(fee) || 0 })}</strong>
      {feeType === 'individual' ? <p className="text-muted-foreground">수량·옵션이 여러 개여도 한 번만 받습니다.</p> : null}
      {feeType === 'policy' ? <a className="w-fit underline underline-offset-4" href="/admin/settings/origins" target="_blank" rel="noreferrer">출고지 설정 확인 (새 탭)</a> : null}
      <p className="text-muted-foreground wrap-anywhere">{region?.label ?? '지역별 추가배송비 확인 필요'} · {region?.detail ?? '지역별 추가배송비 화면에서 적용 중인지 확인해주세요.'} <a className="text-foreground underline underline-offset-4" href="/admin/settings/shipping-regions" target="_blank" rel="noreferrer">지역별 추가배송비 (새 탭)</a></p>
      <p className="text-muted-foreground">이미 받은 주문의 배송비와 반품 주소는 바뀌지 않습니다.</p>
    </div>
  </div>;
}
