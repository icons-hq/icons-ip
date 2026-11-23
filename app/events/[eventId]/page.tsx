/* 캠페인 상세 + 레거시 딥링크 브리지 (S8 #330).
 *
 * 조회 순서가 계약이다: 캠페인 → 오프라인 팝업 → 404. 같은 id 가 양쪽에 있으면
 * 캠페인이 이긴다. 반대로 두면 admin_upsert_campaign 의 슬러그 섀도잉 차단
 * (catalog_id_taken)을 우회해 만들어진 캠페인이 영영 열리지 않는다.
 *
 * 노출 설정에서 'POP-UP에 싣기'를 고른 캠페인은 `/popups/<id>`가 정본 주소다(스펙 C §2.6) — 이전에 EVENT 로 공유된 링크가
 * 남아 있을 수 있어 영구 이전한다. 레거시 팝업 브리지와 같은 이유로 쿼리를 함께 넘긴다.
 *
 * /events/<id>로 저장·공유된 옛 팝업 링크는 그대로 새 경로로 넘긴다. 쿼리도 함께
 * 넘긴다 — 옛 링크에 붙은 회차·유입 추적 파라미터를 여기서 떨어뜨리면 리다이렉트가
 * 링크의 절반만 옮기는 셈이 된다. */

import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { CampaignLanding } from '@/components/screens/CampaignLanding';
import { loadCampaignLandingProps } from '@/lib/campaign-landing.server';
import { loadCampaignDetail } from '@/lib/campaigns.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { popupDetailHref } from '@/lib/popups';

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/* 같은 키가 여러 번 온 쿼리(?utm=a&utm=b)는 배열로 도착한다 — 하나로 접으면
   원 링크와 다른 요청이 된다. 값 없는 파라미터는 그대로 버린다. */
function legacyQueryString(searchParams: Record<string, string | string[] | undefined>): string {
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

function withQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>): Promise<Metadata> {
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

export default async function Page({ params, searchParams }: PageProps) {
  const { eventId } = await params;
  const campaign = await loadCampaignDetail(eventId);

  if (campaign) {
    if (campaign.presentation?.popupMode) {
      const query = legacyQueryString(await searchParams);
      permanentRedirect(withQuery(popupDetailHref(campaign.id), query));
    }

    return <CampaignLanding {...await loadCampaignLandingProps(campaign)} />;
  }

  const catalog = await getCatalogSnapshot({ storefrontReadCache: true });
  if (!catalog.events.some((event) => event.id === eventId)) notFound();

  /* 쿼리는 리다이렉트 분기에서만 읽는다 — 캠페인 렌더 경로에는 필요 없다. */
  const query = legacyQueryString(await searchParams);
  permanentRedirect(withQuery(`/offline-popups/${encodeURIComponent(eventId)}`, query));
}
