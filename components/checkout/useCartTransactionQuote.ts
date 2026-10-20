'use client';

import { useEffect, useState } from 'react';
import { quoteCartTransactionAction, type CartTransactionQuoteResult } from '@/app/checkout/transaction-actions';
import type { CartTransactionInput } from '@/lib/checkout-transaction';
import type { GoodsTransactionOffer } from '@/lib/goods-transaction-offers';

export function useCartTransactionQuote(input: CartTransactionInput | null, enabled: boolean, paused: boolean, onOffers?: (offers: GoodsTransactionOffer[]) => void) {
  const key = input ? JSON.stringify(input) : null;
  const [state, setState] = useState<{ key: string; result: CartTransactionQuoteResult } | null>(null);
  const [offers, setOffers] = useState<GoodsTransactionOffer[]>([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key || !enabled || paused) return;
    let cancelled = false, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const request = ++generation;
      try {
        const result = await quoteCartTransactionAction(JSON.parse(key));
        if (cancelled || request !== generation) return;
        setState({ key, result });
        if (result.ok) { setOffers(result.offers); onOffers?.(result.offers); }
        const expiry = result.ok && result.quote.state === 'quoted' ? Date.parse(result.quote.expiresAt) - Date.now() : 60_000;
        clearTimeout(timer);
        timer = setTimeout(refresh, Math.max(100, Math.min(60_000, expiry)));
      } catch {
        if (!cancelled && request === generation) setState({ key, result: { ok: false, error: 'unavailable' } });
      }
    };
    function refresh() {
      clearTimeout(timer);
      // Expired/background quotes are never shown as current when returning to the tab.
      setState(null);
      if (document.visibilityState !== 'hidden') void load();
    }
    timer = setTimeout(() => void load(), 300);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [key, enabled, paused, retry, onOffers]);
  const result = enabled && state?.key === key ? state.result : null;
  return { result, offers: enabled ? offers : [], loading: Boolean(enabled && key && !result && !paused), refresh: () => { setState(null); setRetry(value => value + 1); } };
}
