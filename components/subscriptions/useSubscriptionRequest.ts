'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createGoodsDescriptionToolScope } from '@/lib/admin/goods-description-tools';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { customerConfirm } from '@/lib/customer-confirm';
import type { SubscriptionResult } from '@/lib/subscriptions/customer';
type Failure = Extract<SubscriptionResult<unknown>, { ok: false }>;
function controller() {
  let request: { send: () => Promise<SubscriptionResult<unknown>>; accept: (value: unknown) => void } | null = null, busy = false;
  return {
    start(send: () => Promise<SubscriptionResult<unknown>>, accept: (value: unknown) => void) { if (busy || request) return false; request = { send, accept }; return true; },
    begin() { if (busy || !request) return null; busy = true; return request; },
    finish(keep: boolean) { busy = false; if (!keep) request = null; },
    clear() { request = null; busy = false; }, busy: () => busy,
  };
}
/** An unknown result keeps its original operation closure. Auth/session changes fence every late result. */
export function useSubscriptionRequest(actorId: string, onIdentityLost?: () => void) {
  const scope = useMemo(() => createGoodsDescriptionToolScope(actorId), [actorId]);
  const controllerScope = useMemo(() => ({ owner: scope, lane: controller() }), [scope]), lane = controllerScope.lane;
  const auth = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getServerSnapshot);
  const [state, setState] = useState<{ owner: typeof scope; pending: boolean; failure: Failure | null } | null>(null);
  const own = state?.owner === scope ? state : null;
  useEffect(() => {
    scope.setEnabled(true); scope.activate();
    const signout = () => { scope.authenticate(null, null); lane.clear(); onIdentityLost?.(); };
    window.addEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signout);
    const subscription = createClient().auth.onAuthStateChange((_event, session) => {
      const id = session ? inquiryDraftSessionId(session.access_token) : null;
      scope.authenticate(session?.user.id ?? null, id);
      if (scope.getSnapshot().blocked) { lane.clear(); onIdentityLost?.(); }
    }).data.subscription;
    return () => { scope.dispose(); lane.clear(); subscription.unsubscribe(); window.removeEventListener(INQUIRY_DRAFT_SIGN_OUT_EVENT, signout); };
  }, [scope, lane, onIdentityLost]);
  async function dispatch() {
    const ticket = scope.capture(); if (!ticket) return;
    const pending = lane.begin(); if (!pending) return;
    setState({ owner: scope, pending: true, failure: null });
    let result: SubscriptionResult<unknown>;
    try { result = await pending.send(); } catch { result = { ok: false, uncertain: true, error: '처리 결과가 불명확합니다. 같은 요청으로 다시 확인해주세요.' }; }
    if (!scope.canApply(ticket)) { lane.clear(); return; }
    lane.finish(!result.ok && result.uncertain === true);
    setState({ owner: scope, pending: false, failure: result.ok ? null : result });
    if (result.ok) pending.accept(result.value);
  }
  function run<T>(send: () => Promise<SubscriptionResult<T>>, accept: (value: T) => void, recovery = false) {
    if (!scope.capture() || own?.failure?.committed && !recovery || !lane.start(send, value => accept(value as T))) return;
    void dispatch();
  }
  return { run, recover: <T,>(send: () => Promise<SubscriptionResult<T>>, accept: (value: T) => void) => run(send, accept, true), retry: () => { void dispatch(); },
    isCurrent: () => Boolean(scope.capture()), pending: Boolean(own?.pending), blocked: auth.blocked, ready: auth.ready,
    failure: own?.failure ?? null, locked: !auth.ready || auth.blocked || Boolean(own?.pending || own?.failure?.uncertain || own?.failure?.committed) };
}
/**
 * 입력 중 이탈 경고. 링크 이동은 고객 공용 확인창(lib/customer-confirm.ts)으로 묻는다 — 확인창은 비동기라 먼저 이동을 멈추고,
 * 고객이 [이동하기]를 누르면 같은 링크를 다시 눌러 원래 이동(Next 링크의 화면 안 이동 포함)을 그대로 잇는다.
 * 새로고침·탭 닫기는 브라우저만 물을 수 있어 beforeunload가 맡는다.
 */
export function useSubscriptionUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let allowed: HTMLAnchorElement | null = null;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      /* 확인 뒤 다시 누른 그 링크는 그대로 보낸다. */
      if (link === allowed) { allowed = null; return; }
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault(); event.stopPropagation();
      void customerConfirm({ title: '작성 중인 정기구매 입력을 두고 이동할까요?', confirmLabel: '이동하기', cancelLabel: '계속 작성' })
        .then(confirmed => {
          if (!confirmed || !link.isConnected) return;
          /* 이미 이동을 확인했으니 전체 이동에서 브라우저가 한 번 더 묻지 않게 한다. */
          window.removeEventListener('beforeunload', unload);
          allowed = link;
          link.click();
        });
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);
}
