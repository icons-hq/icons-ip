import type { Metadata } from 'next';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { LastBellCampaignClient } from '@/components/prototype/last-bell/LastBellCampaignClient';
import { isLastBellVerifiedExperienceEnabled } from '@/lib/campaigns/aouad/game-entry';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = {
  title: '지금 우리 학교는: 마지막 종',
  description: '죽은 효산고를 지나 옥상의 불빛까지 도달하는 10분 1인칭 공포 경험.',
  robots: { index: false, follow: false },
};

export default async function LastBellVerifiedExperiencePage() {
  await connection();
  if (!isLastBellVerifiedExperienceEnabled()) notFound();
  const auth = await getCurrentAuthState();
  return (
    <LastBellCampaignClient
      authority="verified-candidate"
      isAuthenticated={auth.user !== null}
      authConfigured={auth.isConfigured}
    />
  );
}
