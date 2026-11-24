'use client';
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { createClient } from '@/lib/supabase/client';
import { listTotpFactors, type TotpFactor } from './totp';
import { TotpCodeForm, TotpEnrollPanel } from './TotpPanels';

/**
 * 운영자 2단계 인증 화면(OPS-006). 스위치가 켜졌는데 세션이 aal2가 아닌 운영자가 어드민 화면을 열면 여기로 온다.
 * 등록한 인증 앱이 있으면 코드를 받고, 없으면 등록부터 한다. 확인되면 원래 화면으로 새로 연다(서버 가드가 새 쿠키를 읽도록).
 */
export function AdminMfaGate({ email, next }: { email: string | null; next: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    void listTotpFactors(supabase).then((result) => {
      if (!active) return;
      if (result.ok) setFactors(result.value); else setError(result.error);
    });
    return () => { active = false; };
  }, [supabase]);

  const verified = factors?.find((factor) => factor.status === 'verified') ?? null;
  const done = () => { setLeaving(true); window.location.replace(next); };
  async function signOut() {
    setLeaving(true);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }

  return <main className="wc-admin flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 text-foreground sm:py-16">
    <section aria-labelledby="admin-mfa-title" className="flex w-full max-w-lg flex-col gap-5 rounded-xl border bg-card p-5 text-sm shadow-sm sm:p-6">
      <header className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-primary"><ShieldCheck aria-hidden className="size-5" /><span className="text-xs font-semibold">엑스스퀘어 어드민</span></span>
        <h1 className="text-lg font-semibold" id="admin-mfa-title">{verified ? '2단계 인증' : '인증 앱 등록'}</h1>
        <p className="text-muted-foreground">
          {verified
            ? '운영자 화면은 비밀번호와 인증 앱 코드를 함께 확인한 뒤 열립니다. 등록한 인증 앱의 6자리 코드를 입력해 주세요.'
            : '운영자 화면은 비밀번호와 인증 앱 코드를 함께 확인한 뒤 열립니다. 이 계정에는 아직 인증 앱이 없어 먼저 등록합니다.'}
        </p>
        {email ? <p className="text-xs text-muted-foreground">로그인 계정 · {email}</p> : null}
      </header>
      {leaving ? <p role="status">이동 중…</p>
        : error ? <p className="text-destructive" role="alert">{error}</p>
          : factors === null ? <p role="status">인증 정보를 확인하는 중…</p>
            : verified ? <TotpCodeForm factorId={verified.id} onVerified={done} submitLabel="확인" supabase={supabase} />
              : <TotpEnrollPanel factors={factors} onVerified={done} supabase={supabase} />}
      <footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground">
        <p>인증 앱이 있는 휴대폰을 잃었으면 통합 매니저에게 2단계 인증 초기화를 요청하세요. 초기화 뒤 다시 로그인해 새 휴대폰으로 등록합니다.</p>
        <div><Button disabled={leaving} onClick={() => void signOut()} size="sm" variant="outline">다른 계정으로 로그인</Button></div>
      </footer>
    </section>
  </main>;
}
