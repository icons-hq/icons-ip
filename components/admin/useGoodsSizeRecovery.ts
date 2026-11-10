'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createAdminLocalAutosave, EMPTY_LOCAL_AUTOSAVE_SNAPSHOT } from '@/lib/admin/local-autosave';

const FIELDS = ['sizeChartDraft'] as const;
function storage() { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } }
export function useGoodsSizeRecovery<T>({ accountId, formId, recordId, parse }: {
  accountId: string; formId: 'goods-size-chart' | 'goods-size-template'; recordId: string; parse: (value: unknown) => T | null;
}) {
  const store = useMemo(() => createAdminLocalAutosave({ scope: { accountId, formId, recordId }, fields: FIELDS, storage: storage() }), [accountId, formId, recordId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_LOCAL_AUTOSAVE_SNAPSHOT);
  useEffect(() => {
    const flush = () => store.flush();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); flush(); };
  }, [store]);
  const read = () => {
    try { return parse(JSON.parse(store.getSnapshot().recovery?.values.sizeChartDraft ?? 'null')); } catch { return null; }
  };
  return {
    recovery: snapshot.recovery ? read() : null,
    invalidRecovery: Boolean(snapshot.recovery) && !read(),
    unavailable: snapshot.unavailable,
    capture(value: T, immediately = false) { store.capture([['sizeChartDraft', JSON.stringify(value)]]); if (immediately) store.flush(); },
    restore() { const value = read(); store.restore(); return value; },
    discard: store.discard,
  };
}
