'use client';

import { useEffect, useState } from 'react';
import { quoteGoodsSalesAction } from '@/app/cart/sales-actions';
import type { CartItem } from '@/lib/cart';
import type { AddressShippingQuote, AddressGoodsSalesQuote, ShippingDestination } from '@/lib/shipping-regions';

interface QuoteState { key: string; quote: AddressShippingQuote | null; sales: AddressGoodsSalesQuote | null; error: string | null }

/** Prices, quantity conditions and shipping come from one DB evaluation. */
export function useShippingQuote(items: readonly CartItem[], enabled: boolean, refreshKey = '', destination: ShippingDestination | null = null) {
  const key = JSON.stringify({ items, refreshKey, destination });
  const [state, setState] = useState<QuoteState | null>(null);
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
        const result = await quoteGoodsSalesAction(requestInput.items, requestInput.destination);
        if (cancelled || request !== generation) return;
        setState({ key, quote: result.ok ? result.quote.shipping : null, sales: result.ok ? result.quote : null, error: result.ok ? null : result.error });
        clearTimeout(timer);
        const changes = result.ok ? [result.quote.nextChangeAt, result.quote.shipping.nextChangeAt].filter((value): value is string => value !== null) : [];
        const next = changes.length ? Math.min(...changes.map(value => Date.parse(value))) - Date.now() + 25 : 60_000;
        timer = setTimeout(refreshQuote, Math.max(100, Math.min(60_000, next)));
      } catch {
        if (!cancelled && request === generation) setState({ key, quote: null, sales: null, error: '가격과 배송비를 확인하지 못했습니다. 다시 시도해주세요.' });
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
  const current = state?.key === key ? state : null;
  const empty = enabled && items.length === 0;
  return {
    quote: empty ? {totalFee: 0, groups: [], checkoutAllowed: true, finalTotalFee: 0, destination, nextChangeAt: null} as AddressShippingQuote : current?.quote ?? null,
    sales: current?.sales ?? null,
    error: current?.error ?? null,
    loading: enabled && !empty && !current,
    refresh: () => { setState(null); setRetry(value => value + 1); },
  };
}
