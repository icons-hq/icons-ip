'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { routes } from '@/lib/routes';

/**
 * 선물하기를 열지 — 응답 전·실패는 false.
 * 구매 패널이 다시 마운트돼도 같은 질문을 반복하지 않도록 굿즈 상세가 한 번 부르고 결과를 내려 준다.
 */
export function useGiftPurchaseAvailable(enabled = true): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled || !getSupabaseConfig().isConfigured) return;
    let alive = true;
    void createClient().rpc('get_gift_availability').then(({ data, error }) => { if (alive) setAvailable(!error && data === true); });
    return () => { alive = false; };
  }, [enabled]);
  return available;
}

/** Preparation explicitly selects a copy of cart lines on its own screen. `available`을 받으면 스스로 묻지 않는다. */
export function GiftPurchaseEntry({ available }: { available?: boolean } = {}) {
  const fetched = useGiftPurchaseAvailable(available === undefined);
  if (!(available ?? fetched)) return null;
  return <aside className="wc-good-gift-entry"><Link href={routes.gifts()}>선물함</Link><p>장바구니에 담은 굿즈로 선물을 준비할 수 있어요.</p></aside>;
}
