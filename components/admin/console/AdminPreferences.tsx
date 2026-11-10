'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { gridPreferencesStorageKey, parseGridPreferences, type GridPreferenceColumn, type GridPreferences } from '@/lib/admin/grid-preferences';

const AccountContext = createContext<string | null>(null);
const memory = new Map<string, string>();
const CHANGE_EVENT = 'icons-admin-grid-change';

export function AdminPreferencesProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  return <AccountContext.Provider value={accountId}>{children}</AccountContext.Provider>;
}

export function useGridPreferences(gridKey: string, columns: readonly GridPreferenceColumn[]) {
  const accountId = useContext(AccountContext);
  const storageKey = gridPreferencesStorageKey(accountId ?? 'session', gridKey);
  const read = useCallback(() => {
    if (accountId) {
      try { return window.localStorage.getItem(storageKey) ?? memory.get(storageKey) ?? ''; } catch { /* Fall back to this session. */ }
    }
    return memory.get(storageKey) ?? '';
  }, [accountId, storageKey]);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener('storage', notify);
    window.addEventListener(CHANGE_EVENT, notify);
    return () => {
      window.removeEventListener('storage', notify);
      window.removeEventListener(CHANGE_EVENT, notify);
    };
  }, []);
  const raw = useSyncExternalStore(subscribe, read, () => '');
  const preferences = useMemo(() => parseGridPreferences(raw, columns), [columns, raw]);
  const save = useCallback((next: GridPreferences) => {
    const serialized = JSON.stringify(next);
    memory.set(storageKey, serialized);
    let persisted = false;
    if (accountId) {
      try { window.localStorage.setItem(storageKey, serialized); persisted = true; } catch { /* Keep usable in memory. */ }
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return persisted;
  }, [accountId, storageKey]);
  return { preferences, save };
}
