'use server';

import { unstable_rethrow } from 'next/navigation';
import { normalizeStoreCreditAmount, type StoreCreditCheckoutQuote } from '@/lib/store-credits';
import { loadMyStoreCreditCheckout } from '@/lib/store-credits.server';
import { parseShippingDestination } from '@/lib/shipping-regions';

export async function quoteCheckoutStoreCreditsAction(value: unknown, destinationInput: unknown = null): Promise<
  { ok: true; quote: StoreCreditCheckoutQuote } | { ok: false; error: string }
> {
  const amount = normalizeStoreCreditAmount(value);
  if (amount === null) return { ok: false, error: '사용할 적립금은 0 이상의 원 단위 정수로 입력해주세요.' };
  const destination = destinationInput === null ? null : parseShippingDestination(destinationInput);
  if (destinationInput !== null && !destination) return { ok: false, error: '적립금 사용 조건을 확인할 배송지 주소를 다시 확인해주세요.' };
  try {
    const quote = await loadMyStoreCreditCheckout(amount, destination);
    return quote ? { ok: true, quote } : { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' };
  }
}
