'use client';

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { parseClaimContactContract, parseClaimContactJournal } from '@/lib/claim-contact/contracts';

export type ClaimContactIdentity = { actorId: string; sessionId: string };
export type ClaimContactScope = ReturnType<typeof createGoodsDescriptionToolScope>;
export const CLAIM_CONTACT_JOURNAL_PREFIX = 'icons:claim-contact:v1:';

function discardJournals(identity: ClaimContactIdentity | null) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(CLAIM_CONTACT_JOURNAL_PREFIX)) continue;
      let sameIdentity = false;
      if (identity) {
        try {
          const journal = parseClaimContactJournal(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
          sameIdentity = journal?.actorId === identity.actorId && journal?.sessionId === identity.sessionId;
        } catch { /* Invalid journal is discarded, never recovered as raw input. */ }
      }
      if (!sameIdentity) sessionStorage.removeItem(key);
    }
  } catch { /* A blocked store must not prevent the in-memory privacy boundary. */ }
}

/** Browser session IDs isolate UI state only; the server independently authenticates every request. */
export function ClaimContactSession({ actorId, children, pendingMessage }: {
  actorId: string;
  pendingMessage?: string;
  children: (identity: ClaimContactIdentity, scope: ClaimContactScope) => ReactNode;
}) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(actorId), [actorId]);
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [session, setSession] = useState<{ scope: ClaimContactScope; id: string } | null>(null);
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const stopPrivacyObserver = scope.subscribe(() => {
      if (scope.getSnapshot().blocked) { discardJournals(null); setSession(null); }
    });
    const lost = () => { scope.authenticate(null, null); discardJournals(null); setSession(null); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, lost);
    let unsubscribe: (() => void) | undefined;
    try {
      const subscription = createClient().auth.onAuthStateChange((_event, next) => {
        const id = next ? parseClaimContactContract('Uuid', inquiryDraftSessionId(next.access_token)) : null;
        scope.authenticate(next?.user.id ?? null, id);
        if (scope.getSnapshot().blocked || !id) { discardJournals(null); setSession(null); }
        else {
          discardJournals({ actorId, sessionId: id });
          setSession(previous => previous?.scope === scope && previous.id === id ? previous : { scope, id });
        }
      }).data.subscription;
      unsubscribe = () => subscription.unsubscribe();
    } catch { lost(); }
    return () => { scope.dispose(); stopPrivacyObserver(); unsubscribe?.(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, lost); };
  }, [actorId, scope]);
  const identity = useMemo(() => session?.scope === scope ? { actorId, sessionId: session.id } : null, [actorId, scope, session]);
  if (!auth.ready) return <p role="status">{pendingMessage ?? '연락처 정보를 확인하기 위해 로그인 상태를 확인하고 있습니다.'}</p>;
  if (auth.blocked || !identity) return <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.</p>;
  return <Fragment key={`${identity.actorId}:${identity.sessionId}:${auth.epoch}`}>{children(identity, scope)}</Fragment>;
}
