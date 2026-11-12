import { parseGoodsPricePeriodInput, toKstDateTimeInput } from './goods-price-periods';

/**
 * 상품 편집의 판매가·즉시할인 입력(스마트스토어식)과 저장 계약의 변환.
 *
 * 화면은 "판매가(할인 전) + 즉시할인(+ 특정기간만 할인)"으로 입력받는다(TKT-033·ADR-0040).
 * - 할인 설정안함: form `price` = 판매가, `compareAtPrice` = 빈 값
 * - 할인 설정함(기간 없음): form `compareAtPrice` = 판매가, `price` = 할인가 — 지금 계약 그대로다.
 * - 할인 설정함 + 특정기간만 할인: form `price` = 판매가, `compareAtPrice` = 빈 값이고, 서버 지시
 *   `instantDiscountPeriod`가 판매 중인 옵션마다 같은 할인 금액의 기간 할인 행(옵션별 기간 할인 원장)을 쓴다.
 *   기간 전·후에는 판매가, 기간 중에는 할인가로 판다.
 * 옵션가는 저장된 기준 금액(`price`) 위에 더한다.
 */
export type GoodsDiscountUnit = 'won' | 'percent';

export type GoodsPriceDraft = {
  /** 판매가(할인 전). 입력 원문을 유지한다. */
  regularPrice: string;
  discountEnabled: boolean;
  /** 할인 입력 원문. 단위에 따라 원 또는 %. */
  discountValue: string;
  discountUnit: GoodsDiscountUnit;
  /** 특정기간만 할인(즉시할인 기간). 꺼져 있으면 기간 없는 즉시할인이다. */
  periodEnabled?: boolean;
  /** 한국 시간 datetime-local 입력 원문(YYYY-MM-DDTHH:mm). */
  periodStartsAt?: string;
  periodEndsAt?: string;
};

/** 화면 입력 이름. 실패 복구·브라우저 복구가 입력한 그대로 되살린다. 서버는 `instantDiscountPeriod` 지시만 읽는다. */
export const GOODS_PRICE_DRAFT_FIELDS = ['regularPrice', 'discountEnabled', 'discountValue', 'discountUnit', 'discountPeriodEnabled', 'discountStartsAt', 'discountEndsAt'] as const;
/** 서버로 보내는 즉시할인 기간 지시(JSON) 입력 이름. 화면 상태에서 만들어지므로 임시저장·복구 대상이 아니다. */
export const INSTANT_DISCOUNT_PERIOD_FIELD = 'instantDiscountPeriod';

/**
 * 상품의 진행·예정 기간 할인 묶음(admin_goods_instant_discount_period). 상품 편집이 다룰 수 있으면 `editable`이고,
 * 할인 프로모션이 건 할인·옵션마다 다른 금액·여러 기간·기간 없는 즉시할인과 겹침이면 `managed`(기간 할인·프로모션 화면에서 관리)다.
 * `fingerprint`는 저장 때 되돌려 보내 그사이 다른 곳에서 걸거나 멈춘 할인을 덮지 않게 한다.
 */
