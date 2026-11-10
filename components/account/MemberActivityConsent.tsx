'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { WcButton } from '@/components/wc/WcButton';
import { MEMBER_ACTIVITY_API, MEMBER_ACTIVITY_CHANGED, MEMBER_ACTIVITY_NOTICE, memberActivityIdentity, parseMemberActivityState, type MemberActivityState } from '@/lib/member-activity';

export function MemberActivityConsent() {
  const [state, setState] = useState<MemberActivityState | null>(null), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const ticket = ++generation.current; setState(null); setPending(false);
      try { const response = await fetch(MEMBER_ACTIVITY_API, { cache: 'no-store', credentials: 'same-origin' }); const body = await response.json();
        if (mounted && ticket === generation.current && response.ok) setState(parseMemberActivityState(body.state));
      } catch { /* Optional preferences never block the account screen. */ }
    }
    void refresh();
    const { data: { subscription } } = createClient().auth.onAuthStateChange(() => { void refresh(); });
    return () => { mounted = false; generation.current += 1; subscription.unsubscribe(); };
  }, []);
  async function choose(choice: 'accepted' | 'declined') {
    if (!state || pending) return;
    const current = state, ticket = ++generation.current; setPending(true); setMessage('');
    if (choice === 'declined') {
      try { localStorage.setItem(`icons:member-activity-stop:${current.actorId}`, '1'); } catch { /* Current tab still stops immediately. */ }
      window.dispatchEvent(new CustomEvent(MEMBER_ACTIVITY_CHANGED, { detail: { stop: true } }));
    }
    try {
      const response = await fetch(MEMBER_ACTIVITY_API, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: choice === 'accepted' ? 'accept' : 'decline', identity: memberActivityIdentity(current) }) });
      const body = await response.json();
      if (ticket !== generation.current) return;
      const saved = parseMemberActivityState(body.state);
      if (!response.ok || !saved || saved.actorId !== current.actorId || saved.sessionId !== current.sessionId || saved.choice !== choice) {
        const read = await fetch(MEMBER_ACTIVITY_API, { credentials: 'same-origin', cache: 'no-store' }); const next = parseMemberActivityState((await read.json()).state);
        if (ticket !== generation.current) return;
        if (read.ok && next?.actorId === current.actorId && next.sessionId === current.sessionId) setState(next);
        setMessage(choice === 'declined' ? '이 브라우저의 수집은 중단했습니다. 서버의 동의 철회·기록 삭제를 확인하지 못했습니다. 현재 상태를 확인한 뒤 다시 철회해주세요.' : '동의 저장을 확인하지 못했습니다. 현재 상태를 확인한 뒤 다시 선택해주세요.'); return;
      }
      setState(saved);
      if (choice === 'accepted') { try { localStorage.removeItem(`icons:member-activity-stop:${current.actorId}`); } catch { /* The server is authoritative. */ } }
      window.dispatchEvent(new CustomEvent(MEMBER_ACTIVITY_CHANGED, { detail: { stop: choice === 'declined' } }));
      setMessage(choice === 'accepted' ? '회원 방문·영상 분석에 동의했습니다.' : '동의를 철회하고 회원에게 연결된 이용 기록을 삭제했습니다.');
    } catch { if (ticket === generation.current) setMessage(choice === 'declined' ? '수집은 중단했습니다. 서버의 기록 삭제 결과를 확인하지 못해 다시 철회해야 합니다.' : '선택을 저장하지 못했습니다. 다시 시도해주세요.'); }
    finally { if (ticket === generation.current) setPending(false); }
  }
  if (!state) return null;
  return <section className="wc-mypage__form" aria-labelledby="member-activity-title">
    <h2 className="wc-mypage__subtitle" id="member-activity-title">{MEMBER_ACTIVITY_NOTICE.title} <small>선택</small></h2>
    <p>{MEMBER_ACTIVITY_NOTICE.summary}</p><details><summary>수집 항목·보관·철회 안내</summary><p>{MEMBER_ACTIVITY_NOTICE.collected}</p><p>{MEMBER_ACTIVITY_NOTICE.retention}</p><p>{MEMBER_ACTIVITY_NOTICE.choice}</p></details>
    <p>현재 선택: <strong>{state.choice === 'accepted' ? '동의' : state.choice === 'declined' ? '거부' : '미선택'}</strong>{!state.enabled ? ' · 현재 수집 기능이 꺼져 있습니다.' : ''}</p>
    {message ? <p role="status">{message}</p> : null}
    <div className="wc-mypage__form-actions"><WcButton disabled={pending} onClick={() => void choose('declined')}>{state.choice === 'accepted' ? '동의 철회·기록 삭제' : '거부'}</WcButton>
      <WcButton variant="primary" disabled={pending || !state.enabled || state.choice === 'accepted'} onClick={() => void choose('accepted')}>동의</WcButton></div>
  </section>;
}
