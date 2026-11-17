import { CampaignBannerSlider } from '@/components/campaign/CampaignBannerSlider';
import { EmptyState } from '@/components/wc/EmptyState';
import { PromoCard } from '@/components/wc/PromoCard';
import { StripBanner } from '@/components/wc/StripBanner';
import { WcButton } from '@/components/wc/WcButton';
import {
  CAMPAIGN_UPCOMING_BADGE,
  campaignBannerImage,
  campaignCardHref,
  campaignCardImage,
  selectEventHubBanners,
  selectEventHubCampaigns,
  type CampaignSummary,
} from '@/lib/campaigns';
import { imageBg } from '@/lib/media';

/* EVENT 허브 (Figma 2026-11-12 Event 프레임, 스펙 C §2.7).
 *
 * 스트립 배너(추천 캠페인의 배너 이미지) → 제목 "EVENT" → 3열 프로모션 카드다. 이전의 ALL/EVENT/DROP 탭·기간 줄·상태 뱃지는
 * 없앴다 — 지금 마케팅 중인 캠페인만 보이는 지면이라 진행중·오픈 예정만 싣고(종료·POP-UP 캠페인 제외, `selectEventHubCampaigns`),
 * 곧 열리는 것만 "오픈 예정" 배지를 단다. 카드·배너는 노출 설정의 바로가기가 있으면 상품·IP관·카테고리로 바로 가고,
 * 없으면 캠페인 랜딩으로 간다(`campaignCardHref`).
 *
 * 배너는 이미지만이다(Figma 스트립 배너에는 글 레이어가 없다) — 링크의 접근 이름은 캠페인 제목이다. 여러 장이면
 * `CampaignBannerSlider`의 자동 넘김·정지 규율을 그대로 쓰고 모양만 Figma 다(wc-popups.css).
 *
 * 서버 컴포넌트다. 슬라이더만 클라이언트 프리미티브이고, 카드·배너 자체는 서버에서 그려 넘긴다. */

/* 첫 줄(데스크톱 3장)은 첫 화면이다 — 배경 이미지를 우선 내려받는다. */
const PRIORITY_CARDS = 3;

export interface CampaignHubProps {
  banners: CampaignSummary[];
  campaigns: CampaignSummary[];
}

export function CampaignHub({ banners, campaigns }: CampaignHubProps) {
  const cards = selectEventHubCampaigns(campaigns);
  const strip = selectEventHubBanners(banners);

  return (
    <main className="wc-root wc-promo-page wc-event-hub">
      <div className="wc-container wc-container--wide">
        {strip.length ? (
          <CampaignBannerSlider className="wc-event-hub__banners" label="추천 캠페인">
            {strip.map((campaign) => (
              <StripBanner
                alt={campaign.title}
                href={campaignCardHref(campaign)}
                imageUrl={campaignBannerImage(campaign) ?? ''}
                key={campaign.id}
                size="page"
              />
            ))}
          </CampaignBannerSlider>
        ) : null}

        {cards.length ? (
          <>
            <h1 className="wc-promo-page__title">EVENT</h1>
            <ul className="wc-promo-grid">
              {cards.map((campaign, index) => {
                const image = campaignCardImage(campaign);
                return (
                  <li key={campaign.id}>
                    <PromoCard
                      badge={campaign.displayState === 'upcoming' ? CAMPAIGN_UPCOMING_BADGE : undefined}
                      href={campaignCardHref(campaign)}
                      imageBg={image ? imageBg(image) : null}
                      priority={index < PRIORITY_CARDS}
                      title={campaign.title}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            {/* Figma 의 빈 상태에는 보이는 제목이 없다 — 문서 구조용 h1 만 남긴다. */}
            <h1 className="wc-sr-only">EVENT</h1>
            <EmptyState
              action={<WcButton href="/">홈으로 가기</WcButton>}
              className="wc-promo-page__empty"
              description="새 캠페인이 열리면 이 자리에서 가장 먼저 알려 드릴게요."
              title="진행 중인 캠페인이 없어요"
              titleAs="h2"
            />
          </>
        )}
      </div>
    </main>
  );
}
