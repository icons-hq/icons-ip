import Link from 'next/link';
import { EmptyState } from '@/components/wc/EmptyState';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { Slider } from '@/components/wc/Slider';
import { TabPanels } from '@/components/wc/TabPanels';
import { WcButton } from '@/components/wc/WcButton';
import {
  campaignKindLabel,
  campaignPeriodLabel,
  campaignStateBadgeLabel,
  campaignStateBadgeVariant,
  type CampaignSummary,
} from '@/lib/campaigns';
import { imageBg } from '@/lib/media';

/* 이벤트 허브 (R-06 §1 · DESIGN §6 campaign-hub).
 *
 * 상단 배너 슬라이더 + ALL/EVENT/DROP 탭 + 2열 카드 그리드. 레퍼런스와 다른 곳은
 * 하나다: 카드에 기간 라벨과 상태 뱃지를 넣는다. 레퍼런스는 이 둘이 없어 진행중과
 * 종료가 리스트 순서로만 구분됐고(R-06 §1.4·§13-2), DESIGN §6 이 그 결함의 보완을
 * 이 표면의 요구사항으로 못 박았다.
 *
 * 서버 컴포넌트다. 탭 전환과 슬라이더만 클라이언트 프리미티브를 쓰고, 카드 자체는
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
          <h3 className="wc-campaign-card__title">{campaign.title}</h3>
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

function CampaignGrid({ campaigns, emptyLabel }: { campaigns: CampaignSummary[]; emptyLabel: string }) {
  if (!campaigns.length) {
    return <EmptyState description="다른 탭에서 진행 중인 캠페인을 확인해 보세요." title={emptyLabel} titleAs="h2" />;
  }

  return (
    <ul className="wc-campaign-grid">
      {campaigns.map((campaign) => <CampaignCard campaign={campaign} key={campaign.id} />)}
    </ul>
  );
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
        <SectionHeading
          as="h1"
          className="wc-campaign-hub__heading"
          subcopy="기간 한정 캠페인과 프로모션을 모았어요. 출석하고 모은 코인은 카드팩으로 바꿀 수 있어요."
          title="이벤트"
        />

        {banners.length ? (
          <Slider className="wc-campaign-hub__banners" label="추천 캠페인">
            {banners.map((campaign) => <CampaignBanner campaign={campaign} key={campaign.id} />)}
          </Slider>
        ) : null}

        {campaigns.length ? (
          <TabPanels
            className="wc-campaign-hub__tabs"
            idBase="campaign"
            panels={[
              {
                id: 'all',
                label: 'ALL',
                count: campaigns.length,
                content: <CampaignGrid campaigns={campaigns} emptyLabel="진행 중인 캠페인이 없어요" />,
              },
              {
                id: 'event',
                label: 'EVENT',
                count: events.length,
                content: <CampaignGrid campaigns={events} emptyLabel="진행 중인 이벤트가 없어요" />,
              },
              {
                id: 'drop',
                label: 'DROP',
                count: drops.length,
                content: <CampaignGrid campaigns={drops} emptyLabel="예정된 드랍이 없어요" />,
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
