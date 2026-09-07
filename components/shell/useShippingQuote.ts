'use client';

import { useEffect, useRef, useState } from 'react';
import { quoteShippingAction, type ShippingQuote } from '@/app/cart/shipping-actions';
import type { CartItem } from '@/lib/cart';

export interface ShippingQuoteState {
  quote: ShippingQuote | null;
  /** 아직 견적을 못 받았다. **화면은 금액을 단정하지 말고 「계산 중」으로 그린다.** */
  pending: boolean;
}

/*
 * 배송비 견적 (현업 슬라이스 2 후속).
 *
 * 담긴 것과 우편번호가 바뀌면 다시 묻는다. 같은 질문을 두 번 하지 않도록 키로 비교한다 —
 * 수량 스테퍼를 누를 때마다 왕복하면 화면이 덜컹거린다.
 */
export function useShippingQuote(
  items: readonly CartItem[],
  postalCode: string | null,
): ShippingQuoteState {
  const [state, setState] = useState<{ key: string; quote: ShippingQuote | null }>({
    key: '',
    quote: null,
  });
  const asked = useRef('');

  const key = JSON.stringify({
    lines: items.map((item) => [item.goodId, item.qty]),
    postalCode: postalCode ?? '',
  });

  useEffect(() => {
    if (asked.current === key) return;
    asked.current = key;

    let cancelled = false;
    const parsed = JSON.parse(key) as { lines: [string, number][]; postalCode: string };
    void quoteShippingAction(
      parsed.lines.map(([goodId, qty]) => ({ goodId, qty })),
      parsed.postalCode || null,
    ).then((quote) => {
      if (!cancelled) setState({ key, quote });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { quote: state.key === key ? state.quote : null, pending: state.key !== key };
}
