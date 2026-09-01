'use client';

import Link from 'next/link';
import { ContentCard } from '@/components/wc/ContentCard';
import { EmptyState } from '@/components/wc/EmptyState';
import { HeroCarousel } from '@/components/wc/HeroCarousel';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { Slider } from '@/components/wc/Slider';
import { TabPanels, type TabPanelDef } from '@/components/wc/TabPanels';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { krw } from '@/lib/format';
import {
  withoutCardRewardCurations,
  withoutCommunityCurations,
  type HomeBestTab,
  type HomeCurationSnapshot,
  type HomeGoodsBand,
} from '@/lib/home-catalog';

export interface HomeProps {
  cardRewardsEnabled: boolean;
  curation: HomeCurationSnapshot;
}

/* 탭 슬라이더 한 페이지 = 상품 4개(D 4열 / M 2×2). R-스펙 02 §2 ③. */
const TAB_PAGE_SIZE = 4;

function paginate<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

/*
 * 홈은 "데이터가 있는 밴드만 그린다". 큐레이션이 비면 가짜 콘텐츠를 채우지 않고 밴드를
 * 통째로 지우고, 전부 비면 페이지 하나짜리 빈 상태로 떨어진다(DESIGN §7).
 * 탭 밴드는 탭 목록이 있어도 상품이 하나도 없을 수 있어, 존재 판정을 상품 기준으로 한다.
 */
function hasTabGoods(tabs: readonly HomeBestTab[]) {
  return tabs.some((tab) => tab.goods.length > 0);
}

function TabProductBand({
  headingId,
  idBase,
  tabs,
  title,
}: {
  headingId: string;
  idBase: string;
  tabs: HomeBestTab[];
  title: string;
}) {
  const panels: TabPanelDef[] = tabs
    .filter((tab) => tab.goods.length > 0)
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      content: (
        <Slider label={`${tab.label} 상품`}>
          {paginate(tab.goods, TAB_PAGE_SIZE).map((page) => (
            <div className="wc-tab-band__page" key={page[0].id}>
              {page.map((good) => (
                <ProductCard
                  key={good.id}
                  badges={good.badge ? [good.badge] : undefined}
                  brand={good.brand ?? undefined}
                  href={good.href}
                  imageBackground={good.imageBg}
                  name={good.name}
                  price={good.price}
                  soldOut={good.soldOut}
                />
              ))}
            </div>
          ))}
        </Slider>
      ),
    }));

  return (
    <section aria-labelledby={headingId} className="wc-home__band">
      <div className="wc-container">
        <div className="wc-tab-band">
          <div className="wc-tab-band__head">
            <SectionHeading id={headingId} title={title} />
          </div>
          <TabPanels idBase={idBase} panels={panels} />
        </div>
      </div>
    </section>
  );
}

