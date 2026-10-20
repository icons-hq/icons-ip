'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
export function useSubscriptionMenuAvailable() {
  const [visible, setVisible] = useState(false), pathname = usePathname();
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let alive = true, generation = 0; let controller: AbortController | null = null;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      const ticket = ++generation; controller?.abort(); setVisible(false); if (!session?.user) return;
      controller = new AbortController(); const signal = controller.signal;
      queueMicrotask(() => { void fetch('/api/subscriptions/availability', { cache: 'no-store', credentials: 'same-origin', signal })
        .then(response => response.ok ? response.json() : null).then(value => { if (alive && ticket === generation) setVisible(value?.menuAvailable === true); })
        .catch(() => { if (alive && ticket === generation) setVisible(false); }); });
    });
    return () => { alive = false; generation++; controller?.abort(); data.subscription.unsubscribe(); };
  }, [pathname]);
  return visible;
}
