'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createCsEditorDraftStore } from '@/lib/admin/cs-editor-drafts';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

/** Subscribe only while an editor is open; a result table can contain 100 closed rows. */
export function useCsEditorDraft<T>({ accountId, scope, recordId, parse, retainUntilResolved, enabled = true }: {
  accountId: string; scope: string; recordId: string; parse: (value: unknown) => T | null; retainUntilResolved?: (value: T) => boolean; enabled?: boolean;
}) {
  const store = useMemo(() => {
    let storage: Storage | null = null;
    try { if (typeof window !== 'undefined') storage = window.sessionStorage; } catch { /* Editing remains usable. */ }
    return createCsEditorDraftStore({ accountId, scope, recordId, storage, parse, retainUntilResolved });
  }, [accountId, scope, recordId, parse, retainUntilResolved]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    const signOut = () => store.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    return () => window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
  }, [store]);
  useEffect(() => {
    if (!enabled || !getSupabaseConfig().isConfigured) return;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      store.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    });
    return () => data.subscription.unsubscribe();
  }, [enabled, store]);
  return { ...snapshot, change: store.change, restore: store.restore, discard: store.discard, isActive: store.isActive, getCurrentSnapshot: store.getSnapshot };
}
