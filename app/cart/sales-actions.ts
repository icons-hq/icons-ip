'use server';
import { unstable_rethrow } from 'next/navigation';
import { parseShippingQuoteItems } from '@/lib/fulfillment';
import { parseAddressGoodsSalesQuote, parseShippingDestination, type AddressGoodsSalesQuote } from '@/lib/shipping-regions';
import { loadGoodsSalesPrecheckoutQuote, loadGoodsSalesQuote } from '@/lib/goods-sales.server';
import type { GoodsSalesPrecheckoutQuote } from '@/lib/goods-sales';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type GoodsSalesQuoteActionResult = { ok: true; quote: AddressGoodsSalesQuote } | { ok: false; error: string };
export async function quoteGoodsSalesAction(input: unknown, destinationInput: unknown = null): Promise<GoodsSalesQuoteActionResult> {
  const items = parseShippingQuoteItems(input);
  if (!items) return { ok: false, error: '가격과 구매 조건을 확인할 굿즈·옵션·수량을 다시 확인해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '배송지의 우편번호와 기본 주소를 확인해주세요.' };
  try {
    const quote = await loadGoodsSalesQuote(items, destination);
    return quote ? { ok: true, quote }
      : { ok: false, error: '현재 가격과 구매 조건을 확인하지 못했습니다. 굿즈의 판매 상태를 다시 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '가격과 구매 조건을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export type GoodsSalesPrecheckoutQuoteActionResult = { ok: true; quote: GoodsSalesPrecheckoutQuote } | { ok: false; error: string };
export async function quoteGoodsSalesPrecheckoutAction(input: unknown): Promise<GoodsSalesPrecheckoutQuoteActionResult> {
  const items = parseShippingQuoteItems(input);
  if (!items) return { ok: false, error: '가격과 구매 조건을 확인할 굿즈·옵션·수량을 다시 확인해주세요.' };
  try {
    const quote = await loadGoodsSalesPrecheckoutQuote(items);
    return quote ? { ok: true, quote }
      : { ok: false, error: '현재 가격과 구매 조건을 확인하지 못했습니다. 굿즈의 판매 상태를 다시 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '가격과 구매 조건을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

/**
 * 바로구매 주문서(ADR-0030)의 견적. 장바구니 쿠폰 선택이 아니라 주문서에서 고른 쿠폰(`couponInput`, 없으면 null)으로
 * 할인을 계산한다 — 장바구니 쿠폰 선택은 바꾸지 않는다. 쿠폰 소유·조건은 DB가 로그인 사용자로 판정한다.
 */
export async function quoteGoodsSalesWithCouponAction(input: unknown, destinationInput: unknown, couponInput: unknown): Promise<GoodsSalesQuoteActionResult> {
  const items = parseShippingQuoteItems(input);
  if (!items) return { ok: false, error: '가격과 구매 조건을 확인할 굿즈·옵션·수량을 다시 확인해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '배송지의 우편번호와 기본 주소를 확인해주세요.' };
  if (couponInput !== null && !isUuid(couponInput)) return { ok: false, error: '고른 쿠폰을 다시 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('quote_goods_sales_for_address_with_coupon', {
      items, destination, p_user_coupon_id: couponInput === null ? null : couponInput.toLowerCase(),
    });
    const quote = error ? null : parseAddressGoodsSalesQuote(data);
    return quote ? { ok: true, quote }
      : { ok: false, error: '현재 가격과 구매 조건을 확인하지 못했습니다. 굿즈의 판매 상태를 다시 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '가격과 구매 조건을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

