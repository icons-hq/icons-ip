'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { formatWon, goodsDiscountRate, type GoodsPriceDraft, type GoodsPriceResolution } from '@/lib/admin/goods-price-editor';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { AdminField } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GoodAmountField, GoodChoiceGroup, GoodChoiceOption } from './GoodEditorParts';

const RATE_HINT = '위 할인과 기간 할인에도 적용됩니다. 숨김이면 취소선·할인율 없이 결제 금액만 보이며, 결제 금액은 바뀌지 않습니다.';
/* 서버는 판매가·할인가만 저장해 할인 단위가 남지 않는다(같은 저장 값의 10%와 1,200원을 구분할 수 없다). 다시 열면 원으로 보인다. */
const DISCOUNT_HINT = '판매가에서 뺄 금액(원) 또는 비율(%)입니다. 저장 후 다시 열면 할인은 원 단위로 표시됩니다(결과 금액은 같습니다). 판매가를 바꿀 때는 할인도 다시 확인해주세요.';

/**
 * 스마트스토어식 판매가 → 할인 입력. 화면 입력은 이름을 가진 보조 값이고,
 * 서버로 가는 `price`·`compareAtPrice`는 아래 hidden 입력이 한 곳에서 만든다.
 */
export function GoodsPriceFields({ draft, onDraftChange, result, errors }: {
  draft: GoodsPriceDraft;
  onDraftChange: Dispatch<SetStateAction<GoodsPriceDraft>>;
  result: GoodsPriceResolution;
  errors: Record<string, string | undefined>;
}) {
  const regularRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  /* 서버 검증(소비자가 > 기준 판매가)을 어기는 값은 브라우저 검증에서 먼저 막는다. */
  useEffect(() => { regularRef.current?.setCustomValidity(result.regularPriceError ?? ''); }, [result.regularPriceError]);
  useEffect(() => { discountRef.current?.setCustomValidity(result.discountError ?? ''); }, [result.discountError]);
  const change = (changes: Partial<GoodsPriceDraft>) => onDraftChange((current) => ({ ...current, ...changes }));
  const discountOff = !draft.discountEnabled;
  const regularError = result.regularPriceError ?? errors.regularPrice ?? errors.price ?? (draft.discountEnabled ? undefined : errors.compareAtPrice);
  const discountError = result.discountError ?? errors.discountValue ?? (draft.discountEnabled ? errors.compareAtPrice : undefined);

  return <div className="flex min-w-0 flex-col gap-5" data-good-price-editor="">
    <AdminField inputId="goods-regular-price" label={`${ADMIN_VOCABULARY.salePrice} (필수)`} hint="할인 전 가격입니다. 옵션가는 이 금액(할인하면 할인가)에 더합니다." error={regularError}>
      <GoodAmountField unit="원">
        <input ref={regularRef} className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-regular-price" name="regularPrice" type="number" min={0} max={2147483647} step={1} inputMode="numeric" placeholder="0"
          aria-describedby={`goods-regular-price-hint${regularError ? ' goods-regular-price-error' : ''}`} aria-invalid={regularError ? 'true' : undefined}
          value={draft.regularPrice} onChange={(event) => change({ regularPrice: event.target.value })} />
      </GoodAmountField>
    </AdminField>

    <GoodChoiceGroup legend={ADMIN_VOCABULARY.instantDiscount}>
      <GoodChoiceOption name="discountEnabled" value="true" checked={draft.discountEnabled} onChange={() => change({ discountEnabled: true })}>설정함</GoodChoiceOption>
      <GoodChoiceOption name="discountEnabled" value="false" checked={!draft.discountEnabled} onChange={() => change({ discountEnabled: false })}>설정안함</GoodChoiceOption>
    </GoodChoiceGroup>

    {/*
      설정안함이어도 입력은 지우지 않는다. 다시 켜면 이전 값을 이어 쓴다.
      숨긴 입력도 브라우저 검증 대상이라 disabled로 검증·제출에서 빼고, 복구용 값만 hidden으로 보낸다.
    */}
    <div className={GOOD_SUBPANEL_CLASS} data-good-price-discount="" hidden={discountOff}>
      <AdminField inputId="goods-discount-value" label="할인 금액 또는 할인율" hint={DISCOUNT_HINT} error={discountError}>
        <GoodAmountField>
          <input ref={discountRef} className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-discount-value" name="discountValue" type="number" step="any" min={0} inputMode="decimal" disabled={discountOff}
            aria-describedby={`goods-discount-value-hint${discountError ? ' goods-discount-value-error' : ''}`} aria-invalid={discountError ? 'true' : undefined}
            value={draft.discountValue} onChange={(event) => change({ discountValue: event.target.value })} />
          <NativeSelect aria-label="할인 단위" className="w-20 shrink-0" name="discountUnit" disabled={discountOff} value={draft.discountUnit} onChange={(event) => change({ discountUnit: event.target.value === 'percent' ? 'percent' : 'won' })}>
            <option value="won">원</option><option value="percent">%</option>
          </NativeSelect>
        </GoodAmountField>
      </AdminField>
      <p className="text-sm text-muted-foreground tabular-nums" data-good-price-result="" role="status">
        {result.discountAmount > 0 && result.salePrice !== null
          ? <>할인가 <strong className="text-base font-semibold text-foreground">{formatWon(result.salePrice)}</strong> ({formatWon(result.discountAmount)}, {goodsDiscountRate(result.regularPrice ?? 0, result.salePrice)}% 할인)</>
          : '할인 금액을 입력하면 할인가를 계산합니다.'}
      </p>
    </div>
    {discountOff && <>
      <input type="hidden" name="discountValue" value={draft.discountValue} />
      <input type="hidden" name="discountUnit" value={draft.discountUnit} />
    </>}
    <input type="hidden" name="price" value={result.price} />
    <input type="hidden" name="compareAtPrice" value={result.compareAtPrice} />
  </div>;
}

/**
 * 고객 화면 할인율 표시(기본 표시). 즉시할인뿐 아니라 기간 할인에도 쓰이므로 할인 설정과 상관없이 추가 설정 카드에 늘 있다.
 * 접혀 있어도 name="showDiscountRate"는 DOM에 남아 같은 값을 제출한다.
 */
export function GoodsDiscountRateField({ value, error }: { value: string; error?: string }) {
  return <AdminField inputId="goods-show-discount-rate" label="고객 화면에 할인율 표시" hint={RATE_HINT} error={error}>
    <AdminSelect id="goods-show-discount-rate" name="showDiscountRate" className="w-full" wrapperClassName="w-full max-w-xs" defaultValue={value}
      aria-describedby={`goods-show-discount-rate-hint${error ? ' goods-show-discount-rate-error' : ''}`} aria-invalid={error ? 'true' : undefined}>
      <option value="true">표시</option><option value="false">숨김 · 할인가만 표시</option>
    </AdminSelect>
  </AdminField>;
}
