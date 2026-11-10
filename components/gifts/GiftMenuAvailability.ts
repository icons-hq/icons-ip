'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { usePathname } from 'next/navigation';

export function useGiftMenuAvailable() {
  const [visible, setVisible] = useState(false), pathname = usePathname();
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let alive = true, generation = 0; const client = createClient();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const ticket = ++generation;
      if (!session?.user) { setVisible(false); return; }
      // A auth callback must not await another Supabase request under its lock.
      queueMicrotask(() => { void client.rpc('get_my_gift_menu_state').then(({ data: state, error }) => {
        if (alive && ticket === generation) setVisible(!error && (state?.canCreate === true || state?.hasGifts === true));
      }); });
    });
    return () => { alive = false; generation++; data.subscription.unsubscribe(); };
  }, [pathname]);
  return visible;
}
