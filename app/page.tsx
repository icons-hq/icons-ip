import { Home } from '@/components/screens/Home';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';

type PageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function Page({ searchParams }: PageProps = {}) {
  const auth = await getCurrentAuthState();
  const onboarded = Boolean(auth.user && isOnboarded(auth.profile, auth.user.email));
  const [home, followedIpIds, cardRewardsEnabled] = await Promise.all([
    getHomeSnapshot({ viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    auth.user && onboarded ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
    readCardRewardsEnabled(),
  ]);

  /*
   * Throwaway reference prototype: production Vercel은 이 분기를 실행하지 않는다.
   * 데이터·인증 계약은 기존 홈과 공유하고, 렌더 서브트리만 비교한다.
   */
  const prototypeEnabled = process.env.ICONS_PROTOTYPE === '1'
    && process.env.VERCEL_ENV !== 'production';
  if (prototypeEnabled) {
    const [{ LineFriendsHomePrototype }, { normalizePrototypeVariant }] = await Promise.all([
      import('@/components/prototype/line-friends/LineFriendsHomePrototype'),
      import('@/components/prototype/line-friends/variants'),
    ]);
    const query = searchParams ? await searchParams : {};
    return (
      <>
        <style data-prototype-styles="line-friends-home">{`@import url("/prototype/line-friends/chrome.css");
@import url("/prototype/line-friends/home.css");`}</style>
        <LineFriendsHomePrototype
          catalog={home.catalog}
          curation={home.curation}
          followedIpIds={Array.from(followedIpIds)}
          postPreviewByIpId={home.postPreviewByIpId}
          variant={normalizePrototypeVariant(query.variant)}
        />
      </>
    );
  }

  return (
    <Home
      cardRewardsEnabled={cardRewardsEnabled}
      catalog={home.catalog}
      curation={home.curation}
      followedIpIds={Array.from(followedIpIds)}
      postPreviewByIpId={home.postPreviewByIpId}
    />
  );
}
