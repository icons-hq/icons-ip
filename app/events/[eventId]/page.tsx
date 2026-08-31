/* 캠페인 상세 + 레거시 딥링크 브리지 (S8 #330).
 *
 * 조회 순서가 계약이다: 캠페인 → 오프라인 팝업 → 404. 같은 id 가 양쪽에 있으면
 * 캠페인이 이긴다. 반대로 두면 admin_upsert_campaign 의 슬러그 섀도잉 차단
 * (catalog_id_taken)을 우회해 만들어진 캠페인이 영영 열리지 않는다.
 *
 * /events/<id>로 저장·공유된 옛 팝업 링크는 그대로 새 경로로 넘긴다. 쿼리도 함께
 * 넘긴다 — 옛 링크에 붙은 회차·유입 추적 파라미터를 여기서 떨어뜨리면 리다이렉트가
 * 링크의 절반만 옮기는 셈이 된다. */

import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { CampaignLanding } from '@/components/screens/CampaignLanding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadCampaignDetail } from '@/lib/campaigns.server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadCoinOverview } from '@/lib/coins.server';

/* /packs 와 같은 관례 — 게이트 값은 요청당 한 번만 읽는다. */
const getCardRewardsEnabled = cache(readCardRewardsEnabled);

interface PageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/* 교환 폼의 멱등 키는 블록마다 따로다.
 *
 * 한 페이지에 교환 블록이 여러 개일 수 있고, 키를 공유하면 첫 교환이 성립한 뒤
 * 다른 상품을 제출했을 때 RPC 가 같은 키를 보고 already_exchanged 로 답한다 —
 * 두 번째 교환은 일어나지 않았는데 화면은 성공으로 그린다. 섹션 인덱스로 키를
 * 나눠 두면 각 블록이 자기 재제출만 막는다. */
function exchangeOperationIdsFor(sections: readonly { type: string }[]): Record<number, string> {
  const ids: Record<number, string> = {};
  sections.forEach((section, index) => {
    if (section.type === 'exchange') ids[index] = crypto.randomUUID();
  });
  return ids;
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
    /* 공개 브라우징 — 로그인 여부는 참여 패널을 로그인 CTA 로 바꾸는 데만 쓴다.
       비로그인도 본문은 그대로 읽는다. */
    const [auth, cardRewardsEnabled] = await Promise.all([
      getCurrentAuthState(),
      /* 전역 카드 리워드 게이트. /packs·게임·마이 메뉴가 게이트 OFF 에서 표면을
         감추는 것과 같은 규율이다 — 교환 CTA 만 남으면 누를 수 있는데 서버가
         거절하는 버튼이 된다. RPC 의 card_rewards_disabled 는 백스톱으로 남는다. */
      getCardRewardsEnabled(),
    ]);
    const signedIn = Boolean(auth.user);
    const coin = signedIn ? await loadCoinOverview() : null;

    return (
      <CampaignLanding
        campaign={campaign}
        cardRewardsEnabled={cardRewardsEnabled}
        coin={coin}
        exchangeOperationIds={exchangeOperationIdsFor(campaign.resolvedSections)}
        signedIn={signedIn}
      />
    );
  }

  const catalog = await getCatalogSnapshot();
  if (!catalog.events.some((event) => event.id === eventId)) notFound();

  /* 쿼리는 리다이렉트 분기에서만 읽는다 — 캠페인 렌더 경로에는 필요 없다. */
  const query = legacyQueryString(await searchParams);
  const target = `/offline-popups/${encodeURIComponent(eventId)}`;
  permanentRedirect(query ? `${target}?${query}` : target);
}
