'use client';

import Link from 'next/link';
import { ReviewEventDisclosureNote } from '@/components/reviews/ReviewEventBanner';
import { Fragment, type ReactNode } from 'react';
import { defaultHomeBlockKeys, type HomeRankingBlockKey } from '@/lib/home-layout';
import { HOME_REVIEW_GOODS_MIN, homeReviewBandRating, type HomeReviewBestBand } from '@/lib/home-ranking';
import { IconsPick } from '@/components/home/IconsPick';
import { IpShortcuts } from '@/components/home/IpShortcuts';
import { homeCardChips } from '@/components/home/home-card-chips';
import { ProductMosaic } from '@/components/home/ProductMosaic';
import { ProductCollection } from '@/components/home/ProductCollection';
import { HomeShoppingStories } from '@/components/home/ShoppingStories';
import { HomeAnnouncementPopup } from '@/components/home/HomeAnnouncementPopup';
import type { HomeAnnouncementPopupData } from '@/lib/goods-announcement-popup';
import { ScheduledHomeRefresh } from '@/components/home/ScheduledHomeRefresh';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import { EmptyState } from '@/components/wc/EmptyState';
import { HeroCarousel } from '@/components/wc/HeroCarousel';
import { ProductCard } from '@/components/wc/ProductCard';
import { ProductGrid } from '@/components/wc/ProductGrid';
import { SectionHeader } from '@/components/wc/SectionHeader';
import { StripBanner } from '@/components/wc/StripBanner';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { Slider } from '@/components/wc/Slider';
import { Icon } from '@/components/ui/Icon';
import { TabPanels, type TabPanelDef } from '@/components/wc/TabPanels';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { hrefFor } from '@/lib/routes';
import {
  benefitTileIcon,
  homeCardUnavailableLabel,
  withoutCommunityCurations,
  withoutRetiredCurations,
  type HomeBestTab,
  type HomeCurationSnapshot,
  type HomeGoodsBand,
  type HomeGoodsCard,
} from '@/lib/home-catalog';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';

export interface HomeProps {
  curation: HomeCurationSnapshot;
  refreshScheduledContent?: boolean;
  announcementPopup?: HomeAnnouncementPopupData;
  /** 목록 하트의 초기 상태(`lib/wishlist-ids.server`). 생략하면(어드민 미리보기) 하트를 그리지 않는다. */
  wishlist?: ListingWishlist | null;
}

/* 홈의 모든 상품 카드와 리스트 행에 같은 목록 하트를 단다(11 CL-01·HM-03, 12 LD-4).
   위시 상태를 받지 않은 자리(어드민 미리보기·mock)에는 하트를 그리지 않는다. */
type HeartFor = (good: Pick<HomeGoodsCard, 'id' | 'name'>, className?: string) => ReactNode;

