'use client';
/* eslint-disable @next/next/no-img-element -- GoTrue가 돌려준 QR(SVG data URI)을 그대로 보인다. 외부 이미지가 아니다. */
import { useId, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { TOTP_CODE_PATTERN } from '@/lib/admin/mfa';
import { normalizeTotpCode, startTotpEnrollment, verifyTotp, type TotpEnrollment, type TotpFactor } from './totp';

/** 인증 앱의 6자리 코드를 받는다. 성공은 호출자가 이어서 처리한다. */
export function TotpCodeForm({ factorId, supabase, submitLabel, onVerified }: {
  factorId: string; supabase: SupabaseClient; submitLabel: string; onVerified: () => void | Promise<void>;
}) {
  const id = useId();
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    if (!TOTP_CODE_PATTERN.test(code)) { setError('인증 앱에 보이는 6자리 숫자를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    const result = await verifyTotp(supabase, factorId, code);
    if (!result.ok) { setBusy(false); setError(result.error); setCode(''); return; }
    await onVerified();
    setBusy(false);
  }
  return <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium" htmlFor={`${id}-code`}>인증 코드 6자리
      <Input aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} autoComplete="one-time-code" autoFocus
        disabled={busy} id={`${id}-code`} inputMode="numeric" maxLength={7} onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
        placeholder="123456" value={code} />
    </label>
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={busy || code.length !== 6} type="submit">{busy ? '확인 중…' : submitLabel}</Button>
      {error ? <p className="text-sm text-destructive" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  </form>;
}

/** 새 인증 앱 등록: 시작 → QR·설정 키 → 첫 코드 확인. 확인에 성공하면 이 세션이 aal2가 된다. */
export function TotpEnrollPanel({ supabase, factors, onVerified, startLabel = '인증 앱 등록 시작' }: {
  supabase: SupabaseClient; factors: readonly TotpFactor[]; onVerified: () => void | Promise<void>; startLabel?: string;
}) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function start() {
    if (busy) return;
    setBusy(true); setError('');
    const result = await startTotpEnrollment(supabase, factors);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setEnrollment(result.value);
  }
  if (!enrollment) {
    return <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">휴대폰에 Google Authenticator·Microsoft Authenticator 같은 인증 앱을 먼저 설치해 주세요. 등록은 1분 정도 걸립니다.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void start()}>{busy ? '준비 중…' : startLabel}</Button>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </div>
    </div>;
  }
  return <div className="flex flex-col gap-4">
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
      <li>인증 앱에서 QR 코드 스캔을 고르고 아래 QR을 비춥니다.</li>
      <li>스캔할 수 없으면 설정 키를 직접 입력합니다. 계정 이름은 아무거나 써도 되고, 키 유형은 시간 기준으로 고릅니다.</li>
      <li>앱에 나온 6자리 코드를 입력해 등록을 마칩니다.</li>
    </ol>
    <div className="flex flex-wrap items-start gap-4">
      <img alt="인증 앱 등록 QR 코드" className="size-44 rounded-lg border bg-white p-2" height={176} src={enrollment.qrCode} width={176} />
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="font-medium">설정 키</span>
        <code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs break-all select-all">{enrollment.secret}</code>
        <span className="text-xs text-muted-foreground">설정 키는 이 화면에서만 보입니다. 다른 사람에게 알려주지 마세요.</span>
      </div>
    </div>
    <TotpCodeForm factorId={enrollment.factorId} onVerified={onVerified} submitLabel="등록 완료" supabase={supabase} />
  </div>;
}
