import Link from 'next/link';
import { AttendancePanel } from '@/components/campaign/AttendancePanel';
import { CampaignAnchorNav } from '@/components/campaign/CampaignAnchorNav';
import { ExchangePanel } from '@/components/campaign/ExchangePanel';
import { EmptyState } from '@/components/wc/EmptyState';
import { ProductCard } from '@/components/wc/ProductCard';
import {
  campaignAnchors,
  campaignKindLabel,
  campaignPeriodLabel,
  campaignSectionDomId,
  campaignStateLabel,
} from '@/lib/campaigns';
import type { CampaignLandingSnapshot, ResolvedCampaignSection } from '@/lib/campaigns.server';
import type { CoinOverview } from '@/lib/coins.server';
import { imageBg } from '@/lib/media';

/* 캠페인 상세 랜딩 (R-06 §2 · DESIGN §6 campaign-landing).
 *
 * 레퍼런스는 픽셀아트 테마의 자유 랜딩이지만, 이 표면은 White Catalog 문법으로 옮긴다 —
 * 흰 지면·잉크·헤어라인, 콘텐츠 칼럼 안의 히어로. 승계하는 것은 골격 세 가지다:
 * sticky 앵커 내브, 코인 잔액 상시 노출, 게스트에겐 같은 자리 로그인 CTA 치환.
 *
 * 본문은 운영자가 짠 블록 배열이다. 화면은 순서를 재배치하지 않는다 — 편성의 의도가
 * 순서에 담겨 있고, 여기서 정렬을 끼워 넣으면 어드민 미리보기와 실제가 갈린다.
 *
 * 어휘 규율: '가챠·뽑기·충전'을 쓰지 않는다(CONTEXT.md · DESIGN §12). */

export interface CampaignLandingProps {
  campaign: CampaignLandingSnapshot;
  /** 비로그인이면 null — 잔액 0 과 구분해야 로그인 CTA 를 그릴 수 있다. */
  coin: CoinOverview | null;
  /** 교환 폼의 멱등 키. 서버 렌더가 요청마다 새로 심는다. */
  operationId: string;
  signedIn: boolean;
}

function ClosedNotice() {
  /* 종료된 캠페인의 참여 자리. 서버 RPC 는 캠페인 기간을 보지 않으므로 화면이 막는
     것이 유일한 방어는 아니지만, 누를 수 없는 버튼을 남겨 두는 것보다 왜 못 하는지
     적는 편이 낫다(DESIGN §9). 열람은 그대로 열어 둔다. */
  return (
    <div className="wc-campaign-panel wc-campaign-panel--closed">
      <p className="wc-campaign-panel__lede">종료된 이벤트예요.</p>
      <p className="wc-campaign-panel__note">다음 캠페인은 이벤트 목록에서 확인할 수 있어요.</p>
      <Link className="wc-campaign-panel__link" href="/events">이벤트 목록 보기</Link>
    </div>
  );
}

interface SectionContext {
  attendedToday: boolean;
  balance: number;
  ended: boolean;
  loginHref: string;
  next: string;
  operationId: string;
  signedIn: boolean;
}

