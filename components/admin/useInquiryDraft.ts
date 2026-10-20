'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createInquiryDraftStore, EMPTY_INQUIRY_DRAFT, inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';

export function useInquiryDraft(accountId: string, inquiryId: string, field: 'reply' | 'note', resultKey?: string) {
  const store = useMemo(() => {
    let storage: Storage | null = null;
    try { if (typeof window !== 'undefined') storage = window.sessionStorage; } catch { /* In-memory editing remains usable. */ }
    return createInquiryDraftStore({ accountId, inquiryId, field, storage });
  }, [accountId, inquiryId, field]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_INQUIRY_DRAFT);
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      store.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    });
    const signOut = () => store.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    return () => { data.subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [store]);
  useEffect(() => { if (resultKey) store.discard(); }, [resultKey, store]);
  return { ...snapshot, change: store.change, restore: store.restore, discard: store.discard };
}