function heartsFrom(wishlist: ListingWishlist | null | undefined): HeartFor {
  const wished = listingWishSet(wishlist);
  return function homeWishHeart(good, className) {
    if (!wishlist) return null;
    return <ListingWishHeart className={className} goodId={good.id} initialWished={wished.has(good.id)} label={good.name} viewerId={wishlist.viewerId} />;
  };
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

/* 홈의 모든 상품 카드는 같은 모양이다(NEW ARRIVAL·IP 상품 섹션·탭 밴드·리뷰 밴드). 칩은 서버가 채운 `chips`에서 오고,
   스토어 표시 설정이 태그를 끈 배포에서는 운영 배지 칩만 빠진다(homeCardChips). 옛 `badges` 표기는 칩이 대신한다. */
function HomeProductCard({ good, heartFor, showRating = true }: { good: HomeGoodsCard; heartFor: HeartFor; showRating?: boolean }) {
  const { listing } = useStorePresentation();
  return (
    <ProductCard
      action={heartFor(good)}
      brand={good.brand ?? undefined}
      chips={homeCardChips(good, listing.showTags)}
      compareAtPrice={good.compareAtPrice}
      href={good.href}
      imageBackground={good.imageBg}
      name={good.name}
      price={good.price}
      priceMax={good.priceMax}
      reviewSummary={showRating ? good.reviewSummary : undefined}
      showDiscountRate={good.showDiscountRate}
      soldOut={good.soldOut}
      unavailableLabel={homeCardUnavailableLabel(good)}
    />
  );
}

function TabProductBand({
  headingId,
  heartFor,
  idBase,
  tabs,
  title,
  defaultTabId,
  preserveEmptyTabs = false,
}: {
  headingId: string;
  heartFor: HeartFor;
  idBase: string;
  tabs: HomeBestTab[];
  title: string;
  defaultTabId?: string;
  preserveEmptyTabs?: boolean;
}) {
  const panels: TabPanelDef[] = tabs
    .filter((tab) => preserveEmptyTabs || tab.goods.length > 0)
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      content: tab.goods.length === 0 ? <p className="wc-home__tab-empty">해당 기간에 집계된 굿즈가 없어요.</p> : (
        <Slider label={`${tab.label} 굿즈`}>
          {paginate(tab.goods, TAB_PAGE_SIZE).map((page) => (
            <div className="wc-tab-band__page" key={page[0].id}>
              {page.map((good) => <HomeProductCard good={good} heartFor={heartFor} key={good.id} />)}
            </div>
          ))}
        </Slider>
      ),
    }));

  return (
    <section aria-labelledby={headingId} className="wc-home__band">
      <div className="wc-container wc-container--wide">
        <div className="wc-tab-band">
          <div className="wc-tab-band__head">
            <SectionHeading id={headingId} title={title} />
          </div>
          <TabPanels defaultPanelId={defaultTabId} idBase={idBase} key={defaultTabId} panels={panels} />
        </div>
      </div>
    </section>
  );
}

function ReviewProductBand({ band, heartFor }: { band: HomeReviewBestBand; heartFor: HeartFor }) {
  return <section aria-labelledby={`home-reviews-${band.id}-heading`} className="wc-home__band">
    <div className="wc-container wc-container--wide">
      <SectionHeading id={`home-reviews-${band.id}-heading`} title={band.title} />
      <Slider label={`${band.title} 굿즈`}>
        {paginate(band.goods, HOME_REVIEW_GOODS_MIN).map((page) => <div className="wc-home-review__page" key={page[0].id}>
          {page.map((good) => {
            /* 보이는 숫자는 카드 별점과 같은 그룹 범위이고, 선정(3점 이상)·정렬도 같은 값이다(L4b, lib/home-ranking). */
            const rating = homeReviewBandRating(good);
            return <div className="wc-home-review__item" key={good.id}>
              <HomeProductCard good={good} heartFor={heartFor} showRating={false} />
              <Link className="wc-home-review__rating" href={`${good.href}?reviewPage=1#reviews`} aria-label={`${good.name} 평점 ${rating.average.toFixed(2)}점, 리뷰 ${rating.count}개 보기`}>
                <span aria-hidden>★</span> {rating.average.toFixed(2)} <span>리뷰 {rating.count.toLocaleString('ko-KR')}</span>
              </Link>
              <blockquote className="wc-home-review__quote">
                <p>{good.review.body}</p>
                <ReviewEventDisclosureNote value={good.review.eventDisclosure} />
                <footer><span>{good.review.authorName}</span><time dateTime={good.review.createdAt}>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(good.review.createdAt))}</time></footer>
              </blockquote>
            </div>;
          })}
        </div>)}
      </Slider>
    </div>
  </section>;
}

