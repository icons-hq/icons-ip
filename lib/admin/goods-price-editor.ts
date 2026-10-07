/**
 * 상품 편집의 판매가·할인 입력(스마트스토어식)과 저장 계약의 변환.
 *
 * 화면은 "판매가(할인 전) + 할인"으로 입력받고, 서버·DB 계약은 그대로 둔다.
 * - 할인 설정안함: form `price` = 판매가, `compareAtPrice` = 빈 값
 * - 할인 설정함: form `compareAtPrice` = 판매가, `price` = 할인가
 * 고객이 결제하는 기준 금액은 `price`(할인가)이고 옵션가는 그 위에 더한다.
 */
export type GoodsDiscountUnit = 'won' | 'percent';

export type GoodsPriceDraft = {
  /** 판매가(할인 전). 입력 원문을 유지한다. */
  regularPrice: string;
  discountEnabled: boolean;
  /** 할인 입력 원문. 단위에 따라 원 또는 %. */
  discountValue: string;
  discountUnit: GoodsDiscountUnit;
};

/** 화면 입력 이름. 실패 복구·브라우저 복구가 입력한 그대로 되살린다. 서버는 읽지 않는다. */
export const GOODS_PRICE_DRAFT_FIELDS = ['regularPrice', 'discountEnabled', 'discountValue', 'discountUnit'] as const;

export type GoodsPriceResolution = {
  /** form `price` 값 */
  price: string;
  /** form `compareAtPrice` 값 */
  compareAtPrice: string;
  /** 해석한 판매가. 판매가 입력이 잘못되면 null */
  regularPrice: number | null;
  /** 적용되는 할인 금액(원). 할인이 없거나 잘못되면 0 */
  discountAmount: number;
  /** 고객 결제 기준 금액(할인가 또는 판매가). 판매가 입력이 잘못되면 null */
  salePrice: number | null;
  regularPriceError?: string;
  discountError?: string;
};

const INT32_MAX = 2147483647;

function wholeWon(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= INT32_MAX ? value : null;
}

export function formatWon(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

/**
 * 편집을 열 때의 입력 상태. 실패·브라우저 복구로 화면 입력이 돌아오면 그 값을 그대로 쓰고,
 * 아니면 저장된 `price`·`compareAtPrice`에서 판매가·할인(원)을 되짚는다.
 */
export function goodsPriceDraftFromValues(values: Readonly<Record<string, string | undefined>>): GoodsPriceDraft {
  if (values.regularPrice !== undefined) {
    return {
      regularPrice: values.regularPrice,
      discountEnabled: values.discountEnabled === 'true',
      discountValue: values.discountValue ?? '',
      discountUnit: values.discountUnit === 'percent' ? 'percent' : 'won',
    };
  }
  const price = wholeWon(values.price);
  const compare = wholeWon(values.compareAtPrice);
  if (price !== null && compare !== null && compare > price) {
    return { regularPrice: String(compare), discountEnabled: true, discountValue: String(compare - price), discountUnit: 'won' };
  }
  const regularPrice = (values.price ?? '').trim();
  return { regularPrice: regularPrice === '0' ? '' : regularPrice, discountEnabled: false, discountValue: '', discountUnit: 'won' };
}

function discountAmount(regular: number, draft: GoodsPriceDraft): { amount: number } | { error: string } {
  if (regular <= 0) return { error: '판매가를 먼저 입력한 뒤 할인을 설정해주세요.' };
  const text = draft.discountValue.trim();
  if (draft.discountUnit === 'percent') {
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: '할인율을 0보다 크고 100보다 작은 숫자로 입력해주세요. 소수 둘째 자리까지 입력할 수 있습니다.' };
    const hundredths = Math.round(Number(text) * 100);
    if (hundredths <= 0 || hundredths >= 10000) return { error: '할인율을 0보다 크고 100보다 작은 숫자로 입력해주세요. 소수 둘째 자리까지 입력할 수 있습니다.' };
    /* % 할인은 원 단위 내림이다. 정수 연산으로 부동소수 오차를 피한다. */
    const amount = Math.floor((regular * hundredths) / 10000);
    if (amount < 1) return { error: '할인율을 적용한 금액이 1원보다 작습니다. 할인율이나 판매가를 확인해주세요.' };
    return { amount };
  }
  const amount = wholeWon(text);
  if (amount === null || amount < 1 || amount >= regular) {
    return { error: `할인 금액은 1원 이상, 판매가 ${formatWon(regular)}보다 작게 입력해주세요.` };
  }
  return { amount };
}

/** 저장할 때의 변환. 잘못된 할인은 오류로 돌려주고 저장 값에는 할인을 싣지 않는다. */
export function resolveGoodsPrice(draft: GoodsPriceDraft): GoodsPriceResolution {
  const regularText = draft.regularPrice.trim();
  const regular = regularText === '' ? 0 : wholeWon(regularText);
  if (regular === null) {
    return {
      price: regularText, compareAtPrice: '', regularPrice: null, discountAmount: 0, salePrice: null,
      regularPriceError: '판매가는 0원 이상의 정수로 입력해주세요.',
    };
  }
  const regularValue = regularText === '' ? '' : String(regular);
  if (!draft.discountEnabled) {
    return { price: regularValue, compareAtPrice: '', regularPrice: regular, discountAmount: 0, salePrice: regular };
  }
  const discount = discountAmount(regular, draft);
  if ('error' in discount) {
    return { price: regularValue, compareAtPrice: '', regularPrice: regular, discountAmount: 0, salePrice: regular, discountError: discount.error };
  }
  const salePrice = regular - discount.amount;
  return { price: String(salePrice), compareAtPrice: String(regular), regularPrice: regular, discountAmount: discount.amount, salePrice };
}

