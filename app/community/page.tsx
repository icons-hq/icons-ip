import { notFound } from 'next/navigation';
import { Community } from '@/components/screens/Community';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeCommunityFeedScope, type CommunityViewerState } from '@/lib/community';
import { getCommunitySnapshot } from '@/lib/community.server';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string | string[]; ip?: string | string[] }>;
}) {
  /* 커뮤니티 임시 비공개 — 진입점을 지우는 것만으로는 직접 URL 접근이 남는다.
     복원은 lib/community-visibility.ts 한 줄(app/games/[gameId]/page.tsx와 같은 형태). */
  if (!COMMUNITY_ENABLED) notFound();

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
