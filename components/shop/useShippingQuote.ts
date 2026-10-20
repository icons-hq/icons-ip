'use client';

import { useEffect, useState } from 'react';
import { quoteGoodsSalesAction, quoteGoodsSalesPrecheckoutAction } from '@/app/cart/sales-actions';
import { aggregateCartVariantQuantities, type CartItem } from '@/lib/cart';
import type { AddressShippingQuote, AddressGoodsSalesQuote, ShippingDestination } from '@/lib/shipping-regions';
import type { GoodsSalesPrecheckoutQuote } from '@/lib/goods-sales';
import type { ShippingQuoteItem } from '@/lib/fulfillment';

interface QuoteState<Quote> { key: string; sales: Quote | null; error: string | null }
type QuoteResult<Quote> = { ok: true; quote: Quote } | { ok: false; error: string };
type QuoteLoader<Quote> = (items: ShippingQuoteItem[], destination: ShippingDestination | null) => Promise<QuoteResult<Quote>>;
const legacyChangeTimes = (quote: AddressGoodsSalesQuote) => [quote.nextChangeAt, quote.shipping.nextChangeAt];
const precheckoutChangeTimes = (quote: GoodsSalesPrecheckoutQuote) => [quote.nextChangeAt];
const loadPrecheckoutQuote: QuoteLoader<GoodsSalesPrecheckoutQuote> = (items) => quoteGoodsSalesPrecheckoutAction(items);

function useGoodsQuote<Quote>(items: readonly CartItem[], enabled: boolean, refreshKey: string, destination: ShippingDestination | null,
  loadQuote: QuoteLoader<Quote>, changeTimes: (quote: Quote) => (string | null | undefined)[], errorMessage: string) {
  const key = JSON.stringify({ items:aggregateCartVariantQuantities(items), refreshKey, destination });
  const [state, setState] = useState<QuoteState<Quote> | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !items.length) return;
    let cancelled = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const request = ++generation;
      try {
        const requestInput = JSON.parse(key);
        const result = await loadQuote(requestInput.items, requestInput.destination);
        if (cancelled || request !== generation) return;
        setState({ key, sales: result.ok ? result.quote : null, error: result.ok ? null : result.error });
        clearTimeout(timer);
        const changes = result.ok ? changeTimes(result.quote).filter((value): value is string => typeof value === 'string') : [];
        const next = changes.length ? Math.min(...changes.map(value => Date.parse(value))) - Date.now() + 25 : 60_000;
        timer = setTimeout(refreshQuote, Math.max(100, Math.min(60_000, next)));
      } catch {
        if (!cancelled && request === generation) setState({ key, sales: null, error: errorMessage });
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
  }, [enabled, key, items.length, retry, loadQuote, changeTimes, errorMessage]);
  const current = enabled && state?.key === key ? state : null;
  const empty = enabled && items.length === 0;
  return {
    sales: current?.sales ?? null,
    error: current?.error ?? null,
    loading: enabled && !empty && !current,
    refresh: () => { setState(null); setRetry(value => value + 1); },
  };
}

/** Legacy checkout keeps its address-aware shipping and coupon contract. */
export function useShippingQuote(items: readonly CartItem[], enabled: boolean, refreshKey = '', destination: ShippingDestination | null = null) {
  const state = useGoodsQuote(items, enabled, refreshKey, destination, quoteGoodsSalesAction, legacyChangeTimes,
    '가격과 배송비를 확인하지 못했습니다. 다시 시도해주세요.');
  return {
    ...state,
    quote: enabled && items.length === 0
      ? { totalFee: 0, groups: [], checkoutAllowed: true, finalTotalFee: 0, destination, nextChangeAt: null } as AddressShippingQuote
      : state.sales?.shipping ?? null,
  };
}

/** Transaction carts refresh product conditions without claiming a shipping amount. */
export function useGoodsSalesPrecheckoutQuote(items: readonly CartItem[], enabled: boolean) {
  return useGoodsQuote(items, enabled, '', null, loadPrecheckoutQuote, precheckoutChangeTimes,
    '가격과 구매 조건을 확인하지 못했습니다. 다시 시도해주세요.');
}
