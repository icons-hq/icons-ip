'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { analyticsPage } from '@/lib/store-analytics';
import { MEMBER_ACTIVITY_API, MEMBER_ACTIVITY_CHANGED, memberActivityIdentity, parseMemberActivityState, type MemberActivityEvent, type MemberActivityState } from '@/lib/member-activity';

/** Only visible, authenticated public-page observations. No anonymous session id. */
export function MemberActivity() {
  const pathname = usePathname(), search = useSearchParams();
  const page = analyticsPage(pathname, new URLSearchParams(search.toString()));
  const kind = page?.kind ?? null, target = page?.target ?? null;
  const state = useRef<MemberActivityState | null>(null), generation = useRef(0), locallyStopped = useRef(false);
  useEffect(() => {
    state.current = null; const ticket = ++generation.current;
    if (!kind || !target) return;
    const eventId = crypto.randomUUID(); let disposed = false, sentFor = '';
    const stopped = (value: MemberActivityState) => { try { return locallyStopped.current || localStorage.getItem(`icons:member-activity-stop:${value.actorId}`) === '1'; } catch { return locallyStopped.current; } };
    async function record(event: MemberActivityEvent, current: MemberActivityState) {
      if (disposed || document.visibilityState !== 'visible' || !current.enabled || current.choice !== 'accepted' || stopped(current)) return;
      try { await fetch(MEMBER_ACTIVITY_API, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record', identity: memberActivityIdentity(current), event }) }); } catch { /* Collection cannot interrupt shopping. */ }
    }
    async function refresh() {
      if (disposed || document.visibilityState !== 'visible') return;
      const attempt = ++generation.current;
      try {
        const response = await fetch(MEMBER_ACTIVITY_API, { credentials: 'same-origin', cache: 'no-store' }); const next = parseMemberActivityState((await response.json()).state);
        if (disposed || attempt !== generation.current || !response.ok) return;
        state.current = next;
        if (!next || !next.enabled || next.choice !== 'accepted' || stopped(next)) return;
        const signature = `${next.actorId}:${next.sessionId}:${next.revision}`;
        if (sentFor === signature) return; sentFor = signature;
        await record({ eventId, kind: 'visit', pageKind: kind!, targetId: target!, assetId: null }, next);
      } catch { /* Optional collection is fail-closed. */ }
    }
    function changed(event: Event) {
      locallyStopped.current = (event as CustomEvent<{ stop?: boolean }>).detail?.stop === true;
      state.current = null; generation.current += 1;
      if (!locallyStopped.current) void refresh();
    }
    function storage(event: StorageEvent) { if (event.key?.startsWith('icons:member-activity-stop:')) { state.current = null; generation.current += 1; void refresh(); } }
    function video(event: Event) {
      const element = event.target;
      if (!(element instanceof HTMLVideoElement) || element.dataset.memberActivityActive !== 'true' || !element.dataset.memberActivityAsset || kind !== 'good') return;
      const current = state.current; if (!current) return;
      void record({ eventId: crypto.randomUUID(), kind: event.type === 'ended' ? 'video_completed' : 'video_started', pageKind: 'good', targetId: target!, assetId: element.dataset.memberActivityAsset }, current);
    }
    const { data: { subscription } } = createClient().auth.onAuthStateChange(() => { state.current = null; generation.current += 1; locallyStopped.current = false; void refresh(); });
    if (ticket === generation.current) void refresh();
    document.addEventListener('visibilitychange', refresh); document.addEventListener('play', video, true); document.addEventListener('ended', video, true);
    window.addEventListener(MEMBER_ACTIVITY_CHANGED, changed); window.addEventListener('storage', storage);
    return () => { disposed = true; generation.current += 1; state.current = null; subscription.unsubscribe();
      document.removeEventListener('visibilitychange', refresh); document.removeEventListener('play', video, true); document.removeEventListener('ended', video, true);
      window.removeEventListener(MEMBER_ACTIVITY_CHANGED, changed); window.removeEventListener('storage', storage); };
  }, [kind, target]);
  return null;
}
