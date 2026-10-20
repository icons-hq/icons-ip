'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh a scheduled public block even when it has no currently visible rows. */
export function ScheduledHomeRefresh({ at }: { at: string }) {
  const router = useRouter();
  useEffect(() => {
    const boundary = Date.parse(at);
    if (!Number.isFinite(boundary)) return;
    let refreshed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (refreshed) return;
      const delay = boundary - Date.now();
      if (delay <= 0) { refreshed = true; router.refresh(); }
      else timer = setTimeout(check, Math.min(delay + 50, 2_147_483_647));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => { if (timer !== null) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [at, router]);
  return null;
}
