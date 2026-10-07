'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { formatWon, type GoodsPriceDraft, type GoodsPriceResolution } from '@/lib/admin/goods-price-editor';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { AdminField } from './console/AdminKit';
import { SelectField } from './fields';

/**
 * 스마트스토어식 판매가 → 할인 입력. 화면 입력은 이름을 가진 보조 값이고,
 * 서버로 가는 `price`·`compareAtPrice`는 아래 hidden 입력이 한 곳에서 만든다.
 */
export function GoodsPriceFields({ draft, onDraftChange, result, errors, showDiscountRate }: {
  draft: GoodsPriceDraft;
  onDraftChange: Dispatch<SetStateAction<GoodsPriceDraft>>;
  result: GoodsPriceResolution;
  errors: Record<string, string | undefined>;
  /** `showDiscountRate` 초기값('true' | 'false') */
  showDiscountRate: string;
}) {
  const regularRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  /* 서버 검증(소비자가 > 기준 판매가)을 어기는 값은 브라우저 검증에서 먼저 막는다. */
  useEffect(() => { regularRef.current?.setCustomValidity(result.regularPriceError ?? ''); }, [result.regularPriceError]);
  useEffect(() => { discountRef.current?.setCustomValidity(result.discountError ?? ''); }, [result.discountError]);
  const change = (changes: Partial<GoodsPriceDraft>) => onDraftChange((current) => ({ ...current, ...changes }));
  const regularError = result.regularPriceError ?? errors.regularPrice ?? errors.price ?? (draft.discountEnabled ? undefined : errors.compareAtPrice);
  const discountError = result.discountError ?? errors.discountValue ?? (draft.discountEnabled ? errors.compareAtPrice : undefined);

  return <div className="goods-price-editor">
    <AdminField inputId="goods-regular-price" label={ADMIN_VOCABULARY.salePrice} hint="할인 전 가격입니다. 옵션가는 이 금액(할인하면 할인가)에 더합니다." error={regularError}>
      <span className="goods-amount-input">
        <input ref={regularRef} id="goods-regular-price" name="regularPrice" type="number" min={0} max={2147483647} step={1} inputMode="numeric" placeholder="0"
          aria-describedby={`goods-regular-price-hint${regularError ? ' goods-regular-price-error' : ''}`} aria-invalid={regularError ? 'true' : undefined}
          value={draft.regularPrice} onChange={(event) => change({ regularPrice: event.target.value })} />
        <span aria-hidden="true">원</span>
      </span>
    </AdminField>

    <fieldset className="goods-choice">
      <legend>할인</legend>
      <label><input type="radio" name="discountEnabled" value="true" checked={draft.discountEnabled} onChange={() => change({ discountEnabled: true })} />설정함</label>
      <label><input type="radio" name="discountEnabled" value="false" checked={!draft.discountEnabled} onChange={() => change({ discountEnabled: false })} />설정안함</label>
    </fieldset>

    {/* 설정안함이어도 입력은 지우지 않는다. 다시 켜면 이전 값을 이어 쓴다. */}
    <div className="goods-price-editor__discount" hidden={!draft.discountEnabled}>
      <AdminField inputId="goods-discount-value" label="할인 금액 또는 할인율" hint="판매가에서 뺄 금액(원) 또는 비율(%)입니다. % 할인은 원 단위로 내립니다." error={discountError}>
        <span className="goods-amount-input goods-amount-input--unit">
          <input ref={discountRef} id="goods-discount-value" name="discountValue" type="number" step="any" min={0} inputMode="decimal"
            aria-describedby={`goods-discount-value-hint${discountError ? ' goods-discount-value-error' : ''}`} aria-invalid={discountError ? 'true' : undefined}
            value={draft.discountValue} onChange={(event) => change({ discountValue: event.target.value })} />
          <select aria-label="할인 단위" name="discountUnit" value={draft.discountUnit} onChange={(event) => change({ discountUnit: event.target.value === 'percent' ? 'percent' : 'won' })}>
            <option value="won">원</option><option value="percent">%</option>
          </select>
        </span>
      </AdminField>
      <p className="goods-price-editor__result" role="status">
        {result.discountAmount > 0 && result.salePrice !== null
          ? <>할인가 <strong>{formatWon(result.salePrice)}</strong> ({formatWon(result.discountAmount)} 할인)</>
          : '할인 금액을 입력하면 할인가를 계산합니다.'}
      </p>
      <SelectField defaultValue={showDiscountRate} error={errors.showDiscountRate} label="고객 화면에 할인율 표시" name="showDiscountRate">
        <option value="true">표시</option><option value="false">숨김 · 할인가만 표시</option>
      </SelectField>
    </div>
    <p className="muted">고객이 결제하는 기준 금액은 할인가입니다(할인이 없으면 판매가). 할인율을 숨기면 취소선과 할인율 없이 할인가만 보입니다. 기간 할인·쿠폰·적립금은 별도 영역에서 관리하며 실제 결제 금액에 그대로 적용됩니다.</p>
    <input type="hidden" name="price" value={result.price} />
    <input type="hidden" name="compareAtPrice" value={result.compareAtPrice} />
  </div>;
}
