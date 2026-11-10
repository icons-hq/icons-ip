'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { acceptOperatorInvitationAction, readMyOperatorInvitationAction } from '@/app/manager-invitation/actions';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import { OPERATOR_DUTIES } from '@/lib/admin/operator-directory';
import { OPERATOR_INVITATION_PATH, type MyOperatorInvitation } from '@/lib/admin/operator-invitations';
import '@/app/styles/manager-invitation.css';

const STORAGE_KEY = 'icons:manager-invitation';
function clearInvitationToken() { try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ } }
function captureInvitationToken(): string | null {
  const fragment = window.location.hash;
  // Remove the fragment before rendering auth links or making any request.
  if (fragment) window.history.replaceState(window.history.state, '', OPERATOR_INVITATION_PATH);
  const incoming = fragment ? new URLSearchParams(fragment.slice(1)).get('token') : null;
  if (fragment) {
    const token = incoming && /^[A-Za-z0-9_-]{43}$/.test(incoming) ? incoming : null;
    try { if (token) window.sessionStorage.setItem(STORAGE_KEY, token); else window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* The current page still holds the token if storage is unavailable. */ }
    return token;
  }
  try { const token = window.sessionStorage.getItem(STORAGE_KEY); return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null; } catch { return null; }
}
export function ManagerInvitation({ signedIn }: { signedIn: boolean }) {
  const token = useRef<string | null>(null); const operation = useRef<string | null>(null);
  const [ready, setReady] = useState(false); const [data, setData] = useState<MyOperatorInvitation | null>(null); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [uncertain, setUncertain] = useState(false); const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true; token.current = token.current ?? captureInvitationToken();
    async function load() {
      if (!token.current) { if (active) { setData({ status: 'unavailable' }); setReady(true); } return; }
      if (!signedIn) { if (active) setReady(true); return; }
      try { const result = await readMyOperatorInvitationAction(token.current); if (!active) return; if ('error' in result) setError(result.error); else { setData(result.data); if (result.data.status === 'accepted') { token.current = null; clearInvitationToken(); } } }
      catch { if (active) setError('초대 정보를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.'); }
      finally { if (active) setReady(true); }
    }
    void load(); return () => { active = false; };
  }, [signedIn]);
  async function accept() {
    if (!token.current || pending || (!confirmed && !uncertain)) return;
    setPending(true); setError(''); operation.current ??= crypto.randomUUID();
    try {
      const result = await acceptOperatorInvitationAction(token.current, operation.current);
      if ('error' in result) { setError(result.error); setUncertain(Boolean(result.uncertain)); if (!result.uncertain) operation.current = null; return; }
      setData(result.data); setUncertain(false);
      if (result.data.status === 'accepted') { token.current = null; clearInvitationToken(); }
    } catch { setError('수락 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.'); setUncertain(true); }
    finally { setPending(false); }
  }
  const login = `/login?next=${encodeURIComponent(OPERATOR_INVITATION_PATH)}`;
  return <main className="wc-manager-invitation"><section><Link href="/" className="wc-manager-invitation__brand">ICONS</Link><p className="wc-manager-invitation__eyebrow">MANAGER INVITATION</p><h1>매니저 초대</h1>
    {!ready ? <p role="status">초대를 확인하고 있습니다.</p> : data?.status === 'unavailable' ? <><h2>이 초대를 사용할 수 없습니다</h2><p>초대받은 이메일과 로그인 계정이 같은지 확인해주세요. 초대가 만료되거나 취소된 경우 관리자에게 재초대를 요청해주세요.</p><Link href="/">홈으로</Link></> : !signedIn ? <><p>초대받은 이메일로 로그인하거나 가입한 뒤 초대를 수락해주세요. 이메일 인증이 필요합니다.</p><div className="wc-manager-invitation__actions"><Link href={login}>로그인</Link><Link href={`${login}&mode=signup`}>회원가입</Link></div><p className="wc-manager-invitation__note">로그인 후 초대가 보이지 않으면 이메일의 초대 링크를 다시 열어주세요.</p></> : data?.status === 'email_confirmation_required' ? <><h2>이메일 인증이 필요합니다</h2><p>가입한 이메일의 인증을 완료한 뒤 초대 링크를 다시 열어주세요.</p></> : data?.status === 'accepted' ? <><h2>{data.accessActive ? '매니저 등록이 완료되었습니다' : '이미 수락한 초대입니다'}</h2><p>{data.accessActive && data.managerRole ? `${MANAGER_ROLE_LABELS[data.managerRole]} 권한으로 업무를 시작할 수 있습니다.` : '현재 매니저 권한은 관리자에게 확인해주세요. 이 링크를 다시 열어도 회수된 권한은 복구되지 않습니다.'}</p>{data.accessActive ? <Link href="/admin">어드민으로 이동</Link> : <Link href="/">홈으로</Link>}</> : data?.status === 'pending' ? <><p>다음 권한으로 ICONS 매니저에 초대되었습니다.</p><dl><dt>매니저 권한</dt><dd>{MANAGER_ROLE_LABELS[data.managerRole]}</dd><dt>담당업무</dt><dd>{OPERATOR_DUTIES.find(duty => duty.value === data.duty)?.label}</dd><dt>유효기간</dt><dd>{new Date(data.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)</dd></dl><label><input type="checkbox" checked={confirmed} disabled={pending || uncertain} onChange={event => setConfirmed(event.target.checked)} />위 권한을 확인했으며 초대를 수락합니다.</label><button type="button" disabled={pending || (!confirmed && !uncertain)} onClick={() => { void accept(); }}>{pending ? '수락 중' : uncertain ? '같은 요청으로 결과 확인' : '초대 수락'}</button></> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section></main>;
}
