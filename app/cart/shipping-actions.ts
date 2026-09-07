'use server';

import type { CartItem } from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';

export interface ShippingQuote {
  fee: number;
  /** 무료배송까지 남은 금액. **정책이 섞인 장바구니에서는 null** — 답이 하나가 아니다. */
  freeRemaining: number | null;
}

/** 견적을 못 받았을 때. 화면은 이 상태를 「계산 중」으로 그리고 금액을 단정하지 않는다. */
export const UNKNOWN_SHIPPING_QUOTE: ShippingQuote = { fee: 0, freeRemaining: null };

const MAX_LINES = 200;

/*
 * 배송비 견적 (현업 슬라이스 2 후속).
 *
 * 화면이 코드 상수로 어림잡던 것을 서버가 계산한다 — 청구와 **같은 함수**를 본다.
 * 정책이 섞인 장바구니(묶음배송 꺼진 상품·도서산간)에서 어림값은 실제와 달랐다.
 *
 * 실패는 예외로 던지지 않는다. 배송비를 못 셌다고 장바구니가 열리지 않으면 그게 더 나쁘다 —
 * 화면이 「계산 중」으로 두고, 확정 금액은 어차피 주문 생성이 다시 만든다.
 */
export async function quoteShippingAction(
  items: readonly CartItem[],
  postalCode: string | null,
): Promise<ShippingQuote | null> {
  const lines = items
    .filter((item) => typeof item.goodId === 'string' && item.goodId && item.qty > 0)
    .slice(0, MAX_LINES)
    .map((item) => ({ goodId: item.goodId, qty: item.qty }));
  if (lines.length === 0) return { fee: 0, freeRemaining: null };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('shipping_quote_for_lines', {
      p_lines: lines,
      p_postal_code: postalCode,
    });
    if (error) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const quote = row as { fee: number | string; free_remaining: number | string | null };
    return {
      fee: Number(quote.fee) || 0,
      freeRemaining: quote.free_remaining === null ? null : Number(quote.free_remaining),
    };
  } catch {
    return null;
  }
}
