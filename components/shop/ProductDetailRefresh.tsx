'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function ProductDetailRefresh({ nextChangeAt, onRefresh }: { nextChangeAt: string | null; onRefresh?: () => void }) {
  const router = useRouter();
  useEffect(() => {
    const boundary = nextChangeAt ? Date.parse(nextChangeAt) : NaN;
    if (!Number.isFinite(boundary)) return;
    let refreshed = false;
    const refresh = () => { if (!refreshed && document.visibilityState !== 'hidden' && Date.now() >= boundary) { refreshed = true; if (onRefresh) onRefresh(); else router.refresh(); } };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { if (Date.now() < boundary) schedule(); else refresh(); }, Math.min(2147483647, Math.max(100, boundary - Date.now() + 50))); };
    schedule(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [nextChangeAt, onRefresh, router]);
  return null;
}
