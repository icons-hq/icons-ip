import Link from 'next/link';
import { CampaignBannerSlider } from '@/components/campaign/CampaignBannerSlider';
import { CampaignMoreList } from '@/components/campaign/CampaignMoreList';
import { EmptyState } from '@/components/wc/EmptyState';
import { TabPanels } from '@/components/wc/TabPanels';
import { WcButton } from '@/components/wc/WcButton';
import {
  CAMPAIGN_HUB_ALL_LIMIT,
  campaignKindLabel,
  campaignPeriodLabel,
  campaignStateBadgeLabel,
  campaignStateBadgeVariant,
  type CampaignSummary,
} from '@/lib/campaigns';
import { imageBg } from '@/lib/media';

/* 이벤트 허브 (R-06 §1 · DESIGN §6 campaign-hub · 11 §8 EV-01·EV-02).
 *
 * 레퍼런스 허브는 보이는 제목·부제 없이 배너 슬라이더로 시작하고, 그 아래 ALL/EVENT/DROP
 * 탭과 2열 카드 그리드가 페이지의 전부다. 제목은 문서 구조와 스크린리더 탐색을 위해 h1 으로
 * 남기되 시각적으로만 숨긴다. 탭 라벨에는 건수를 붙이지 않는다(14/700).
 *
 * 레퍼런스와 다른 곳은 하나다: 카드에 기간 라벨과 상태 뱃지를 넣는다. 레퍼런스는 이 둘이
 * 없어 진행중과 종료가 리스트 순서로만 구분됐고(R-06 §1.4·§13-2), DESIGN §6 이 그 결함의
 * 보완을 이 표면의 요구사항으로 못 박았다.
 *
 * 분량(11 §6 B21): ALL 은 최대 100건을 한 번에, EVENT·DROP 은 10건으로 시작해
 * [더보기 (n/총)]로 이어 붙인다(URL 불변). 배너는 5초 자동 넘김·loop 없음 —
 * 정지 규율은 CampaignBannerSlider 가 맡는다.
 *
 * 서버 컴포넌트다. 탭 전환·더보기·슬라이더만 클라이언트 프리미티브를 쓰고, 카드 자체는
 * 서버에서 그려 넘긴다 — 캠페인 목록 전체를 클라이언트 번들로 보낼 이유가 없다. */

function campaignHref(id: string) {
  return `/events/${encodeURIComponent(id)}`;
}

/* draft 는 RLS 상 운영자만 받는다 — 화면은 role 을 판정하지 않고 받은 데이터를
   그대로 그린다. 준비 중 편성이 '진행중'과 같은 뱃지를 달면 운영자가 공개 여부를
   목록에서 구분할 수 없다. */
function StateBadge({ campaign }: { campaign: CampaignSummary }) {
  return (
    <span className={`wc-campaign-state wc-campaign-state--${campaignStateBadgeVariant(campaign)}`}>
      {campaignStateBadgeLabel(campaign)}
    </span>
  );
}

function CampaignBanner({ campaign }: { campaign: CampaignSummary }) {
  const image = campaign.bannerImagePath ?? campaign.cardImagePath;

  return (
    <Link className="wc-campaign-banner" href={campaignHref(campaign.id)}>
      <span
        aria-hidden
        className="wc-campaign-banner__art"
        style={image ? { background: imageBg(image) } : undefined}
      />
      {/* 배너 카피는 이미지에 구운 글자가 아니라 텍스트 레이어다(R-06 §1.2) —
          이미지가 늦게 오거나 실패해도 무엇을 여는 링크인지 읽힌다. */}
      <span className="wc-campaign-banner__body">
        <span className="wc-campaign-banner__title">{campaign.title}</span>
        {campaign.subtitle ? (
          <span className="wc-campaign-banner__subtitle">{campaign.subtitle}</span>
        ) : null}
        <span className="wc-campaign-banner__meta">
          <span className="wc-campaign-banner__period">
            {campaignPeriodLabel(campaign.startsAt, campaign.endsAt)}
          </span>
          <StateBadge campaign={campaign} />
        </span>
      </span>
    </Link>
  );
}