function GoodsBandSection({ band }: { band: HomeGoodsBand }) {
  const headingId = `home-band-${band.id}-heading`;

  return (
    <section aria-labelledby={headingId} className="wc-home__band">
      <div className="wc-container">
        <SectionHeading id={headingId} subcopy={band.subcopy ?? undefined} title={band.title} />
        <div className="wc-band__layout">
          {/* 배너 카피는 아트웍에 베이크돼 있어 alt 로 옮길 텍스트가 없다 — 이름은 링크가 갖는다. */}
          <Link aria-label={`${band.title} 기획전 보기`} className="wc-band__banner" href={band.href}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={band.imageUrl} />
          </Link>
          {band.goods.length > 0 ? (
            <div className="wc-band__list">
              {band.goods.map((good) => (
                <Link key={good.id} className="wc-band__row" href={good.href}>
                  <span aria-hidden className="wc-band__thumb" style={{ background: good.imageBg }} />
                  <div className="wc-band__row-text">
                    {good.brand ? <p className="wc-band__row-brand">{good.brand}</p> : null}
                    <p className="wc-band__row-name">{good.name}</p>
                    <p className="wc-band__row-price">
                      {krw(good.price)}
                      {/* 리스트 행에는 품절 스크림 밴드를 겹칠 자리가 없어 가격 옆 라벨로 전한다(DESIGN §12 품절 상태). */}
                      {good.soldOut ? <span className="wc-band__row-soldout">품절</span> : null}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <Link className="wc-band__more" href={band.href}>기획전 전체보기</Link>
      </div>
    </section>
  );
}

export function Home({ cardRewardsEnabled, curation: rawCuration }: HomeProps) {
  /* 게이트가 꺼진 배포에서는 혜택 밴드만이 아니라 카드팩·게임 목적지를 가진 큐레이션을
     밴드 종류와 무관하게 걸러낸다 — GNB 의 packs 필터·구 홈과 같은 규칙이다. */
  const gatedCuration = cardRewardsEnabled ? rawCuration : withoutCardRewardCurations(rawCuration);
  /* 커뮤니티 임시 비공개도 같은 규칙으로 목적지를 건다 — 배너만 살아 404 로 떨어지지 않게. */
  const curation = COMMUNITY_ENABLED ? gatedCuration : withoutCommunityCurations(gatedCuration);
  const hasHero = curation.heroSlides.length > 0;
  const hasPicks = curation.editorPicks.length > 0;
  const hasBest = hasTabGoods(curation.categoryBestTabs);
  const hasGoodsBands = curation.goodsBands.length > 0;
  const hasPopular = hasTabGoods(curation.popularTabs);
  /* 필터가 게이트 오프에서 benefitTiles 를 비우므로 존재 판정 하나로 충분하다. */
  const hasBenefit = curation.benefitTiles.length > 0;
  const isEmpty = !hasHero && !hasPicks && !hasBest && !hasGoodsBands && !hasPopular && !hasBenefit;

  return (
    <div className="wc-root wc-home">
      {/* 밴드 헤딩은 전부 h2 다. 문서에 h1 이 하나는 있어야 해서 페이지 이름을 여기서 준다. */}
      <h1 className="wc-sr-only">ICONS 홈</h1>
      {isEmpty ? (
        <div className="wc-home__empty">
          <EmptyState
            action={<Link className="wc-btn primary" href="/shop">굿즈샵 둘러보기</Link>}
            description="곧 새로운 소식과 상품을 만나볼 수 있어요."
            title="홈을 준비하고 있어요"
            titleAs="h2"
          />
        </div>
      ) : null}
      {hasHero ? <HeroCarousel slides={curation.heroSlides} /> : null}
      {hasPicks ? (
        <section aria-labelledby="home-picks-heading" className="wc-home__band">
          <div className="wc-container">
            <SectionHeading id="home-picks-heading" title="에디터의 제안" />
            <Slider className="wc-picks" label="에디터의 제안 콘텐츠">
              {curation.editorPicks.map((pick) => (
                <ContentCard
                  key={pick.id}
                  badge={pick.badge}
                  description={pick.description}
                  href={pick.href}
                  imageBg={pick.imageBg}
                  title={pick.title}
                />
              ))}
            </Slider>
          </div>
        </section>
      ) : null}
      {hasBest ? (
        <TabProductBand
          headingId="home-best-heading"
          idBase="home-best"
          tabs={curation.categoryBestTabs}
          title="카테고리 BEST"
        />
      ) : null}
      {curation.goodsBands.map((band) => <GoodsBandSection band={band} key={band.id} />)}
      {hasPopular ? (
        <TabProductBand
          headingId="home-popular-heading"
          idBase="home-popular"
          tabs={curation.popularTabs}
          title="인기템"
        />
      ) : null}
      {hasBenefit ? (
        <section aria-labelledby="home-benefit-heading" className="wc-home__band wc-home__band--grey">
          <div className="wc-container">
            <SectionHeading id="home-benefit-heading" title="카드팩·게임" />
            <ul className="wc-benefit__grid">
              {curation.benefitTiles.map((tile) => (
                <li key={tile.id}>
                  <Link className="wc-benefit__tile" href={tile.href}>
                    <strong className="wc-benefit__tile-title">{tile.title}</strong>
                    {tile.description ? (
                      <span className="wc-benefit__tile-desc">{tile.description}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
