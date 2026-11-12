'use client';

import { useEffect, useState } from 'react';
import { quoteDraftStoreCreditsAction } from '@/app/checkout/store-credit-actions';
import { quoteGoodsSalesWithCouponAction } from '@/app/cart/sales-actions';
import { aggregateCartVariantQuantities, type CartItem } from '@/lib/cart';
import type { CheckoutDraftCoupon } from '@/lib/checkout-draft';
import type { AddressGoodsSalesQuote, AddressShippingQuote, ShippingDestination } from '@/lib/shipping-regions';
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

interface SalesState { key: string; sales: AddressGoodsSalesQuote | null; error: string | null }

/**
 * 바로구매 주문서(ADR-0030)의 가격·배송비·쿠폰 견적. useShippingQuote(장바구니 쿠폰 선택)와 같은 모양·갱신 규칙이고,
 * 쿠폰만 주문서에서 고른 쿠폰이다. 판매 기간·가격 경계가 오면 다시 묻고, 창으로 돌아오면 새로 묻는다.
 */
export function useDirectCheckoutQuote(items: readonly CartItem[], enabled: boolean, userCouponId: string | null, destination: ShippingDestination | null) {
  const key = JSON.stringify({ items: aggregateCartVariantQuantities(items), userCouponId, destination });
  const [state, setState] = useState<SalesState | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !items.length) return;
    let cancelled = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const request = ++generation;
      try {
        const input = JSON.parse(key);
        const result = await quoteGoodsSalesWithCouponAction(input.items, input.destination, input.userCouponId);
        if (cancelled || request !== generation) return;
        setState({ key, sales: result.ok ? result.quote : null, error: result.ok ? null : result.error });
        clearTimeout(timer);
        const changes = result.ok ? [result.quote.nextChangeAt, result.quote.shipping.nextChangeAt].filter((value): value is string => typeof value === 'string') : [];
        const next = changes.length ? Math.min(...changes.map(value => Date.parse(value))) - Date.now() + 25 : 60_000;
        timer = setTimeout(refreshQuote, Math.max(100, Math.min(60_000, next)));
      } catch {
        if (!cancelled && request === generation) setState({ key, sales: null, error: '가격과 배송비를 확인하지 못했습니다. 다시 시도해주세요.' });
      }
    };
    function refreshQuote() {
      if (document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      setState(null);
      void load();
    }
    void load();
    window.addEventListener('focus', refreshQuote);
    document.addEventListener('visibilitychange', refreshQuote);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', refreshQuote);
      document.removeEventListener('visibilitychange', refreshQuote);
    };
  }, [enabled, key, items.length, retry]);
  const current = enabled && state?.key === key ? state : null;
  return {
    sales: current?.sales ?? null,
    error: current?.error ?? null,
    loading: enabled && items.length > 0 && !current,
    quote: (current?.sales?.shipping ?? null) as AddressShippingQuote | null,
    refresh: () => { setState(null); setRetry(value => value + 1); },
  };
}

