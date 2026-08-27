import type { Metadata } from 'next';
import { AboutLegacy } from '@/components/screens/AboutLegacy';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';

export const metadata: Metadata = {
  title: '회사 소개 — ICONS',
  description: 'ICONS 가 만드는 팬덤 세계를 소개합니다. 공식 라이선스 굿즈, 카드 컬렉션, 팝업과 커뮤니티.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  const onboarded = Boolean(auth.user && isOnboarded(auth.profile, auth.user.email));
  const [home, followedIpIds, cardRewardsEnabled] = await Promise.all([
    getHomeSnapshot({ viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    auth.user && onboarded ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
    readCardRewardsEnabled(),
  ]);

  return (
    <AboutLegacy
      cardRewardsEnabled={cardRewardsEnabled}
      catalog={home.catalog}
      curation={home.curation}
      followedIpIds={Array.from(followedIpIds)}
      postPreviewByIpId={home.postPreviewByIpId}
    />
  );
}
