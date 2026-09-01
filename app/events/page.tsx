import type { Metadata } from 'next';
import { CampaignHub } from '@/components/screens/CampaignHub';
import { loadCampaignHub } from '@/lib/campaigns.server';

/* 캠페인 허브 (S8 #330).
   오프라인 팝업 예매는 /offline-popups로 이사했다(CONTEXT.md의 별개 도메인). */

export const metadata: Metadata = {
  title: '이벤트 — ICONS',
  description: 'ICONS의 기간 한정 캠페인과 프로모션을 모아 봅니다.',
};

export default async function Page() {
  const { banners, campaigns } = await loadCampaignHub();
  return <CampaignHub banners={banners} campaigns={campaigns} />;
}
