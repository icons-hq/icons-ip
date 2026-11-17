/* POP-UP 캠페인 상세 (스펙 C §2.6).
 *
 * 노출 설정에서 'POP-UP에 싣기'를 고른 캠페인만 이 주소로 열린다 — 배너·기간·장소·소개·CTA·관련 굿즈·유의사항은 `/events/<id>`와
 * 같은 캠페인 랜딩 블록이고, 이 경로는 로그인 복귀 경로(basePath)와 기간 아래 장소 줄만 다르다.
 * 공개된(draft 가 아닌) 캠페인인데 POP-UP 이 아니면 `/events/<id>`로 임시 이동한다(쿼리 보존) — POP-UP 기간에 공유·색인된 링크가
 * 운영자가 EVENT 로 되돌린 뒤에도 깨지지 않게 하려는 것이다. 임시(307)인 까닭은 노출 설정을 다시 POP-UP 으로 바꿀 수 있어서다.
 * draft 캠페인(운영자 미리보기 포함)과 없는 id 는 404 다. 오프라인 팝업(예매 도메인)의 상세는 `/offline-popups/<id>`가 맡는다. */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CampaignLanding } from '@/components/screens/CampaignLanding';
import { loadCampaignLandingProps } from '@/lib/campaign-landing.server';
import { loadCampaignDetail } from '@/lib/campaigns.server';
import { popupsHref } from '@/lib/popups';
import { campaignDetailHref } from '@/lib/routes';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/* 같은 키가 여러 번 온 쿼리(?utm=a&utm=b)는 배열로 도착한다 — 하나로 접으면 원 링크와 다른 요청이 된다. 값 없는 파라미터는 버린다. */
function queryString(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }

  return query.toString();
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>): Promise<Metadata> {
  const { id } = await params;
  const campaign = await loadCampaignDetail(id);

  /* POP-UP 캠페인이 아니면 이 라우트는 이동이나 404 로 끝난다 — 그 화면은 자기 제목을 쓰므로 목록 제목으로만 답한다. */
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

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const campaign = await loadCampaignDetail(id);
  const presentation = campaign?.presentation;

  if (!campaign) notFound();

  if (!presentation?.popupMode) {
    if (campaign.status === 'draft') notFound();

    const query = queryString(await searchParams);
    const target = campaignDetailHref(campaign.id);
    redirect(query ? `${target}?${query}` : target);
  }

  return (
    <CampaignLanding
      {...await loadCampaignLandingProps(campaign)}
      basePath={popupsHref()}
      venue={{ mode: presentation.popupMode, location: presentation.popupLocation }}
    />
  );
}