export type GoodsInstantDiscountState = {
  state: 'none' | 'editable' | 'managed';
  reason: 'promotion' | 'instant' | 'mixed' | null;
  fingerprint: string;
  period: { amount: number; startsAt: string; endsAt: string } | null;
  summary: { count: number; minPrice: number; maxPrice: number; startsAt: string; endsAt: string } | null;
  promotions: { id: string; name: string }[];
  /** 판매 중인 옵션 가운데 진행·예정 기간 할인 행이 없는 옵션 수. 없거나 0이면 모든 옵션에 행이 있다. */
  uncovered?: number;
};
/** 새 상품(저장 전)의 상태. 서버도 없는 상품을 같은 지문('none')으로 본다. */
export const NEW_GOOD_INSTANT_DISCOUNT: GoodsInstantDiscountState = { state: 'none', reason: null, fingerprint: 'none', period: null, summary: null, promotions: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown, min = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= 2147483647;
const instantText = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** 서버 응답 검증. 모양이 다르면 null(상품 편집은 즉시할인을 바꾸지 않고 다시 불러오게 한다). */
export function parseGoodsInstantDiscountState(value: unknown): GoodsInstantDiscountState | null {
  if (!isRecord(value) || !['none', 'editable', 'managed'].includes(String(value.state))
    || !(value.reason === null || ['promotion', 'instant', 'mixed'].includes(String(value.reason)))
    || typeof value.fingerprint !== 'string' || value.fingerprint.length < 1 || value.fingerprint.length > 64
    || !Array.isArray(value.promotions)) return null;
  const period = value.period ?? null;
  if (period !== null && (!isRecord(period) || !whole(period.amount, 1) || !instantText(period.startsAt) || !instantText(period.endsAt))) return null;
  const summary = value.summary ?? null;
  if (summary !== null && (!isRecord(summary) || !whole(summary.count, 1) || !whole(summary.minPrice, 1) || !whole(summary.maxPrice, 1)
    || !instantText(summary.startsAt) || !instantText(summary.endsAt))) return null;
  const promotions: { id: string; name: string }[] = [];
  for (const item of value.promotions) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name) return null;
    promotions.push({ id: item.id, name: item.name });
  }
  const state = value.state as GoodsInstantDiscountState['state'];
  if ((state === 'editable') !== (period !== null) || (state === 'none') !== (summary === null)) return null;
  return { state, reason: (value.reason ?? null) as GoodsInstantDiscountState['reason'], fingerprint: value.fingerprint,
    period: period as GoodsInstantDiscountState['period'], summary: summary as GoodsInstantDiscountState['summary'], promotions,
    ...(whole(value.uncovered, 1) ? { uncovered: value.uncovered as number } : {}) };
}

