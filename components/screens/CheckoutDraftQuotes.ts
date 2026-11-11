'use client';

import { useEffect, useState } from 'react';
import { quoteDraftStoreCreditsAction } from '@/app/checkout/store-credit-actions';
import { aggregateCartVariantQuantities, type CartItem } from '@/lib/cart';
import type { CheckoutDraftCoupon } from '@/lib/checkout-draft';
import type { ShippingDestination } from '@/lib/shipping-regions';
import type { StoreCreditCheckoutQuote } from '@/lib/store-credits';

interface QuoteState { key: string; quote: StoreCreditCheckoutQuote | null; error: string | null }

/**
 * 주문서 초안(선택 주문·바로구매, ADR-0030)의 적립금 사용 한도. useStoreCreditQuote(장바구니 전체)와 같은 갱신
 * 규칙이고, 품목·쿠폰만 그 주문서의 것이다. `salesRevision`이 null이면 묻지 않는다(초안이 아닌 주문서).
 */
export function useDraftStoreCreditQuote(
  amount: number | null,
  salesRevision: string | null,
  destination: ShippingDestination | null,
  items: readonly CartItem[],
  coupon: CheckoutDraftCoupon,
) {
  const key = JSON.stringify([amount, salesRevision, destination, aggregateCartVariantQuantities(items), coupon]);
  const [state, setState] = useState<QuoteState | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (amount === null || salesRevision === null) return;
    let canceled = false;
    const [, , requestedDestination, requestedItems, requestedCoupon] = JSON.parse(key);
    void quoteDraftStoreCreditsAction(amount, requestedDestination, requestedItems, requestedCoupon).then(result => {
      if (!canceled) setState({ key, quote: result.ok ? result.quote : null, error: result.ok ? null : result.error });
    }).catch(() => {
      if (!canceled) setState({ key, quote: null, error: '적립금을 확인하지 못했습니다. 다시 조회해주세요.' });
    });
    return () => { canceled = true; };
  }, [amount, salesRevision, key, retry]);
  const current = state?.key === key ? state : null;
  return {
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    loading: amount !== null && salesRevision !== null && current === null,
    refresh: () => { setState(null); setRetry(value => value + 1); },
  };
}
