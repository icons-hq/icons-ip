import { Login } from '@/components/screens/Login';
import {
  ACCOUNT_SUSPENDED_PATH,
  authErrorMessage,
  isAccountSuspended,
  isOnboarded,
  passwordResetErrorMessage,
  safeNextPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { RARITY_ORDER } from '@/lib/rarity';
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
  const initialMode = requestedMode === 'signup' || requestedMode === 'reset' ? requestedMode : 'signin';
  const initialError = initialMode === 'reset'
    ? passwordResetErrorMessage(firstParam(params.reset_error))
    : authErrorMessage(firstParam(params.auth_error));
  const initialMessage = firstParam(params.password_reset) === 'success'
    ? '비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.'
    : undefined;
  const auth = await getCurrentAuthState();

  if (auth.user) {
    if (isAccountSuspended(auth.profile)) redirect(ACCOUNT_SUSPENDED_PATH);
    if (isOnboarded(auth.profile, auth.user.email)) redirect(next);
    redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  }

  // 좌측 브랜드 패널 플로팅 카드 — 상위 등급 카드 아트 3장
  const catalog = await getCatalogSnapshot();
  const panelCards = [...catalog.cards]
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
    .slice(0, 3)
    .map((card) => card.bg);

  return (
    <Login
      initialError={initialError}
      initialMessage={initialMessage}
      initialMode={initialMode}
      isConfigured={auth.isConfigured}
      next={next}
      panelCards={panelCards}
    />
  );
}
