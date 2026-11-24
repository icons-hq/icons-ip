'use server';
import { unstable_rethrow } from 'next/navigation';
import { parseShippingQuoteItems, type ShippingQuote } from '@/lib/fulfillment';
import { loadGoodsShippingQuote } from '@/lib/fulfillment.server';

export type ShippingQuoteActionResult = { ok: true; quote: ShippingQuote } | { ok: false; error: string };
export async function quoteGoodsShippingAction(input: unknown): Promise<ShippingQuoteActionResult> {
  const items = parseShippingQuoteItems(input);
  if (!items) return { ok: false, error: '배송비를 확인할 상품과 수량을 다시 확인해주세요.' };
  if (!items.length) return { ok: true, quote: { totalFee: 0, groups: [] } };
  try {
    const quote = await loadGoodsShippingQuote(items);
    return quote ? { ok: true, quote } : { ok: false, error: '배송비를 확인하지 못했습니다. 상품의 판매 상태를 확인한 뒤 다시 시도해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '배송비를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
