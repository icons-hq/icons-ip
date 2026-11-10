import { transactionInteger, transactionInstant, transactionRecord } from '@/lib/goods-transaction-values';
export interface MarketingCoupon {
  benefitKind?: 'goods' | 'shipping'; stackable?: boolean;
  code: string; name: string; discountType: 'fixed' | 'percent'; discountValue: number; maxDiscountAmount: number | null; minSubtotal: number;
  startsAt: string; endsAt: string | null; validDays: number | null; issueStartsAt: string; issueEndsAt: string | null; available: boolean;
}
export const marketingCouponCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][A-Z0-9-]{2,23}$/.test(value);
export function parseMarketingCoupon(value: unknown): MarketingCoupon | null {
  if (!transactionRecord(value) || value.benefitKind !== undefined && !['goods','shipping'].includes(String(value.benefitKind)) || value.stackable !== undefined && typeof value.stackable !== 'boolean' || !marketingCouponCode(value.code) || typeof value.name !== 'string' || !value.name || !['fixed','percent'].includes(String(value.discountType))
    || !transactionInteger(value.discountValue, 1, value.discountType === 'percent' ? 100 : 999_999_999_999) || !transactionInteger(value.minSubtotal, 0, 999_999_999_999)
    || value.maxDiscountAmount !== null && !transactionInteger(value.maxDiscountAmount, 1, 999_999_999_999) || !transactionInstant(value.startsAt) || !transactionInstant(value.issueStartsAt)
    || [value.endsAt, value.issueEndsAt].some(item => item !== null && !transactionInstant(item)) || value.validDays !== null && !transactionInteger(value.validDays, 0, 36500) || typeof value.available !== 'boolean') return null;
  return value as unknown as MarketingCoupon;
}
export function marketingCouponBenefit(coupon: MarketingCoupon) { return `${coupon.benefitKind === 'shipping' ? '배송비 ' : ''}${coupon.discountValue.toLocaleString('ko-KR')}${coupon.discountType === 'percent' ? '%' : '원'} 할인${coupon.maxDiscountAmount ? ` · 최대 ${coupon.maxDiscountAmount.toLocaleString('ko-KR')}원` : ''}`; }
