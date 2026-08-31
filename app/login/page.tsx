import { Login } from '@/components/screens/Login';
import {
  ACCOUNT_DELETION_PATH,
  ACCOUNT_SUSPENDED_PATH,
  authErrorMessage,
  isAccountSuspended,
  passwordResetErrorMessage,
  postAuthenticationPath,
  safeNextPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const requestedMode = firstParam(params.mode);
  const explicitDeletionReauthentication = firstParam(params.reauth) === '1'
    && next === ACCOUNT_DELETION_PATH;
  const initialMode = requestedMode === 'signup' || requestedMode === 'reset' ? requestedMode : 'signin';
  const initialError = initialMode === 'reset'
    ? passwordResetErrorMessage(firstParam(params.reset_error))
    : authErrorMessage(firstParam(params.auth_error));
  const initialMessage = firstParam(params.password_reset) === 'success'
    ? '비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.'
    : undefined;
  const auth = await getCurrentAuthState();

  if (auth.user && !explicitDeletionReauthentication) {
    if (isAccountSuspended(auth.profile) && next !== ACCOUNT_DELETION_PATH) {
      redirect(ACCOUNT_SUSPENDED_PATH);
    }
    redirect(postAuthenticationPath(auth.profile, auth.user.email, next));
  }

  return (
    <Login
      initialError={initialError}
      initialMessage={initialMessage}
      initialMode={initialMode}
      isConfigured={auth.isConfigured}
      next={next}
    />
  );
}
