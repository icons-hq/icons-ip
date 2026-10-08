import type { Good, GoodOption } from './data';
import type { GoodsSalesQuoteLine, GoodsVariantPricing } from './goods-sales';

export function optionPriceRange(options: readonly GoodOption[]) {
  const prices = options.map(option => option.price);
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
}

/** 굿즈 행에 저장된 기준 판매가(`goods.price`)와 소비자가(`goods.compare_at_price`). */
export interface GoodsCatalogPricing {
  price: number;
  compareAtPrice: number | null;
}

type OptionPricing = Pick<GoodsVariantPricing, 'regularPrice' | 'pricePeriodId'>;
type PricedOption = Pick<GoodOption, 'price' | 'pricing'>;

/**
 * 옵션 가격 옆에 취소선으로 보일 정가. 표시 규칙일 뿐 결제 금액은 서버 견적·주문 RPC가 정한다.
 * 기간 할인 중이면 그 옵션의 정상가와 비교한다. 아니면 상품 할인 금액(소비자가 − 기준 판매가)을
 * 옵션 정상가에 더한다 — 옵션 추가금액은 할인하지 않으므로 옵션 정가는 소비자가 + 추가금액이다.
 */
export function optionCompareAtPrice(catalog: GoodsCatalogPricing, pricing: OptionPricing): number | null {
  if (pricing.pricePeriodId) return pricing.regularPrice;
  if (catalog.compareAtPrice === null || catalog.compareAtPrice <= catalog.price) return null;
  return pricing.regularPrice + catalog.compareAtPrice - catalog.price;
}

function optionPricing(option: PricedOption): OptionPricing {
  return option.pricing ?? { regularPrice: option.price, pricePeriodId: null };
}

/** 옵션을 고르기 전에는 최저 판매가 옵션을 보이므로 그 옵션의 정가를 쓴다. */
export function goodCompareAtPrice(catalog: GoodsCatalogPricing, options: readonly PricedOption[] | undefined): number | null {
  const cheapest = options?.reduce<PricedOption | undefined>((lowest, option) => !lowest || option.price < lowest.price ? option : lowest, undefined);
  return optionCompareAtPrice(catalog, cheapest ? optionPricing(cheapest) : { regularPrice: catalog.price, pricePeriodId: null });
}

/** 카탈로그를 거치지 않은 굿즈(목업·테스트)는 표시 가격을 저장값으로 본다. */
function catalogPricing(good: Good): GoodsCatalogPricing {
  return { price: good.catalogPrice ?? good.price,
    compareAtPrice: (good.catalogCompareAtPrice !== undefined ? good.catalogCompareAtPrice : good.compareAtPrice) ?? null };
}

export function initialGoodOption(good: Good): GoodOption | undefined {
  return good.options?.length === 1 && good.options[0].stockQty > 0 ? good.options[0] : undefined;
}

export function optionLabel(option: GoodOption | undefined, count: number): string | null {
  if (!option) return null;
  return count === 1 && option.isDefault && option.name === '기본 옵션' && Object.keys(option.attributes).length === 0
    ? null : option.name;
}

/** Cart identities are canonical before this display projection runs. */
export function cartOptionGood(good: Good | undefined, variantId: string): Good | undefined {
  if (!good) return undefined;
  const option = good.options?.find(option => option.id === variantId);
  if (!option) return undefined;
  const catalog = catalogPricing(good);
  return { ...good, price: option.price, priceMax: option.price, stockQty: option.stockQty,
    catalogPrice: catalog.price, catalogCompareAtPrice: catalog.compareAtPrice,
    compareAtPrice: optionCompareAtPrice(catalog, optionPricing(option)),
    stock: option.stockQty <= 0 || good.stock === 'soldout' ? 'soldout' : good.stock };
}

export function goodsPurchaseConditionProblem(good: Pick<Good,
  'allowCardPayment' | 'allowBankTransfer' | 'saleRestriction' | 'orderQuantityLimitEnabled' |
  'minOrderQty' | 'maxOrderQty' | 'memberPurchaseLimitEnabled' | 'memberLifetimeQtyLimit'>): string | null {
  if (good.saleRestriction === 'adult') return '현재 판매 준비 중인 굿즈입니다.';
  if (good.allowCardPayment === false && good.allowBankTransfer === false) return '현재 주문을 받지 않는 굿즈입니다.';
  if ((good.orderQuantityLimitEnabled && (!good.minOrderQty || !good.maxOrderQty || good.minOrderQty > good.maxOrderQty))
    || (good.memberPurchaseLimitEnabled && !good.memberLifetimeQtyLimit)) return '구매 조건을 확인 중인 굿즈입니다.';
  return null;
}

export function goodAtQuotedPrice(good: Good | undefined, line: GoodsSalesQuoteLine | undefined): Good | undefined {
  if (!good || !line) return good;
  return { ...good, price: line.effectivePrice, priceMax: line.effectivePrice,
    ...(line.supply ? { stockQty: line.supply.availableQty,
      stock: line.supply.availableQty > 0 && (line.available || line.qty > line.supply.availableQty) ? 'ok' : 'soldout' } as const : {}),
    compareAtPrice: optionCompareAtPrice(catalogPricing(good), line) };
}
