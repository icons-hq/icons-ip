import { redirect } from 'next/navigation';
import { Onboarding } from '@/components/screens/Onboarding';
import { isOnboarded, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';

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

  const [catalog, followedIpIds] = await Promise.all([
    getCatalogSnapshot(),
    auth.user ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
  ]);
  const recommendedIps = catalog.ips.slice(0, 5).map((ip) => ({
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
