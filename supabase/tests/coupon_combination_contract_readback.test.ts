import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseCheckoutTransactionReceipt } from '@/lib/checkout-transaction';
import { parseGoodsTransactionQuote } from '@/lib/goods-transaction';
import { hasShippingChargeDetails, parseShippingChargeSnapshot } from '@/lib/shipping-charge-groups';
const path = process.env.ICONS_COUPON_READBACK;
it.skipIf(!path)('isolated SQL quote, frozen receipt and shipping components agree at application boundaries', () => {
 const row = JSON.parse(readFileSync(path!, 'utf8')) as { quote: unknown; receipt: unknown; shipping: unknown[] };
 const quote = parseGoodsTransactionQuote(row.quote), receipt = parseCheckoutTransactionReceipt(row.receipt);
 expect(quote).not.toBeNull(); expect(receipt).not.toBeNull();
 expect(receipt!.display.coupons).toHaveLength(3); expect(receipt!.display.totals).toMatchObject({ couponDiscountTotal: 5200, shippingCouponDiscountTotal: 3500, prepaidShippingTotal: 5900, onlineTotal: 25700 });
 for (const group of row.shipping) if (hasShippingChargeDetails(group)) expect(parseShippingChargeSnapshot(group)).not.toBeNull();
});