export function Home({ curation: rawCuration, refreshScheduledContent = true, announcementPopup, wishlist }: HomeProps) {
  const { common } = useStorePresentation();
  const heartFor = heartsFrom(wishlist);
  /* 지운 화면(카드팩·게임·바인더·마켓·트레이드, ADR-0052)으로 가는 예전 큐레이션은 밴드 종류와 무관하게 걸러낸다 —
     GNB 와 같은 규칙이다. 혜택 타일도 다른 큐레이션처럼 목적지로 거른다(12 LD-15). */
  const retiredCuration = withoutRetiredCurations(rawCuration);
  /* 커뮤니티 임시 비공개도 같은 규칙으로 목적지를 건다 — 배너만 살아 404 로 떨어지지 않게. */
  const curation = COMMUNITY_ENABLED ? retiredCuration : withoutCommunityCurations(retiredCuration);
  const hasHero = curation.heroSlides.length > 0;
  const hasPicks = curation.editorPicks.length > 0;
  const hasBest = hasTabGoods(curation.categoryBestTabs);
  const hasPopular = hasTabGoods(curation.popularTabs);
  /* 목적지 필터가 지운 화면 타일만 걷어 내므로 남은 타일 수로 밴드 존재를 판정한다. */
  const hasBenefit = curation.benefitTiles.length > 0;
  const newArrivals = curation.newArrivals ?? [];
  const stripBanner = curation.stripBanner ?? null;
  /* 기획전 배너(band:<id>)는 따로 그리지 않고, 순서상 연달아 놓인 것끼리 한 'ICONS PICK' 줄로 묶어 그린다(아래 visible 훑기). */
  const bandsByKey = new Map<string, HomeGoodsBand>(curation.goodsBands.map((band) => [`band:${band.id}`, band]));
  /* 홈 모든 섹션은 넓은 컨테이너(1320, 안쪽 1272)에 놓인다 — 섹션 사이 간격은 wc-home.css 가 쥔다. */
  const blocks: Record<string, ReactNode> = {
    hero: hasHero ? <div className="wc-home__hero wc-container wc-container--wide"><HeroCarousel slides={curation.heroSlides} /></div> : null,
    editor_picks: hasPicks ? <IpShortcuts picks={curation.editorPicks} /> : null,
    new_arrivals: newArrivals.length ? (
      <section aria-labelledby="home-new-arrivals-heading" className="wc-home__band">
        <div className="wc-container wc-container--wide">
          <SectionHeader id="home-new-arrivals-heading" moreHref={hrefFor('new')} title="NEW ARRIVAL" />
          <ProductGrid density="home">
            {newArrivals.map((good) => <li key={good.id}><HomeProductCard good={good} heartFor={heartFor} /></li>)}
          </ProductGrid>
        </div>
      </section>
    ) : null,
    strip_banner: stripBanner ? (
      <div className="wc-home__band wc-home__strip">
        <div className="wc-container wc-container--wide">
          <StripBanner alt={stripBanner.title} href={stripBanner.href} imageUrl={stripBanner.imageUrl} size="home" />
        </div>
      </div>
    ) : null,
    category_best: hasBest ? <TabProductBand headingId="home-best-heading" heartFor={heartFor} idBase="home-best" tabs={curation.categoryBestTabs} title="카테고리 BEST" /> : null,
    popular: hasPopular ? <TabProductBand headingId="home-popular-heading" heartFor={heartFor} idBase="home-popular" tabs={curation.popularTabs} title="인기템" /> : null,
    stories: curation.shoppingStoriesUnavailable ? (
      <section className="wc-home__band"><div className="wc-container wc-container--wide">
        <EmptyState title="스토어 소식을 불러오지 못했어요" titleAs="h2"
          description="잠시 후 다시 확인해주세요."
          action={<Link className="wc-btn" href="/stories">스토리 다시 확인하기</Link>} />
      </div></section>
    ) : curation.shoppingStories?.length ? <HomeShoppingStories stories={curation.shoppingStories} /> : null,
    /* 혜택 밴드의 제목은 목적지와 무관한 '혜택'이다(12 LD-15). 타일 아이콘은 목적지에서 고른 ICONS 아이콘이다(HM-07). */
    benefits: hasBenefit ? (
      <section aria-labelledby="home-benefit-heading" className="wc-home__band wc-home__band--grey">
        <div className="wc-container wc-container--wide">
          <SectionHeading id="home-benefit-heading" title="혜택" />
          <ul className="wc-benefit__grid">
            {curation.benefitTiles.map((tile) => (
              <li key={tile.id}>
                <Link className="wc-benefit__tile" href={tile.href}>
                  <span aria-hidden className="wc-benefit__tile-icon"><Icon name={benefitTileIcon(tile.href)} size={32} stroke={1.5} /></span>
                  <strong className="wc-benefit__tile-title">{tile.title}</strong>
                  {tile.description ? <span className="wc-benefit__tile-desc">{tile.description}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    ) : null,
  };
  for (const key of bandsByKey.keys()) blocks[key] = true;
  const rankingKeys: HomeRankingBlockKey[] = [];
  for (const band of curation.salesBestBands ?? []) {
    const key: HomeRankingBlockKey = `sales:${band.id}`;
    rankingKeys.push(key);
    blocks[key] = hasTabGoods(band.tabs) ? <TabProductBand headingId={`home-sales-${band.id}-heading`} heartFor={heartFor}
      idBase={`home-sales-${band.id}`} tabs={band.tabs} title={band.title} defaultTabId={band.defaultTabId} preserveEmptyTabs /> : null;
  }
  for (const band of curation.reviewBestBands ?? []) {
    const key: HomeRankingBlockKey = `reviews:${band.id}`;
    rankingKeys.push(key);
    blocks[key] = band.goods.length >= HOME_REVIEW_GOODS_MIN ? <ReviewProductBand band={band} heartFor={heartFor} /> : null;
  }
  for (const band of curation.mosaicBands ?? []) {
    const key: HomeRankingBlockKey = `mosaic:${band.id}`;
    rankingKeys.push(key);
    blocks[key] = band.tiles.some(Boolean) ? <ProductMosaic band={band} /> : null;
  }
  for (const band of curation.productCollections ?? []) {
    const key: HomeRankingBlockKey = `products:${band.id}`;
    rankingKeys.push(key);
    blocks[key] = band.goods.length ? <ProductCollection band={band} wishlist={wishlist} /> : null;
  }
  const order = curation.layoutOrder ?? defaultHomeBlockKeys(curation.goodsBands.map((band) => band.id), rankingKeys);
  const visible = [...new Set(order)].filter((key) => blocks[key]);
  /* 보일 키를 순서대로 훑으며 연달아 오는 기획전(band:)을 한 그룹으로 묶는다 — 그룹은 'ICONS PICK' 한 섹션이고 그룹의 첫 키가 React key 다.
     사이에 다른 블록이 끼면 그룹이 갈라져 각자 ICONS PICK 섹션이 된다. */
  const sections: ReactNode[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const key = visible[index];
    const band = bandsByKey.get(key);
    if (!band) {
      sections.push(<Fragment key={key}>{blocks[key]}</Fragment>);
      continue;
    }
    const group = [band];
    while (bandsByKey.has(visible[index + 1])) {
      index += 1;
      group.push(bandsByKey.get(visible[index])!);
    }
    sections.push(<IconsPick bands={group} heartFor={heartFor} key={key} />);
  }
  const goods = [
    ...newArrivals,
    ...curation.categoryBestTabs.flatMap(tab => tab.goods), ...curation.popularTabs.flatMap(tab => tab.goods),
    ...curation.goodsBands.flatMap(band => band.goods), ...(curation.salesBestBands ?? []).flatMap(band => band.tabs.flatMap(tab => tab.goods)),
    ...(curation.reviewBestBands ?? []).flatMap(band => band.goods), ...(curation.mosaicBands ?? []).flatMap(band => band.tiles.flatMap(tile => tile ? [tile.good] : [])),
    ...(curation.productCollections ?? []).flatMap(band => band.goods),
  ];

  return (
    <main className="wc-root wc-home">
      {refreshScheduledContent && announcementPopup ? <HomeAnnouncementPopup data={announcementPopup} /> : null}
      {refreshScheduledContent ? <GoodsSalePeriodRefresh goods={goods} /> : null}
      <h1 className="wc-sr-only">ICONS 홈</h1>
      {common.showHomeSearch ? <section className="wc-home-store-search" aria-labelledby="home-store-search-heading"><div className="wc-container"><h2 id="home-store-search-heading">스토어 내 굿즈 검색</h2><form action="/search" role="search"><label className="wc-sr-only" htmlFor="home-store-search-query">굿즈 검색어</label><input id="home-store-search-query" name="q" type="search" placeholder="찾는 굿즈를 입력하세요" maxLength={80} required /><button type="submit">검색</button></form></div></section> : null}
      {refreshScheduledContent && curation.storiesNextChangeAt && order.includes('stories')
        ? <ScheduledHomeRefresh at={curation.storiesNextChangeAt} /> : null}
      {visible.length === 0 ? (
        <div className="wc-home__empty">
          <EmptyState action={<Link className="wc-btn primary" href="/shop">굿즈샵 둘러보기</Link>}
            description="곧 새로운 소식과 굿즈를 만나볼 수 있어요." title="홈을 준비하고 있어요" titleAs="h2" />
        </div>
      ) : sections}
    </main>
  );
}
