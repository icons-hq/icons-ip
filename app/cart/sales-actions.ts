'use server';
import { unstable_rethrow } from 'next/navigation';
import { parseShippingQuoteItems } from '@/lib/fulfillment';
import { parseShippingDestination, type AddressGoodsSalesQuote } from '@/lib/shipping-regions';
import { loadGoodsSalesQuote } from '@/lib/goods-sales.server';

export type GoodsSalesQuoteActionResult = { ok: true; quote: AddressGoodsSalesQuote } | { ok: false; error: string };
export async function quoteGoodsSalesAction(input: unknown, destinationInput: unknown = null): Promise<GoodsSalesQuoteActionResult> {
  const items = parseShippingQuoteItems(input);
  if (!items) return { ok: false, error: '가격과 구매 조건을 확인할 상품·옵션·수량을 다시 확인해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '배송지의 우편번호와 기본 주소를 확인해주세요.' };
  try {
    const quote = await loadGoodsSalesQuote(items, destination);
    return quote ? { ok: true, quote }
      : { ok: false, error: '현재 가격과 구매 조건을 확인하지 못했습니다. 상품의 판매 상태를 다시 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '가격과 구매 조건을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
