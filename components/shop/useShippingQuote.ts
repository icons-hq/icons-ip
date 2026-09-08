'use client';

import { useEffect, useState } from 'react';
import { quoteGoodsShippingAction } from '@/app/cart/shipping-actions';
import type { CartItem } from '@/lib/cart';
import type { ShippingQuote } from '@/lib/fulfillment';

interface QuoteState { key: string; quote: ShippingQuote | null; error: string | null }

/** An older response never supplies the total for a newer cart. Only the DB quotes shipping. */
export function useShippingQuote(items: readonly CartItem[], enabled: boolean) {
  const key = JSON.stringify(items);
  const [state, setState] = useState<QuoteState | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !items.length) return;
    let cancelled = false;
    void quoteGoodsShippingAction(JSON.parse(key)).then(result => {
      if (!cancelled) setState({ key, quote: result.ok ? result.quote : null, error: result.ok ? null : result.error });
    }).catch(() => {
      if (!cancelled) setState({ key, quote: null, error: '배송비를 확인하지 못했습니다. 다시 시도해주세요.' });
    });
    return () => { cancelled = true; };
  }, [enabled, key, items.length, retry]);
  const current = state?.key === key ? state : null;
  const empty = enabled && items.length === 0;
  return {
    quote: empty ? {totalFee: 0, groups: []} as ShippingQuote : current?.quote ?? null,
    error: current?.error ?? null,
    loading: enabled && !empty && !current,
    refresh: () => { setState(null); setRetry(value => value + 1); },
  };
}
