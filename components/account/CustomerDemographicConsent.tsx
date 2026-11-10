'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { WcButton } from '@/components/wc/WcButton';
import { DEMOGRAPHIC_API, DEMOGRAPHIC_GENDERS, DEMOGRAPHIC_GENDER_LABELS, DEMOGRAPHIC_NOTICE, isDemographicGender, parseDemographicState, type DemographicGender, type DemographicState } from '@/lib/customer-demographics';

export function CustomerDemographicConsent() {
  const [state, setState] = useState<DemographicState | null>(null);
  const [gender, setGender] = useState<DemographicGender | ''>('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const ticket = ++generation.current;
      setState(null); setGender(''); setConsent(false); setMessage(''); setPending(false); setUnavailable(false);
      try {
        const response = await fetch(DEMOGRAPHIC_API, { cache: 'no-store', credentials: 'same-origin' });
        const body = await response.json();
        if (!mounted || ticket !== generation.current) return;
        const next = parseDemographicState(body.state);
        if (!response.ok || body.state !== null && !next) { setUnavailable(true); return; }
        setState(next); setGender(next?.gender ?? '');
      } catch { if (mounted && ticket === generation.current) setUnavailable(true); }
    }
    void refresh();
    const { data: { subscription } } = createClient().auth.onAuthStateChange(() => { void refresh(); });
    return () => { mounted = false; generation.current += 1; subscription.unsubscribe(); };
  }, []);
  async function save(choice: 'accepted' | 'declined') {
    if (!state || pending || choice === 'accepted' && (!consent || !isDemographicGender(gender))) return;
    const current = state; const ticket = ++generation.current; const selected = choice === 'accepted' ? gender : null;
    setPending(true); setMessage('');
    try {
      const response = await fetch(DEMOGRAPHIC_API, { method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice, gender: selected, consent: choice === 'accepted',
          identity: { actorId: current.actorId, sessionId: current.sessionId, revision: current.revision } }) });
      const body = await response.json(); if (ticket !== generation.current) return;
      const next = parseDemographicState(body.state);
      if (!response.ok || !next || next.actorId !== current.actorId || next.sessionId !== current.sessionId || next.choice !== choice || next.gender !== selected) throw new Error('unconfirmed');
      setState(next); setGender(next.gender ?? ''); setConsent(false);
      setMessage(choice === 'accepted' ? '선택 동의와 성별 정보를 저장했습니다.' : '선택 동의를 철회하고 성별 정보를 삭제했습니다.');
    } catch {
      if (ticket !== generation.current) return;
      try {
        const read = await fetch(DEMOGRAPHIC_API, { cache: 'no-store', credentials: 'same-origin' });
        const next = parseDemographicState((await read.json()).state);
        if (ticket !== generation.current) return;
        if (read.ok && next?.actorId === current.actorId && next.sessionId === current.sessionId) { setState(next); setGender(next.gender ?? ''); }
        else setState(null);
      } catch { if (ticket === generation.current) setState(null); }
      if (ticket === generation.current) { setConsent(false); setMessage('저장 응답을 확인하지 못했습니다. 현재 선택을 확인한 뒤 다시 저장하거나 새로고침해주세요.'); }
    } finally { if (ticket === generation.current) setPending(false); }
  }
  if (!state && !unavailable && !message) return null;
  return <section className="wc-mypage__form" aria-labelledby="customer-demographic-title">
    <h2 className="wc-mypage__subtitle" id="customer-demographic-title">{DEMOGRAPHIC_NOTICE.title} <small>선택</small></h2>
    <p>{DEMOGRAPHIC_NOTICE.purpose}</p>
    <details><summary>수집 항목·보관·철회 안내</summary><p>{DEMOGRAPHIC_NOTICE.collected}</p><p>{DEMOGRAPHIC_NOTICE.retention}</p><p>{DEMOGRAPHIC_NOTICE.choice}</p></details>
    {unavailable ? <p role="status">선택 정보를 읽지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {state ? <>
      <p>현재 선택: <strong>{state.choice === 'accepted' ? `동의 · ${DEMOGRAPHIC_GENDER_LABELS[state.gender!]}` : state.choice === 'declined' ? '거부' : '미선택'}</strong></p>
      <label className="wc-mypage__field">성별<select aria-label="통계용 성별" value={gender} disabled={pending} onChange={event => { setGender(isDemographicGender(event.target.value) ? event.target.value : ''); setConsent(false); }}>
        <option value="">선택해주세요</option>{DEMOGRAPHIC_GENDERS.map(value => <option key={value} value={value}>{DEMOGRAPHIC_GENDER_LABELS[value]}</option>)}
      </select></label>
      <label className="wc-mypage__check"><input type="checkbox" checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)} />위 안내에 따라 성별 정보를 수집·이용하는 데 동의합니다. (선택)</label>
      <div className="wc-mypage__form-actions"><WcButton disabled={pending} onClick={() => void save('declined')}>{state.choice === 'accepted' ? '동의 철회·성별 삭제' : '거부'}</WcButton>
        <WcButton variant="primary" disabled={pending || !consent || !gender} onClick={() => void save('accepted')}>{pending ? '저장 중…' : '동의하고 저장'}</WcButton></div>
    </> : null}
  </section>;
}