export type GoodsPriceResolution = {
  /** form `price` 값 */
  price: string;
  /** form `compareAtPrice` 값 */
  compareAtPrice: string;
  /** 해석한 판매가. 판매가 입력이 잘못되면 null */
  regularPrice: number | null;
  /** 적용되는 할인 금액(원). 할인이 없거나 잘못되면 0 */
  discountAmount: number;
  /** 고객 결제 기준 금액(할인가 또는 판매가, 기간 즉시할인이면 기간 중 할인가). 판매가 입력이 잘못되면 null */
  salePrice: number | null;
  /** 저장되는 기준 금액(`price`, 옵션가를 더하는 금액). 기간 즉시할인이면 판매가다. 판매가 입력이 잘못되면 null */
  basePrice: number | null;
  /** 특정기간만 할인. 서버 지시의 금액·기간(ISO). 기간이 없거나 입력이 잘못되면 null */
  period: { amount: number; startsAt: string; endsAt: string } | null;
  regularPriceError?: string;
  discountError?: string;
  periodError?: string;
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
 * 할인율(%) = 할인액 ÷ 판매가 × 100을 반올림한다(10/27 회의 R18). 고객 화면 할인율 배지
 * (components/wc/PriceBlock.tsx의 `Math.round((1 - 판매 금액 / 정가) * 100)`)와 같은 식이라 표시가 어긋나지 않는다.
 */
export function goodsDiscountRate(regularPrice: number, salePrice: number): number {
  return regularPrice > 0 && salePrice < regularPrice ? Math.round((1 - salePrice / regularPrice) * 100) : 0;
}

/** 즉시할인 결과 문구: '할인가 X원 (Y원, Z% 할인)'. 할인이 없거나 입력이 잘못되면 null. */
export function goodsDiscountResultText(result: Pick<GoodsPriceResolution, 'regularPrice' | 'salePrice' | 'discountAmount'>): string | null {
  if (result.discountAmount <= 0 || result.salePrice === null || result.regularPrice === null) return null;
  return `할인가 ${formatWon(result.salePrice)} (${formatWon(result.discountAmount)}, ${goodsDiscountRate(result.regularPrice, result.salePrice)}% 할인)`;
}

/**
 * 편집을 열 때의 입력 상태. 실패·브라우저 복구로 화면 입력이 돌아오면 그 값을 그대로 쓰고,
 * 아니면 저장된 `price`·`compareAtPrice`에서 판매가·할인(원)을 되짚는다.
 */
export function goodsPriceDraftFromValues(values: Readonly<Record<string, string | undefined>>, instant?: GoodsInstantDiscountState | null): GoodsPriceDraft {
  if (values.regularPrice !== undefined) {
    return {
      regularPrice: values.regularPrice,
      discountEnabled: values.discountEnabled === 'true',
      discountValue: values.discountValue ?? '',
      discountUnit: values.discountUnit === 'percent' ? 'percent' : 'won',
      periodEnabled: values.discountPeriodEnabled === 'true',
      periodStartsAt: values.discountStartsAt ?? '',
      periodEndsAt: values.discountEndsAt ?? '',
    };
  }
  const price = wholeWon(values.price);
  const compare = wholeWon(values.compareAtPrice);
  const noPeriod = { periodEnabled: false, periodStartsAt: '', periodEndsAt: '' };
  /* 상품 편집이 다루는 기간 즉시할인(진행·예정)은 판매가(할인 전) + 원 할인 + 기간으로 연다. */
  if (instant?.state === 'editable' && instant.period && price !== null && (compare === null || compare <= price)) {
    return { regularPrice: String(price), discountEnabled: true, discountValue: String(instant.period.amount), discountUnit: 'won',
      periodEnabled: true, periodStartsAt: toKstDateTimeInput(instant.period.startsAt), periodEndsAt: toKstDateTimeInput(instant.period.endsAt) };
  }
  if (price !== null && compare !== null && compare > price) {
    return { regularPrice: String(compare), discountEnabled: true, discountValue: String(compare - price), discountUnit: 'won', ...noPeriod };
  }
  const regularPrice = (values.price ?? '').trim();
  return { regularPrice: regularPrice === '0' ? '' : regularPrice, discountEnabled: false, discountValue: '', discountUnit: 'won', ...noPeriod };
}

const PERIOD_ERROR = '할인 시작·종료를 한국 시간으로 모두 입력해주세요. 종료는 시작보다 늦어야 합니다.';

/** 특정기간만 할인의 기간 입력(한국 시간)을 ISO로 바꾼다. `now`보다 종료가 이르면(이미 끝난 할인) 오류다. */
function discountPeriod(draft: GoodsPriceDraft, now: number): { startsAt: string; endsAt: string } | { error: string } {
  const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: draft.periodStartsAt?.trim() || null, endsAt: draft.periodEndsAt?.trim() || null });
  if (!parsed?.startsAt || !parsed.endsAt) return { error: PERIOD_ERROR };
  if (Date.parse(parsed.endsAt) <= now) return { error: '할인 종료 시각이 이미 지났습니다. 종료를 지금 이후로 입력해주세요.' };
  return { startsAt: parsed.startsAt, endsAt: parsed.endsAt };
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

/**
 * 저장할 때의 변환. 잘못된 할인은 오류로 돌려주고 저장 값에는 할인을 싣지 않는다.
 * 특정기간만 할인이면 저장 값은 판매가 그대로이고(`period`가 서버 지시), 기간 입력이 잘못되면 `periodError`다.
 */
