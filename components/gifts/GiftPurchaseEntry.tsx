'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { routes } from '@/lib/routes';
/** Preparation explicitly selects a copy of cart lines on its own screen. */
export function GiftPurchaseEntry() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let alive = true;
    void createClient().rpc('get_gift_availability').then(({ data, error }) => { if (alive) setAvailable(!error && data === true); });
    return () => { alive = false; };
  }, []);
  if (!available) return null;
  return <aside className="wc-good-gift-entry"><Link href={routes.gifts()}>선물함</Link><p>장바구니에 담은 굿즈로 선물을 준비할 수 있어요.</p></aside>;
}
