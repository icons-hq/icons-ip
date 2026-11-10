'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createInquiryDraftStore, EMPTY_INQUIRY_DRAFT, inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';

/* Supabase가 없는 환경(시각 fixture·로컬 미리보기)에는 인증 이벤트가 오지 않는다. 그 탭 안에서만
   쓰는 고정 식별자로 초안 보관소를 열어, 답변 입력이 이유 없이 영원히 잠기지 않게 한다(R4).
   운영(Supabase 설정됨)에서는 이 경로를 타지 않는다. */
const LOCAL_PREVIEW_ACCOUNT = 'local-preview';
const LOCAL_PREVIEW_SESSION = '00000000-0000-4000-8000-000000000000';

export function useInquiryDraft(accountId: string, inquiryId: string, field: 'reply' | 'note', resultKey?: string) {
  const configured = getSupabaseConfig().isConfigured;
  const storeAccount = configured ? accountId : accountId || LOCAL_PREVIEW_ACCOUNT;
  const store = useMemo(() => {
    let storage: Storage | null = null;
    try { if (typeof window !== 'undefined') storage = window.sessionStorage; } catch { /* In-memory editing remains usable. */ }
    return createInquiryDraftStore({ accountId: storeAccount, inquiryId, field, storage });
  }, [storeAccount, inquiryId, field]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_INQUIRY_DRAFT);
  useEffect(() => {
    if (!configured) {
      store.authenticate(storeAccount, LOCAL_PREVIEW_SESSION);
      return;
    }
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      store.authenticate(session?.user.id ?? null, session ? inquiryDraftSessionId(session.access_token) : null);
    });
    const signOut = () => store.authenticate(null, null);
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut);
    return () => { data.subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signOut); };
  }, [configured, store, storeAccount]);
  useEffect(() => { if (resultKey) store.discard(); }, [resultKey, store]);
  return { ...snapshot, change: store.change, restore: store.restore, discard: store.discard };
}
