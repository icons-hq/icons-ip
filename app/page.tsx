import { Home } from '@/components/screens/Home';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getHomeSnapshot } from '@/lib/catalog';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';

export default async function Page() {
  const auth = await getCurrentAuthState();
  const onboarded = Boolean(auth.user && isOnboarded(auth.profile, auth.user.email));
  const [home, followedIpIds] = await Promise.all([
    getHomeSnapshot({ viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    auth.user && onboarded ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
  ]);

  return (
    <Home
      catalog={home.catalog}
      curation={home.curation}
      followedIpIds={Array.from(followedIpIds)}
      postPreviewByIpId={home.postPreviewByIpId}
    />
  );
}
