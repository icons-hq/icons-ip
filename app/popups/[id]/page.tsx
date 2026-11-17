/* POP-UP 캠페인 상세 (스펙 C §2.6).
 *
 * 노출 설정에서 'POP-UP에 싣기'를 고른 캠페인만 이 주소로 열린다 — 배너·기간·장소·소개·CTA·관련 굿즈·유의사항은 `/events/<id>`와
 * 같은 캠페인 랜딩 블록이고, 이 경로는 로그인 복귀 경로(basePath)와 기간 아래 장소 줄만 다르다.
 * 그 밖의 id(일반 EVENT 캠페인·없는 id)는 404 다. 오프라인 팝업(예매 도메인)의 상세는 `/offline-popups/<id>`가 맡는다. */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CampaignLanding } from '@/components/screens/CampaignLanding';
import { loadCampaignLandingProps } from '@/lib/campaign-landing.server';
import { loadCampaignDetail } from '@/lib/campaigns.server';
import { popupsHref } from '@/lib/popups';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const campaign = await loadCampaignDetail(id);

  /* POP-UP 캠페인이 아니면 이 라우트는 404 로 끝난다 — 그 화면은 자기 제목을 쓰므로 목록 제목으로만 답한다. */
  if (!campaign?.presentation?.popupMode) {
    return {
      title: 'POP-UP — ICONS',
      description: 'ICONS에서 지금 열려 있거나 곧 열리는 POP-UP을 모아 봅니다.',
    };
  }

  return {
    title: `${campaign.title} — ICONS`,
    description: campaign.subtitle ?? `${campaign.title} POP-UP 안내입니다.`,
  };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const campaign = await loadCampaignDetail(id);
  const presentation = campaign?.presentation;

  if (!campaign || !presentation?.popupMode) notFound();

  return (
    <CampaignLanding
      {...await loadCampaignLandingProps(campaign)}
      basePath={popupsHref()}
      venue={{ mode: presentation.popupMode, location: presentation.popupLocation }}
    />
  );
}
