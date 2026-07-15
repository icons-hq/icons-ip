'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import {
  updatePasswordAction,
  type UpdatePasswordActionState,
} from '@/app/update-password/actions';

const emptyState: UpdatePasswordActionState = {};

const inputStyle: React.CSSProperties = {
  height: 50,
  padding: '0 18px',
  borderRadius: 14,
  border: '1px solid var(--line-2)',
  background: 'rgba(21,17,42,.7)',
  color: 'var(--text)',
  fontSize: 14.5,
  fontFamily: 'inherit',
};

function PasswordField({ error, label, name }: { error?: string; label: string; name: string }) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="col" style={{ gap: 6 }}>
      <label htmlFor={inputId} style={{ color: 'var(--dim)', fontSize: 12.5, fontWeight: 700 }}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete="new-password"
        className="auth-field-input"
        id={inputId}
        name={name}
        style={inputStyle}
        type="password"
      />
      {error && (
        <span id={errorId} style={{ color: 'var(--pink)', fontSize: 12.5, fontWeight: 600 }}>
          {error}
        </span>
      )}
    </div>
  );
}

export function UpdatePassword({ next }: { next: string }) {
  const [state, action, pending] = useActionState(updatePasswordAction, emptyState);
  const resetHref = `/login?mode=reset${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '40px 24px', position: 'relative', zIndex: 2 }}>
      <section className="rise" style={{ width: 'min(440px, 100%)', padding: 'clamp(24px, 5vw, 40px)', borderRadius: 24, border: '1px solid var(--line-2)', background: 'rgba(13,10,26,.88)', boxShadow: '0 32px 90px -40px rgba(139,92,255,.65)' }}>
        <Link href="/" className="brand">
          <span className="dot" />ICONS
        </Link>
        <h1 style={{ margin: '28px 0 0', fontFamily: 'var(--ff-display)', fontSize: 30, letterSpacing: '-0.04em' }}>
          새 비밀번호 설정
        </h1>
        <p style={{ margin: '9px 0 0', color: 'var(--dim)', fontSize: 14, lineHeight: 1.6 }}>
          기존과 다른 비밀번호를 입력한 뒤 다시 로그인해주세요.
        </p>

        <form action={action} className="col" style={{ gap: 12, marginTop: 26 }}>
          <input type="hidden" name="next" value={next} />
          <PasswordField error={state.errors?.password} label="새 비밀번호" name="password" />
          <PasswordField error={state.errors?.passwordConfirmation} label="새 비밀번호 확인" name="passwordConfirmation" />
          {state.errors?.form && (
            <div role="alert" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,77,157,.3)', color: 'var(--pink)', fontSize: 13.5, fontWeight: 700 }}>
              {state.errors.form}
            </div>
          )}
          {state.message && (
            <div aria-live="polite" role="status" style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(56,240,192,.3)', color: 'var(--mint)', fontSize: 13.5, fontWeight: 700 }}>
              {state.message}
            </div>
          )}
          <button className="btn btn-holo" disabled={pending} style={{ width: '100%', height: 52, marginTop: 4, fontSize: 15 }}>
            {pending ? '변경하는 중…' : '비밀번호 변경하기'}
          </button>
        </form>

        <p className="mono" style={{ margin: '18px 0 0', textAlign: 'center', fontSize: 11, color: 'var(--faint)' }}>
          링크가 만료됐나요? <Link href={resetHref} style={{ color: 'var(--dim)', textDecoration: 'underline' }}>새 메일 요청하기</Link>
        </p>
      </section>
    </main>
  );
}
