import type { Good, GoodOption } from './data';
import type { GoodsSalesQuoteLine } from './goods-sales';

export function optionPriceRange(options: readonly GoodOption[]) {
  const prices = options.map(option => option.price);
  return { price: Math.min(...prices), priceMax: Math.max(...prices) };
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
  return { ...good, price: option.price, priceMax: option.price, stockQty: option.stockQty,
    compareAtPrice: option.pricing?.pricePeriodId ? option.pricing.regularPrice : good.catalogCompareAtPrice !== undefined ? good.catalogCompareAtPrice : good.compareAtPrice,
    stock: option.stockQty <= 0 || good.stock === 'soldout' ? 'soldout' : good.stock };
}

export function goodsPurchaseConditionProblem(good: Pick<Good,
  'allowCardPayment' | 'allowBankTransfer' | 'saleRestriction' | 'orderQuantityLimitEnabled' |
  'minOrderQty' | 'maxOrderQty' | 'memberPurchaseLimitEnabled' | 'memberLifetimeQtyLimit'>): string | null {
  if (good.saleRestriction === 'adult') return '현재 판매 준비 중인 상품입니다.';
  if (good.allowCardPayment === false && good.allowBankTransfer === false) return '현재 주문을 받지 않는 상품입니다.';
  if ((good.orderQuantityLimitEnabled && (!good.minOrderQty || !good.maxOrderQty || good.minOrderQty > good.maxOrderQty))
    || (good.memberPurchaseLimitEnabled && !good.memberLifetimeQtyLimit)) return '구매 조건을 확인 중인 상품입니다.';
  return null;
}

export function goodAtQuotedPrice(good: Good | undefined, line: GoodsSalesQuoteLine | undefined): Good | undefined {
  if (!good || !line) return good;
  return { ...good, price: line.effectivePrice, priceMax: line.effectivePrice,
    ...(line.supply ? { stockQty: line.supply.availableQty,
      stock: line.supply.availableQty > 0 && (line.available || line.qty > line.supply.availableQty) ? 'ok' : 'soldout' } as const : {}),
    compareAtPrice: line.pricePeriodId ? line.regularPrice : good.catalogCompareAtPrice !== undefined ? good.catalogCompareAtPrice : good.compareAtPrice };
}
