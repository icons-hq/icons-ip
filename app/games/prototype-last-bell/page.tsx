import type { Metadata } from 'next';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { LastBellCampaignClient } from '@/components/prototype/last-bell/LastBellCampaignClient';
import { isLastBellPrototypeEnabled } from '@/lib/prototypes/last-bell/gate.server';
import { getCurrentAuthState } from '@/lib/auth/server';

export const metadata: Metadata = {
  title: '지금 우리 학교는: 마지막 종 — 2 Chapter QA',
  description: '죽은 학교에서 옥상의 불빛까지 이어지는 10분 1인칭 공포 게임 로컬 QA.',
  robots: { index: false, follow: false },
};

export default async function LastBellPrototypePage() {
  await connection();
  if (!isLastBellPrototypeEnabled()) notFound();
  const auth = await getCurrentAuthState();
  return <LastBellCampaignClient authority="local-qa" isAuthenticated={auth.user !== null} authConfigured={auth.isConfigured} />;
}
