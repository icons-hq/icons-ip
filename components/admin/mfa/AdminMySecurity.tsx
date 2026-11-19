'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { adminConfirm } from '@/lib/admin/confirm';
import { totpErrorMessage } from '@/lib/admin/mfa';
import { statusTone } from '@/lib/admin/status-tone';
import { formatOrderDateTime } from '@/lib/orders';
import { createClient } from '@/lib/supabase/client';
import { listTotpFactors, type TotpFactor } from './totp';
import { TotpCodeForm, TotpEnrollPanel } from './TotpPanels';

type Level = 'aal1' | 'aal2' | null;

/**
 * 내 보안 설정 — 본인 인증 앱(TOTP) 등록·이 세션 확인·삭제. 운영자 누구나 쓰고, 2단계 인증 요구를 켜기 전에 미리 등록한다.
 * 등록·확인은 본인 세션의 GoTrue MFA API가 한다. 등록된 인증 앱을 지우는 것은 인증 앱 코드로 확인한 세션(aal2)에서만 된다.
 */
export function AdminMySecurity({ required }: { required: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [level, setLevel] = useState<Level>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [listed, assurance] = await Promise.all([listTotpFactors(supabase), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
    if (!listed.ok) { setError(listed.error); return; }
    setError('');
    setFactors(listed.value);
    setLevel((assurance.data?.currentLevel as Level) ?? null);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => (active ? load() : undefined));
    return () => { active = false; };
  }, [load]);

  const verified = factors?.filter((factor) => factor.status === 'verified') ?? [];
  const verifiedHere = level === 'aal2';

  async function afterVerified(text: string) {
    setMessage(text);
    await load();
  }

  async function remove(factor: TotpFactor) {
    if (busy) return;
    const last = verified.length === 1;
    const ok = await adminConfirm({
      title: '인증 앱 삭제',
      message: last && required
        ? '마지막 인증 앱을 지우면 다음 화면 이동부터 새 인증 앱을 등록해야 어드민을 쓸 수 있습니다. 휴대폰을 바꾸는 경우에만 지우세요. 지울까요?'
        : '이 인증 앱으로는 더 이상 로그인을 확인할 수 없습니다. 지울까요?',
      confirmLabel: '삭제',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true); setMessage(''); setError('');
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removeError) { setBusy(false); setError(totpErrorMessage(removeError)); return; }
    /* 지운 뒤 세션의 인증 수준을 바로 낮춘다(새로 고치지 않으면 토큰 갱신 때까지 aal2로 남는다). */
    await supabase.auth.refreshSession().catch(() => undefined);
    setBusy(false);
    if (last && required) { window.location.reload(); return; }
    await afterVerified('인증 앱을 지웠습니다.');
  }

  if (error && !factors) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!factors) return <p className="text-sm text-muted-foreground" role="status">인증 정보를 확인하는 중…</p>;

  return <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">이 로그인 세션</span>
      <AdminStatusBadge tone={statusTone('setting', verifiedHere ? 'active' : 'inactive')}>{verifiedHere ? '인증 앱으로 확인됨' : '비밀번호만 확인됨'}</AdminStatusBadge>
    </div>
    {verified.length ? <ul className="flex flex-col divide-y rounded-lg border">
      {verified.map((factor) => <li className="flex flex-wrap items-center justify-between gap-3 p-3" key={factor.id}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{factor.friendlyName ?? '인증 앱'}</span>
          <span className="text-xs text-muted-foreground">등록 {formatOrderDateTime(factor.createdAt)}</span>
        </div>
        <Button disabled={busy || !verifiedHere} onClick={() => void remove(factor)} size="sm" title={verifiedHere ? undefined : '인증 앱 코드로 이 세션을 먼저 확인해야 지울 수 있습니다.'} variant="outline">삭제</Button>
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">등록한 인증 앱이 없습니다.</p>}
    {verified.length && !verifiedHere ? <section aria-label="이 세션 확인" className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm">등록한 인증 앱의 코드로 이 세션을 확인합니다. 확인한 세션에서만 인증 앱을 지울 수 있습니다.</p>
      <TotpCodeForm factorId={verified[0].id} onVerified={() => afterVerified('이 세션을 인증 앱으로 확인했습니다.')} submitLabel="확인" supabase={supabase} />
    </section> : null}
    {!verified.length ? <section aria-label="인증 앱 등록" className="flex flex-col gap-3 rounded-lg border p-3">
      <TotpEnrollPanel factors={factors} onVerified={() => afterVerified('인증 앱을 등록했고 이 세션도 확인했습니다.')} supabase={supabase} />
    </section> : null}
    {message ? <p className="text-sm text-success" role="status">{message}</p> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
  </div>;
}
