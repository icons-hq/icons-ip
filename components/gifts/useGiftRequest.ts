'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import type { GiftFailure } from '@/lib/gifts';

/** A mutation retains its exact closure/operation identity after an unknown
 * response. Authentication changes immediately discard both request and UI. */
export function useGiftRequest(actorId: string, onIdentityLost?: () => void) {
  const [ready, setReady] = useState(false), [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [failure, setFailure] = useState<GiftFailure | null>(null);
  const current = useRef<{ send: () => Promise<object | GiftFailure>; accept: (value: object) => void } | null>(null);
  const readyRef = useRef(false), alive = useRef(true), blockedRef = useRef(false), sessionId = useRef<string | null>(null), pendingRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    const listener = createClient().auth.onAuthStateChange((_event, session) => {
      const nextSession = session ? inquiryDraftSessionId(session.access_token) : null;
      if (session?.user.id !== actorId || !nextSession || sessionId.current !== null && nextSession !== sessionId.current) {
        blockedRef.current = true; current.current = null; setBlocked(true); setPending(false); onIdentityLost?.(); return;
      }
      sessionId.current ??= nextSession; readyRef.current = true; setReady(true);
    }).data.subscription;
    return () => { alive.current = false; current.current = null; listener.unsubscribe(); };
  }, [actorId, onIdentityLost]);
  async function dispatch() {
    const request = current.current; if (!request || pendingRef.current || blockedRef.current) return;
    pendingRef.current = true; setPending(true); setFailure(null);
    let result: object | GiftFailure;
    try { result = await request.send(); } catch { result = { error: '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    pendingRef.current = false;
    if (!alive.current || blockedRef.current) return;
    setPending(false);
    if ('error' in result) { setFailure(result as GiftFailure); if (!(result as GiftFailure).uncertain) current.current = null; return; }
    current.current = null; request.accept(result);
  }
  function run<T extends object>(send: () => Promise<T | GiftFailure>, accept: (value: T) => void, recovery = false) {
    if (!readyRef.current || pendingRef.current || blockedRef.current || current.current || failure?.conflict && !recovery) return;
    current.current = { send, accept: value => accept(value as T) }; void dispatch();
  }
  function clear() { if (pendingRef.current || current.current || blockedRef.current) return; setFailure(null); }
  return { run, recover: <T extends object>(send: () => Promise<T | GiftFailure>, accept: (value: T) => void) => run(send, accept, true), retry: () => { void dispatch(); }, clear, pending, blocked, failure, locked: !ready || pending || blocked || Boolean(failure?.uncertain || failure?.conflict) };
}

export function useGiftUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      if (!confirm('작성 중인 내용을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty]);
}