function CampaignCard({ campaign }: { campaign: CampaignSummary }) {
  return (
    <li className="wc-campaign-card">
      {/* 카드 전체가 링크 하나다(R-06 §1.4). 안에 별도 액션이 없어 링크를 쪼갤 이유가
          없고, 제목 텍스트가 링크 안에 있어 접근 가능한 이름도 채워진다. */}
      <Link className="wc-campaign-card__link" href={campaignHref(campaign.id)}>
        {/* 배경 아트 자체는 장식이지만 유형 뱃지 텍스트는 정보다 — 통째로 aria-hidden
            하면 EVENT/DROP 구분이 스크린리더에서 사라진다. */}
        <div
          className="wc-campaign-card__media"
          style={campaign.cardImagePath ? { background: imageBg(campaign.cardImagePath) } : undefined}
        >
          {/* 유형은 색이 아니라 텍스트로 구분한다(R-06 §1.4) — EVENT·DROP 모두 검정 면. */}
          <span className="wc-campaign-card__kind">{campaignKindLabel(campaign.kind)}</span>
        </div>
        <div className="wc-campaign-card__info">
          {/* 보이는 h1 이 없는 지면이라 카드 제목이 h1 바로 아래 단계다. */}
          <h2 className="wc-campaign-card__title">{campaign.title}</h2>
          {campaign.subtitle ? (
            <p className="wc-campaign-card__subtitle">{campaign.subtitle}</p>
          ) : null}
          <p className="wc-campaign-card__meta">
            <span className="wc-campaign-card__period">
              {campaignPeriodLabel(campaign.startsAt, campaign.endsAt)}
            </span>
            <StateBadge campaign={campaign} />
          </p>
        </div>
      </Link>
    </li>
  );
}

function CampaignGrid({
  campaigns,
  emptyLabel,
  paged = false,
}: {
  campaigns: CampaignSummary[];
  emptyLabel: string;
  /** EVENT·DROP 탭 — 10건씩 [더보기 (n/총)]로 이어 붙인다. ALL 은 한 번에 싣는다. */
  paged?: boolean;
}) {
  if (!campaigns.length) {
    return <EmptyState description="다른 탭에서 진행 중인 캠페인을 확인해 보세요." title={emptyLabel} titleAs="h2" />;
  }

  const cards = campaigns.map((campaign) => <CampaignCard campaign={campaign} key={campaign.id} />);

  return paged
    ? <CampaignMoreList className="wc-campaign-grid" items={cards} />
    : <ul className="wc-campaign-grid">{cards}</ul>;
}

export interface CampaignHubProps {
  banners: CampaignSummary[];
  campaigns: CampaignSummary[];
}

export function CampaignHub({ banners, campaigns }: CampaignHubProps) {
  const events = campaigns.filter((campaign) => campaign.kind === 'event');
  const drops = campaigns.filter((campaign) => campaign.kind === 'drop');

  return (
    <div className="wc-root wc-campaign-hub">
      <div className="wc-container">
        {/* 보이는 제목·부제는 두지 않는다(R-06 §1.1, EV-01). 부제가 카드 리워드 게이트와
            무관하게 '카드팩'을 말하던 누수(CH-11)도 함께 사라진다. */}
        <h1 className="wc-sr-only">이벤트</h1>

        {banners.length ? (
          <CampaignBannerSlider className="wc-campaign-hub__banners" label="추천 캠페인">
            {banners.map((campaign) => <CampaignBanner campaign={campaign} key={campaign.id} />)}
          </CampaignBannerSlider>
        ) : null}

        {campaigns.length ? (
          <TabPanels
            className="wc-campaign-hub__tabs"
            idBase="campaign"
            panels={[
              {
                id: 'all',
                label: 'ALL',
                content: (
                  <CampaignGrid
                    campaigns={campaigns.slice(0, CAMPAIGN_HUB_ALL_LIMIT)}
                    emptyLabel="진행 중인 캠페인이 없어요"
                  />
                ),
              },
              {
                id: 'event',
                label: 'EVENT',
                content: <CampaignGrid campaigns={events} emptyLabel="진행 중인 이벤트가 없어요" paged />,
              },
              {
                id: 'drop',
                label: 'DROP',
                content: <CampaignGrid campaigns={drops} emptyLabel="예정된 드랍이 없어요" paged />,
              },
            ]}
          />
        ) : (
          <EmptyState
            action={<WcButton href="/">홈으로 가기</WcButton>}
            className="wc-campaign-hub__empty"
            description="새 캠페인이 열리면 이 자리에서 가장 먼저 알려 드릴게요."
            title="진행 중인 캠페인이 없어요"
            titleAs="h2"
          />
        )}
      </div>
    </div>
  );
}
