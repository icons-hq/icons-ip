import type { Good, GoodOption } from './data';

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
    stock: option.stockQty <= 0 || good.stock === 'soldout' ? 'soldout' : good.stock };
}