export type ErpSalePricePlan =
  /** attention: 적용은 했지만 결과 금액이 ERP 판매가와 달라 MD가 확인해야 한다. */
  | { ok: true; target: 'regularPrice'; value: number; message: string; attention: boolean }
  | { ok: true; target: 'extraPrice'; value: number; message: string; attention: boolean }
  | { ok: false; error: string };

function appliedDiscountLabel(draft: GoodsPriceDraft, amount: number): string {
  return draft.discountUnit === 'percent' ? `${draft.discountValue.trim()}%(${formatWon(amount)})` : formatWon(amount);
}

/**
 * ERP 판매가 적용 버튼(자동 적용하지 않는다). 안내 금액은 적용 뒤의 입력으로 다시 계산한다.
 * 두 모드 모두 ERP 판매가를 할인 전 금액으로 보고 상품 할인은 그대로 둔다.
 * - 옵션 미사용: 판매가 칸에 ERP 판매가를 넣는다. % 할인·남은 기본 옵션 옵션가도 반영해 결과를 알린다.
 * - 옵션 사용: 그 옵션의 옵션가 = ERP 판매가 − 판매가(할인 전). 옵션가는 할인가에 더하므로
 *   그 옵션의 할인 전 금액이 ERP 판매가가 되고 상품 할인 금액만큼 낮은 할인가로 판다. 할인 전·후 금액을 함께 알린다.
 *   판매가가 비었거나 0원이면 ERP 판매가 전액이 옵션가가 되므로 적용하지 않는다. 음수도 적용하지 않는다.
 */
export function planErpSalePrice({ salePrice, mode, price, extraPrice = 0 }: {
  salePrice: number;
  mode: 'single' | 'multiple';
  /** 현재 판매가·할인 입력 */
  price: GoodsPriceDraft;
  /** 옵션 미사용: 기본 옵션에 남아 있는 옵션가(원) */
  extraPrice?: number;
}): ErpSalePricePlan {
  if (!Number.isSafeInteger(salePrice) || salePrice < 0 || salePrice > INT32_MAX) {
    return { ok: false, error: 'ERP 판매가를 확인할 수 없어 적용하지 않았습니다.' };
  }
  if (mode === 'single') {
    const next = resolveGoodsPrice({ ...price, regularPrice: String(salePrice) });
    let message = `판매가에 ERP 판매가 ${formatWon(salePrice)}을 넣었습니다.`;
    let attention = false;
    let customerPrice = salePrice;
    if (price.discountEnabled) {
      if (next.discountError || next.salePrice === null) {
        message += ' 설정한 할인을 새 판매가에 적용할 수 없습니다. 할인 칸을 확인해주세요.';
        attention = true;
      } else {
        customerPrice = next.salePrice;
        message += ` 설정한 할인 ${appliedDiscountLabel(price, next.discountAmount)}이 적용되어 할인가는 ${formatWon(next.salePrice)}입니다.`;
      }
    }
    const extra = Number.isSafeInteger(extraPrice) && extraPrice > 0 ? extraPrice : 0;
    if (extra) {
      message += ` 기본 옵션 옵션가 ${formatWon(extra)}이 더해져 고객 판매 금액은 ${formatWon(customerPrice + extra)}입니다. ERP 판매가에 맞추려면 기본 옵션 옵션가를 0원으로 바꿔주세요.`;
      attention = true;
    }
    return { ok: true, target: 'regularPrice', value: salePrice, message, attention };
  }
  const current = resolveGoodsPrice(price);
  if (current.regularPriceError || current.discountError || current.regularPrice === null || current.salePrice === null) {
    return { ok: false, error: '판매가·할인 입력 오류를 먼저 고친 뒤 ERP 판매가를 적용해주세요.' };
  }
  if (current.regularPrice <= 0) {
    return {
      ok: false,
      error: '판매가를 먼저 입력해주세요. 옵션가는 판매가에 더하는 금액이라, 판매가가 비어 있으면 ERP 판매가를 옵션가로 넣지 않습니다. 보통 옵션 중 가장 낮은 판매 금액을 판매가로 입력합니다.',
    };
  }
  const optionPrice = salePrice - current.regularPrice;
  if (optionPrice < 0) {
    return {
      ok: false,
      error: `ERP 판매가 ${formatWon(salePrice)}이 판매가(할인 전) ${formatWon(current.regularPrice)}보다 낮아 옵션가로 적용하지 않았습니다. 옵션가는 0원 이상이므로 판매가를 옵션 중 가장 낮은 금액으로 먼저 맞춰주세요.`,
    };
  }
  if (current.discountAmount <= 0) {
    return { ok: true, target: 'extraPrice', value: optionPrice, attention: false, message: `옵션가를 ${formatWon(optionPrice)}으로 맞춰 판매 ${formatWon(salePrice)}이 되었습니다.` };
  }
  return {
    ok: true, target: 'extraPrice', value: optionPrice, attention: false,
    message: `옵션가를 ${formatWon(optionPrice)}으로 맞춰 할인 전 판매 ${formatWon(salePrice)}(ERP 판매가)이 되었습니다. `
      + `상품 할인 ${appliedDiscountLabel(price, current.discountAmount)}이 그대로 적용되어 할인가는 ${formatWon(current.salePrice + optionPrice)}입니다.`,
  };
}
