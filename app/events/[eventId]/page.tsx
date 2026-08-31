/* 캠페인 상세 + 레거시 딥링크 브리지 (S8 #330).
 *
 * 조회 순서가 계약이다: 캠페인 → 오프라인 팝업 → 404. 같은 id 가 양쪽에 있으면
 * 캠페인이 이긴다. 반대로 두면 admin_upsert_campaign 의 슬러그 섀도잉 차단
 * (catalog_id_taken)을 우회해 만들어진 캠페인이 영영 열리지 않는다.
 *
 * /events/<id>로 저장·공유된 옛 팝업 링크는 그대로 새 경로로 넘긴다. */

import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { CampaignLanding } from '@/components/screens/CampaignLanding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadCampaignDetail } from '@/lib/campaigns.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadCoinOverview } from '@/lib/coins.server';

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { eventId } = await params;
  const campaign = await loadCampaignDetail(eventId);

  /* 캠페인이 아니면 이 라우트는 리다이렉트나 404 로 끝난다 — 그 화면들은 자기 제목을
     쓰므로 여기서는 허브 제목으로만 답한다. */
  if (!campaign) {
    return {
      title: '이벤트 — ICONS',
      description: 'ICONS의 기간 한정 캠페인과 프로모션을 모아 봅니다.',
    };
  }

  return {
    title: `${campaign.title} — ICONS`,
    description: campaign.subtitle ?? `${campaign.title} 캠페인 안내입니다.`,
  };
}

export default async function Page({ params }: PageProps) {
  const { eventId } = await params;
  const campaign = await loadCampaignDetail(eventId);

  if (campaign) {
    /* 공개 브라우징 — 로그인 여부는 참여 패널을 로그인 CTA 로 바꾸는 데만 쓴다.
       비로그인도 본문은 그대로 읽는다. */
    const auth = await getCurrentAuthState();
    const signedIn = Boolean(auth.user);
    const coin = signedIn ? await loadCoinOverview() : null;

    return (
      <CampaignLanding
        campaign={campaign}
        coin={coin}
        /* 교환 폼의 멱등 키. 렌더마다 새로 만들어 심고, 같은 폼을 두 번 제출하면
           RPC 가 같은 키를 보고 already_exchanged 로 답한다. */
        operationId={crypto.randomUUID()}
        signedIn={signedIn}
      />
    );
  }

  const catalog = await getCatalogSnapshot();
  if (!catalog.events.some((event) => event.id === eventId)) notFound();
  permanentRedirect(`/offline-popups/${encodeURIComponent(eventId)}`);
}