function SectionBody({ context, section }: { context: SectionContext; section: ResolvedCampaignSection }) {
  switch (section.type) {
    case 'intro':
      return <p className="wc-campaign-intro">{section.copy}</p>;

    case 'image':
      /* 배경 이미지 + role="img" 다. 이 지면의 모든 아트는 CSS 배경으로 그리는데
         (crop 기준을 한 곳에 두려고), 배경에는 대체 텍스트가 붙지 않는다 —
         운영자가 넣은 alt 를 접근성 트리에 올리는 자리가 여기다. */
      return (
        <div
          aria-label={section.alt}
          className="wc-campaign-figure"
          role="img"
          style={{ background: imageBg(section.image_path) }}
        />
      );

    case 'text':
      return (
        <>
          {section.heading ? <h3 className="wc-campaign-section__subheading">{section.heading}</h3> : null}
          <p className="wc-campaign-body">{section.body}</p>
        </>
      );

    case 'notice':
      return (
        <ul className="wc-campaign-notice">
          {section.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      );

    case 'coupon':
      return (
        <div className="wc-campaign-coupon">
          <p className="wc-campaign-coupon__code">{section.coupon_code}</p>
          {section.description ? (
            <p className="wc-campaign-coupon__desc">{section.description}</p>
          ) : null}
          <Link className="wc-campaign-panel__link" href="/cart">장바구니에서 사용하기</Link>
        </div>
      );

    case 'goods':
      if (!section.goods.length) {
        return <p className="wc-campaign-panel__note">준비된 굿즈를 지금은 볼 수 없어요.</p>;
      }
      return (
        <div className="wc-campaign-goods">
          {section.goods.map((good) => (
            <ProductCard
              badges={good.badge ? [good.badge] : undefined}
              compareAtPrice={good.compareAtPrice}
              href={`/shop/${encodeURIComponent(good.id)}`}
              imageBackground={good.imageBackground}
              key={good.id}
              name={good.name}
              price={good.price}
              soldOut={good.soldOut}
            />
          ))}
        </div>
      );

    case 'attendance':
      return context.ended ? <ClosedNotice /> : (
        <AttendancePanel
          attendedToday={context.attendedToday}
          balance={context.balance}
          loginHref={context.loginHref}
          next={context.next}
          signedIn={context.signedIn}
        />
      );

    case 'exchange':
      return context.ended ? <ClosedNotice /> : (
        <ExchangePanel
          balance={context.balance}
          loginHref={context.loginHref}
          next={context.next}
          offer={section.offer}
          operationId={context.operationId}
          signedIn={context.signedIn}
        />
      );

    default:
      return null;
  }
}

export function CampaignLanding({ campaign, coin, operationId, signedIn }: CampaignLandingProps) {
  const next = `/events/${encodeURIComponent(campaign.id)}`;
  const loginHref = `/login?next=${encodeURIComponent(next)}`;
  const anchors = campaignAnchors(campaign.resolvedSections);
  const context: SectionContext = {
    attendedToday: coin?.attendedToday ?? false,
    balance: coin?.balance ?? 0,
    ended: campaign.displayState === 'ended',
    loginHref,
    next,
    operationId,
    signedIn,
  };

  return (
    <div className="wc-root wc-campaign">
      <CampaignAnchorNav
        anchors={anchors}
        balance={signedIn ? context.balance : null}
        loginHref={loginHref}
        signedIn={signedIn}
      />
      <div className="wc-container wc-campaign__body">
        <header className="wc-campaign__header">
          {campaign.heroImagePath ? (
            <div
              aria-hidden
              className="wc-campaign__hero"
              style={{ background: imageBg(campaign.heroImagePath) }}
            />
          ) : null}
          <p className="wc-campaign__kind">{campaignKindLabel(campaign.kind)}</p>
          <h1 className="wc-campaign__title">{campaign.title}</h1>
          {campaign.subtitle ? <p className="wc-campaign__subtitle">{campaign.subtitle}</p> : null}
          <p className="wc-campaign__period">
            <strong>{campaignPeriodLabel(campaign.startsAt, campaign.endsAt)}</strong>
            <span className={`wc-campaign-state wc-campaign-state--${campaign.displayState}`}>
              {campaignStateLabel(campaign.displayState)}
            </span>
          </p>
        </header>

        {campaign.resolvedSections.length ? (
          campaign.resolvedSections.map((section, index) => (
            <section
              className={`wc-campaign-section wc-campaign-section--${section.type}`}
              id={campaignSectionDomId(index)}
              key={campaignSectionDomId(index)}
            >
              {section.anchor ? (
                <h2 className="wc-campaign-section__heading">{section.anchor}</h2>
              ) : null}
              <SectionBody context={context} section={section} />
            </section>
          ))
        ) : (
          <EmptyState
            description="자세한 내용을 준비하고 있어요. 곧 안내해 드릴게요."
            title="아직 공개된 내용이 없어요"
            titleAs="h2"
          />
        )}
      </div>
    </div>
  );
}
