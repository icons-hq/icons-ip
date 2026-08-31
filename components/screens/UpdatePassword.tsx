'use client';

import Link from 'next/link';
import { useActionState, useId } from 'react';
import {
  updatePasswordAction,
  type UpdatePasswordActionState,
} from '@/app/update-password/actions';
import { WcButton } from '@/components/wc/WcButton';

const emptyState: UpdatePasswordActionState = {};

function PasswordField({ error, label, name }: { error?: string; label: string; name: string }) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="wc-auth__field">
      <label className="wc-auth__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete="new-password"
        id={inputId}
        name={name}
        type="password"
      />
      {error && (
        <span className="wc-auth__error" id={errorId}>
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
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <p className="wc-auth__step-note">
          <Link href="/">ICONS</Link>
        </p>
        <h1 className="wc-auth__title wc-auth__title--sub">새 비밀번호 설정</h1>
        <p className="wc-auth__lede">기존과 다른 비밀번호를 입력한 뒤 다시 로그인해주세요.</p>

        <form action={action} className="wc-auth__form">
          <input type="hidden" name="next" value={next} />
          <PasswordField error={state.errors?.password} label="새 비밀번호" name="password" />
          <PasswordField error={state.errors?.passwordConfirmation} label="새 비밀번호 확인" name="passwordConfirmation" />
          {state.errors?.form && (
            <div className="wc-auth__alert" role="alert">
              {state.errors.form}
            </div>
          )}
          {state.message && (
            <div aria-live="polite" className="wc-auth__status" role="status">
              {state.message}
            </div>
          )}
          <WcButton disabled={pending} type="submit" variant="primary">
            {pending ? '변경하는 중…' : '비밀번호 변경하기'}
          </WcButton>
        </form>

        <p className="wc-auth__legal">
          링크가 만료됐나요? <Link href={resetHref}>새 메일 요청하기</Link>
        </p>
      </div>
    </main>
  );
}
