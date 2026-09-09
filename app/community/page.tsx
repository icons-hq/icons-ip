import { notFound } from 'next/navigation';
import { Community } from '@/components/screens/Community';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeCommunityFeedScope, type CommunityViewerState } from '@/lib/community';
import { getCommunitySnapshot } from '@/lib/community.server';
import { canViewCommunity } from '@/lib/community-visibility.server';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string | string[]; ip?: string | string[] }>;
}) {
  /* 커뮤니티 임시 비공개 — 공개 스위치가 꺼진 동안 로그인한 staff/admin 만 통과한다.
     진입점(푸터 스태프 블록)을 지우는 것만으로는 직접 URL 접근이 남으므로 여기서 판정한다.
     쿠키를 읽는 판정이라 이 라우트는 동적이다(app/market/page.tsx 와 같은 형태). */
  if (!(await canViewCommunity())) notFound();

  const auth = await getCurrentAuthState();
  const params = await searchParams;
  const feedScope = normalizeCommunityFeedScope(params.feed);
  const snapshot = await getCommunitySnapshot({
    viewerId: auth.user?.id ?? null,
    isStaff: auth.isStaff,
    feed: feedScope,
  });
  const ipParam = params.ip;
  const requestedIp = Array.isArray(ipParam) ? ipParam[0] : ipParam;
  const initialChannelId = snapshot.channels.some((channel) => channel.id === requestedIp) ? requestedIp : undefined;
  const viewerState: CommunityViewerState = !auth.user
    ? 'guest'
    : isOnboarded(auth.profile, auth.user.email)
      ? 'onboarded'
      : 'onboarding';

  return (
    <Community
      feedScope={feedScope}
      initialChannelId={initialChannelId}
      key={feedScope}
      snapshot={snapshot}
      viewerState={viewerState}
    />
  );
}
