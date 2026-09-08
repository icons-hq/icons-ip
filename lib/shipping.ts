import { krw } from './format';

/** Stored receipt amounts are formatted without reapplying current shipping policy. */
export function shippingFeeLabel(shippingFee: number): string {
  return shippingFee <= 0 ? '무료' : krw(shippingFee);
}
