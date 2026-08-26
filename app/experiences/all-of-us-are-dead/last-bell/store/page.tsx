import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AouadCampaignProvider } from '@/components/campaigns/aouad/AouadCampaignProvider';
import { AouadVerifiedStore } from '@/components/campaigns/aouad/AouadVerifiedStore';
import { isLastBellVerifiedExperienceEnabled } from '@/lib/campaigns/aouad/game-entry';
import { getAouadGameEntryContext } from '@/lib/campaigns/aouad/game-entry.server';

export const metadata: Metadata = {
  title: '매점 — 보급소 · 마지막 종',
  description: '마지막 종에서 발견한 굿즈의 계정 구매권과 판매 가능 상태를 확인합니다.',
  robots: { index: false, follow: false },
};

export default async function LastBellVerifiedStorePage() {
  await connection();
  if (!isLastBellVerifiedExperienceEnabled()) notFound();
  const entry = await getAouadGameEntryContext();
  return (
    <AouadCampaignProvider>
      <AouadVerifiedStore entry={entry} />
    </AouadCampaignProvider>
  );
}
