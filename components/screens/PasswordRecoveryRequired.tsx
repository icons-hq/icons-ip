'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestPasswordResetAction, type AuthActionState } from '@/app/login/actions';
import { WcButton } from '@/components/wc/WcButton';

const emptyState: AuthActionState = {};

/*
 * /update-password를 recovery 콜백 없이 연 로그인 세션에 폼 대신 보이는 안내. 로그인한 사람은 /login의
 * 재설정 화면으로 갈 수 없으므로(로그인 화면이 바로 돌려보낸다) 같은 서버 action으로 계정 이메일에 링크를 보낸다.
 */
export function PasswordRecoveryRequired({ email, next }: { email: string | null; next: string }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, emptyState);
  const error = state.errors?.form ?? state.errors?.email;

  return (
    <main className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <p className="wc-auth__step-note">
          <Link href="/">ICONS</Link>
        </p>
        <h1 className="wc-auth__title wc-auth__title--sub">새 비밀번호 설정</h1>
        <p className="wc-auth__lede">
          비밀번호는 재설정 메일의 링크를 연 뒤에만 바꿀 수 있어요. 링크는 메일을 요청한 브라우저에서 열고,
          연 뒤 15분 안에 새 비밀번호를 저장해주세요.
        </p>

        {email ? (
          <form action={action} className="wc-auth__form">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
            <p className="wc-auth__lede">받는 주소: {email}</p>
            {error && (
              <div className="wc-auth__alert" role="alert">
                {error}
              </div>
            )}
            {!error && state.message && (
              <div aria-live="polite" className="wc-auth__status" role="status">
                {state.message}
              </div>
            )}
            <WcButton disabled={pending} type="submit" variant="primary">
              {pending ? '메일 보내는 중…' : '재설정 메일 받기'}
            </WcButton>
          </form>
        ) : (
          <div className="wc-auth__alert" role="alert">
            계정에 등록된 이메일이 없어 재설정 메일을 보낼 수 없습니다.
          </div>
        )}

        <p className="wc-auth__legal">
          <Link href={next}>돌아가기</Link>
        </p>
      </div>
    </main>
  );
}
