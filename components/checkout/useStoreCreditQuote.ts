'use client';

import { useEffect, useState } from 'react';
import { quoteCheckoutStoreCreditsAction } from '@/app/checkout/store-credit-actions';
import type { StoreCreditCheckoutQuote } from '@/lib/store-credits';
import type { ShippingDestination } from '@/lib/shipping-regions';

interface QuoteState { key: string; quote: StoreCreditCheckoutQuote | null; error: string | null }

/** A changed cart, server price evaluation or requested amount invalidates the old quote. */
export function useStoreCreditQuote(amount: number | null, salesRevision: string | null, destination: ShippingDestination | null = null) {
  const key = JSON.stringify([amount, salesRevision, destination]);
  const [state, setState] = useState<QuoteState | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (amount === null || salesRevision === null) return;
    let canceled = false;
    void quoteCheckoutStoreCreditsAction(amount, JSON.parse(key)[2]).then(result => {
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
