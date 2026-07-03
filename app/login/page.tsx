import { Login } from '@/components/screens/Login';
import { authErrorMessage, isOnboarded, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { redirect } from 'next/navigation';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const RARITY_ORDER = ['HOLO', 'SSR', 'SR', 'R', 'N'];

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const initialMode = firstParam(params.mode) === 'signup' ? 'signup' : 'signin';
  const initialError = authErrorMessage(firstParam(params.auth_error));
  const auth = await getCurrentAuthState();

  if (auth.user) {
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
      initialMode={initialMode}
      isConfigured={auth.isConfigured}
      next={next}
      panelCards={panelCards}
    />
  );
}
