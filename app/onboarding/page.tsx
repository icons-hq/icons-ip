import { redirect } from 'next/navigation';
import { Onboarding } from '@/components/screens/Onboarding';
import { isOnboarded, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getStorefrontIpsPage } from '@/lib/storefront.server';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';

/** 온보딩이 보여 주는 추천 IP 수. 서버에서 이만큼만 읽는다. */
const RECOMMENDED_IP_COUNT = 5;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const auth = await getCurrentAuthState();

  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent(`/onboarding?next=${encodeURIComponent(next)}`)}`);
  }

  if (auth.user && isOnboarded(auth.profile, auth.user.email)) redirect(next);

  /* 추천은 다섯 개다 — 다섯 개를 보여주려고 카탈로그 전량을 읽지 않는다(규모 후속). */
  const [ipsPage, followedIpIds] = await Promise.all([
    getStorefrontIpsPage({ limit: RECOMMENDED_IP_COUNT }),
    auth.user ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
  ]);
  const recommendedIps = ipsPage.ips.map((ip) => ({
    bg: ip.bg,
    color: ip.v.color,
    fans: ip.fans,
    id: ip.id,
    sub: ip.sub,
    tagline: ip.tagline,
    title: ip.title,
  }));

  return (
    <Onboarding
      birthDate={auth.profile?.birth_date ?? ''}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      followedIpIds={[...followedIpIds]}
      initialMarketing={auth.profile?.consents?.marketing === true}
      isConfigured={auth.isConfigured}
      next={next}
      nickname={auth.profile?.nickname ?? ''}
      recommendedIps={recommendedIps}
    />
  );
}
