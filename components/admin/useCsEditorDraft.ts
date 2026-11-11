'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createCsEditorDraftStore } from '@/lib/admin/cs-editor-drafts';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

/* Supabase가 없는 환경(시각 fixture·로컬 미리보기)에는 인증 이벤트가 오지 않는다. useInquiryDraft(R4)와
   같게 그 탭 안에서만 쓰는 고정 식별자로 보관소를 열어, 답변 템플릿 창이 이유 없이 영원히 잠기지 않게 한다.
   운영(Supabase 설정됨)에서는 이 경로를 타지 않는다. */
const LOCAL_PREVIEW_ACCOUNT = 'local-preview';
const LOCAL_PREVIEW_SESSION = '00000000-0000-4000-8000-000000000000';

/** Subscribe only while an editor is open; a result table can contain 100 closed rows. */
export function useCsEditorDraft<T>({ accountId, scope, recordId, parse, retainUntilResolved, enabled = true }: {
  accountId: string; scope: string; recordId: string; parse: (value: unknown) => T | null; retainUntilResolved?: (value: T) => boolean; enabled?: boolean;
}) {
  const configured = getSupabaseConfig().isConfigured;
  const storeAccount = configured ? accountId : accountId || LOCAL_PREVIEW_ACCOUNT;
  const store = useMemo(() => {
    let storage: Storage | null = null;
    try { if (typeof window !== 'undefined') storage = window.sessionStorage; } catch { /* Editing remains usable. */ }
    return createCsEditorDraftStore({ accountId: storeAccount, scope, recordId, storage, parse, retainUntilResolved });
  }, [storeAccount, scope, recordId, parse, retainUntilResolved]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    const signOut = () => store.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    return () => window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
  }, [store]);
  useEffect(() => {
    if (!enabled) return;
    if (!configured) {
      store.authenticate(storeAccount, LOCAL_PREVIEW_SESSION);
      return;
    }
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      store.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    });
    return () => data.subscription.unsubscribe();
  }, [configured, enabled, store, storeAccount]);
  return { ...snapshot, change: store.change, restore: store.restore, discard: store.discard, isActive: store.isActive, getCurrentSnapshot: store.getSnapshot };
}
