import { Community } from '@/components/screens/Community';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeCommunityFeedScope, type CommunityViewerState } from '@/lib/community';
import { getCommunitySnapshot } from '@/lib/community.server';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string | string[]; ip?: string | string[] }>;
}) {
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
