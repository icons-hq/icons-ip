'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  analyticsAcquisition, analyticsCookieNames, analyticsPage, STORE_ANALYTICS_API, STORE_ANALYTICS_CHOICE_KEY,
  STORE_ANALYTICS_NOTICE_VERSION, type AnalyticsChoice, type AnalyticsEvent,
} from '@/lib/store-analytics';
import { STORE_ANALYTICS_NOTICE } from '@/lib/store-analytics-notice';
import { enqueueStoreAnalytics, releaseShellNoticeImpressions, setStoreAnalyticsCollecting } from '@/lib/store-analytics-client';

type State = { enabled: boolean; choice: AnalyticsChoice; usable: boolean; needsRevocation?: boolean };
function localChoice(): AnalyticsChoice {
  try { const value = localStorage.getItem(STORE_ANALYTICS_CHOICE_KEY); return value === 'accepted' || value === 'declined' ? value : 'unset'; } catch { return 'unset'; }
}
function saveChoice(choice: AnalyticsChoice) {
  try { localStorage.setItem(STORE_ANALYTICS_CHOICE_KEY, choice); } catch { /* Cookie remains the authoritative server preference. */ }
  if (choice === 'declined') {
    const secure = process.env.NODE_ENV === 'production';
    document.cookie = `${analyticsCookieNames(secure).choice}=${STORE_ANALYTICS_NOTICE_VERSION}:no; Path=/; Max-Age=15552000; SameSite=Lax${secure ? '; Secure' : ''}`;
  }
}
async function post(body: unknown) {
  const response = await fetch(STORE_ANALYTICS_API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json() as Promise<{ ok: boolean; code?: string; created?: boolean }>;
}

/** Visible public navigation only. Prefetches and private routes never emit events.
 * 셸 공지 노출·클릭(ShellNotices)과 같은 전송 줄(enqueueStoreAnalytics)을 쓰고, 확인한 동의·수집 상태를
 * setStoreAnalyticsCollecting으로 알린다. 한 화면의 페이지뷰가 기록되면 그 화면에서 상태 확인 전·동의 전에 보여
 * 보류된 공지 노출을 releaseShellNoticeImpressions로 같은 세션에 보낸다(하드 로드에서는 셸 공지가 이 컴포넌트보다
 * 먼저 하이드레이트돼 노출이 상태 확인보다 앞설 수 있다). */
export function StoreAnalytics() {
  const pathname = usePathname(); const search = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = useRef<{ signature: string; path: string; event: AnalyticsEvent } | null>(null);
  const choiceGeneration = useRef(0);
  const hasNavigated = useRef(false);
  const currentChoice = useRef<AnalyticsChoice>('unset');
  const params = new URLSearchParams(search.toString());
  const page = analyticsPage(pathname, params);
  const signature = page ? `${page.kind}:${page.target}:${page.linkToken || ''}:${analyticsAcquisition(params, '', '', false).source}:${analyticsAcquisition(params, '', '', false).medium}` : '';

  useEffect(() => {
    const handle = (event: StorageEvent) => {
      if (event.key !== STORE_ANALYTICS_CHOICE_KEY) return;
      if (event.newValue === 'declined') {
        choiceGeneration.current += 1; currentChoice.current = 'declined'; saveChoice('declined'); setBusy(false); setStoreAnalyticsCollecting(false);
        setState(value => value ? { ...value, choice: 'declined', usable: false } : value);
        enqueueStoreAnalytics(async () => { await post({ action: 'decline' }); });
      }
    };
    window.addEventListener('storage', handle); return () => window.removeEventListener('storage', handle);
  }, []);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (!signature) { entry.current = null; hasNavigated.current = true; return; }
    const parameters = new URLSearchParams(window.location.search);
    const target = analyticsPage(window.location.pathname, parameters); if (!target) return;
    if (entry.current?.signature !== signature) {
      entry.current = { signature, path: window.location.pathname, event: { eventId: crypto.randomUUID(), pageKind: target.kind, targetId: target.target, linkToken: target.linkToken,
        ...analyticsAcquisition(parameters, document.referrer, window.location.origin, hasNavigated.current) } };
    }
    hasNavigated.current = true;
    const event = entry.current.event;
    const path = entry.current.path;
    const collect = () => enqueueStoreAnalytics(async () => {
      if (document.visibilityState !== 'visible') return;
      const generation = choiceGeneration.current;
      const response = await fetch(STORE_ANALYTICS_API, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json() as State;
      if (generation !== choiceGeneration.current) return;
      if (localChoice() === 'declined' && next.choice !== 'declined') {
        currentChoice.current = 'declined'; setStoreAnalyticsCollecting(false); saveChoice('declined'); await post({ action: 'decline' });
        setState({ ...next, choice: 'declined', usable: false }); return;
      }
      currentChoice.current = next.choice; setState(next);
      setStoreAnalyticsCollecting(next.enabled && next.choice === 'accepted' && !next.needsRevocation);
      if (next.needsRevocation) { await post({ action: 'decline' }); return; }
      if (!next.enabled || next.choice !== 'accepted') return;
      let measurement = entry.current?.signature === signature ? entry.current.event : event;
      if (!next.usable) {
        const accepted = await post({ action: 'accept' }); if (!accepted.ok) return;
        if (accepted.created) { measurement = { ...measurement, eventId: crypto.randomUUID() }; if (entry.current?.signature === signature) entry.current.event = measurement; }
      }
      if (generation !== choiceGeneration.current || currentChoice.current !== 'accepted' || localChoice() === 'declined') return;
      const result = await post({ action: 'record', event: measurement });
      if (result.ok) { releaseShellNoticeImpressions(path); return; }
      if (result.code === 'session_expired' && currentChoice.current === 'accepted' && localChoice() !== 'declined') {
        const accepted = await post({ action: 'accept' });
        if (accepted.ok && generation === choiceGeneration.current) {
          if (accepted.created) { measurement = { ...measurement, eventId: crypto.randomUUID() }; if (entry.current?.signature === signature) entry.current.event = measurement; }
          if ((await post({ action: 'record', event: measurement })).ok) releaseShellNoticeImpressions(path);
        }
      }
    });
    if (document.visibilityState === 'visible') collect();
    else document.addEventListener('visibilitychange', collect, { once: true });
    return () => document.removeEventListener('visibilitychange', collect);
  }, [signature]);

  function choose(choice: 'accepted' | 'declined') {
    const generation = ++choiceGeneration.current;
    currentChoice.current = choice; setBusy(true); setMessage('');
    if (choice === 'declined') { setStoreAnalyticsCollecting(false); saveChoice(choice); setState(value => value ? { ...value, choice, usable: false } : value); }
    enqueueStoreAnalytics(async () => {
      try {
        const result = await post({ action: choice === 'accepted' ? 'accept' : 'decline' });
        if (generation !== choiceGeneration.current) return;
        if (!result.ok) { setMessage(choice === 'declined' ? '추가 수집은 중단했습니다. 기존 방문 기록 삭제를 완료하지 못해 다시 시도해야 합니다.' : '선택을 저장하지 못했습니다. 다시 시도해주세요.'); return; }
        saveChoice(choice); setState(value => value ? { ...value, choice, usable: choice === 'accepted' } : value);
        setStoreAnalyticsCollecting(choice === 'accepted');
        setOpen(false); setMessage('');
        const view = entry.current;
        if (choice === 'accepted' && view && currentChoice.current === 'accepted') {
          if (result.created) view.event = { ...view.event, eventId: crypto.randomUUID() };
          /* 동의한 화면의 페이지뷰와 함께, 동의 전에 그 화면에서 보인 공지 노출도 남긴다. */
          if ((await post({ action: 'record', event: view.event })).ok) releaseShellNoticeImpressions(view.path);
        }
      } catch { setMessage('선택 저장 상태를 확인하지 못했습니다. 다시 시도해주세요.'); }
      finally { if (generation === choiceGeneration.current) setBusy(false); }
    });
  }

  if (!page || !state || (!state.enabled && state.choice === 'unset')) return null;
  return <div className="wc-root wc-store-analytics">
    {state.enabled && state.choice === 'unset' ? <aside className="wc-store-analytics-banner" aria-label="선택 방문 통계">
      <p><strong>방문 통계에 참여하시겠어요?</strong><span>공개 화면의 이용과 구매 전환을 방문 세션 단위로 분석합니다. 거부해도 쇼핑할 수 있습니다.</span></p>
      <button type="button" onClick={() => setOpen(true)}>안내·설정</button>
      <button type="button" disabled={busy} onClick={() => choose('declined')}>거부</button>
      <button type="button" disabled={busy} onClick={() => choose('accepted')}>동의</button>
    </aside> : <button className="wc-store-analytics-settings" type="button" onClick={() => setOpen(true)}>방문 통계 설정</button>}
    {message && !open ? <p className="wc-store-analytics-message" role="status">{message}</p> : null}
    <dialog ref={dialog} className="wc-store-analytics-dialog" aria-labelledby="analytics-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header><h2 id="analytics-title">{STORE_ANALYTICS_NOTICE.title}</h2><button type="button" aria-label="방문 통계 설정 닫기" onClick={() => setOpen(false)}>닫기</button></header>
      <p>{STORE_ANALYTICS_NOTICE.summary}</p>
      {STORE_ANALYTICS_NOTICE.sections.map(section => <section key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}
      <p>현재 선택: {state.choice === 'accepted' ? '동의' : state.choice === 'declined' ? '거부' : '미선택'}</p>
      {message ? <p role="status">{message}</p> : null}
      <footer><button type="button" disabled={busy} onClick={() => choose('declined')}>{state.choice === 'accepted' ? '동의 철회' : '거부'}</button><button type="button" disabled={busy || !state.enabled} onClick={() => choose('accepted')}>동의</button></footer>
    </dialog>
  </div>;
}