export function resolveGoodsPrice(draft: GoodsPriceDraft, now = Date.now()): GoodsPriceResolution {
  const regularText = draft.regularPrice.trim();
  const regular = regularText === '' ? 0 : wholeWon(regularText);
  if (regular === null) {
    return {
      price: regularText, compareAtPrice: '', regularPrice: null, discountAmount: 0, salePrice: null, basePrice: null, period: null,
      regularPriceError: '판매가는 0원 이상의 정수로 입력해주세요.',
    };
  }
  const regularValue = regularText === '' ? '' : String(regular);
  const plain = { price: regularValue, compareAtPrice: '', regularPrice: regular, discountAmount: 0, salePrice: regular, basePrice: regular, period: null };
  if (!draft.discountEnabled) return plain;
  const discount = discountAmount(regular, draft);
  const periodInput = draft.periodEnabled ? discountPeriod(draft, now) : null;
  const periodError = periodInput && 'error' in periodInput ? periodInput.error : undefined;
  if ('error' in discount) return { ...plain, discountError: discount.error, ...(periodError ? { periodError } : {}) };
  const salePrice = regular - discount.amount;
  if (periodInput) {
    /* 기간 할인가는 옵션마다 같은 금액을 뺀다. 저장되는 판매가·옵션 금액은 할인 전 그대로다. */
    if ('error' in periodInput) return { ...plain, discountAmount: discount.amount, salePrice, periodError: periodInput.error };
    return { ...plain, discountAmount: discount.amount, salePrice, period: { amount: discount.amount, ...periodInput } };
  }
  return { price: String(salePrice), compareAtPrice: String(regular), regularPrice: regular, discountAmount: discount.amount, salePrice, basePrice: salePrice, period: null };
}

/**
 * 서버로 보내는 즉시할인 기간 지시(JSON 문자열). 상품 편집이 다루지 않는 할인 상태(`managed`)이거나 상태를 모르면 빈 값을 보내
 * 지시 없는 저장(기간 할인 원장은 건드리지 않음)이 된다. 기간이 꺼져 있으면 `none`이고, 서버는 이 상품 편집이 다루던 기간 할인을 멈춘다.
 */
export function instantDiscountPeriodRequest(result: GoodsPriceResolution, state: GoodsInstantDiscountState | null | undefined): string {
  if (!state || state.state === 'managed') return '';
  if (!result.period) return JSON.stringify({ mode: 'none', expectedFingerprint: state.fingerprint });
  /* 화면 입력은 분 단위다. 저장된 기간과 같은 분이면 저장된 시각 그대로 보내 같은 값 재저장이 원장을 바꾸지 않게 한다. */
  const keep = (input: string, saved: string | undefined) => saved && toKstDateTimeInput(input) === toKstDateTimeInput(saved) ? saved : input;
  return JSON.stringify({ mode: 'period', amount: result.period.amount, startsAt: keep(result.period.startsAt, state.period?.startsAt),
    endsAt: keep(result.period.endsAt, state.period?.endsAt), expectedFingerprint: state.fingerprint });
}

export type InstantDiscountPeriodRequest =
  | { mode: 'none'; expectedFingerprint: string }
  | { mode: 'period'; amount: number; startsAt: string; endsAt: string; expectedFingerprint: string };

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
/** 서버 액션이 받는 지시 검증. 없으면 `absent`(지시 없는 저장), 모양이 다르면 null. 금액·기간 규칙은 DB가 다시 검사한다. */
export function parseInstantDiscountPeriodRequest(raw: FormDataEntryValue | null): InstantDiscountPeriodRequest | 'absent' | null {
  if (raw === null || raw === '') return 'absent';
  if (typeof raw !== 'string' || raw.length > 400) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || typeof value.expectedFingerprint !== 'string' || value.expectedFingerprint.length < 1 || value.expectedFingerprint.length > 64) return null;
  const keys = Object.keys(value).sort().join(',');
  if (value.mode === 'none') return keys === 'expectedFingerprint,mode' ? { mode: 'none', expectedFingerprint: value.expectedFingerprint } : null;
  if (value.mode !== 'period' || keys !== 'amount,endsAt,expectedFingerprint,mode,startsAt' || !whole(value.amount, 1)
    || !instantText(value.startsAt) || !instantText(value.endsAt) || !OFFSET.test(value.startsAt) || !OFFSET.test(value.endsAt)
    || Date.parse(value.startsAt) >= Date.parse(value.endsAt)) return null;
  return { mode: 'period', amount: value.amount as number, startsAt: value.startsAt, endsAt: value.endsAt, expectedFingerprint: value.expectedFingerprint };
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
