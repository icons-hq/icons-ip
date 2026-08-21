'use client';

/**
 * THROWAWAY PROTOTYPE: LINE FRIENDS SQUARE에서 실측한 홈 구조를 ICONS의 현재 카탈로그로 옮기면
 * 발견→비교→굿즈 상세 진입이 기존 메인보다 선명해지는가? 외부 자산과 카피는 사용하지 않는다.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good, Ip } from '@/lib/data';
import { krw } from '@/lib/format';
import type { HomeCurationSnapshot, HomePostPreviewByIpId } from '@/lib/home-catalog';
import { StorefrontChrome } from './StorefrontChrome';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import type { PrototypeVariant } from './variants';

interface LineFriendsHomePrototypeProps {
  catalog: CatalogSnapshot;
  curation: HomeCurationSnapshot;
  followedIpIds: string[];
  postPreviewByIpId: HomePostPreviewByIpId;
  variant: PrototypeVariant;
}

interface HeroSlide {
  id: string;
  title: string;
  description: string;
  eyebrow: string;
  href: string;
  background: string;
}

const BENEFITS = [
  { icon: '01', title: '자유로운 탐색', body: '로그인 전에도 IP와 굿즈를 충분히 둘러볼 수 있어요.' },
  { icon: '02', title: 'IP별 큐레이션', body: '좋아하는 세계의 굿즈, 카드, 팝업을 한 흐름으로 만나요.' },
  { icon: '03', title: '분명한 재고 안내', body: '현재 카탈로그의 판매 상태를 굿즈마다 바로 확인해요.' },
  { icon: '04', title: '팬덤으로 이어지기', body: '둘러본 IP를 팔로우하고 커뮤니티 이야기까지 이어가요.' },
];

function appendVariant(href: string, variant: PrototypeVariant): string {
  const joiner = href.includes('?') ? '&' : '?';
  return `${href}${joiner}variant=${variant}`;
}

function backgroundStyle(background: string | null | undefined): CSSProperties {
  return background ? { background } : {};
}

function uniqueIps(catalog: CatalogSnapshot, curatedIds: readonly string[]): Ip[] {
  const ipById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  const ordered = curatedIds
    .map((id) => ipById.get(id))
    .filter((ip): ip is Ip => Boolean(ip));
  const seen = new Set(ordered.map((ip) => ip.id));
  return [...ordered, ...catalog.ips.filter((ip) => !seen.has(ip.id))];
}

function goodsForCollection(goods: readonly Good[], ipId: string, count = 4): Good[] {
  return goods.filter((good) => good.ip === ipId).slice(0, count);
}

function ProductCard({
  good,
  ip,
  variant,
  wished,
  onWish,
  compact = false,
}: {
  good: Good;
  ip: Ip | undefined;
  variant: PrototypeVariant;
  wished: boolean;
  onWish: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <article className={`lfp-product ${compact ? 'lfp-product--compact' : ''}`} data-stock={good.stock}>
      <div className="lfp-product__visual">
        <Link
          aria-label={`${good.name} 상세 보기`}
          className="lfp-product__image"
          href={`/shop/${good.id}?variant=${variant}`}
          style={backgroundStyle(good.img)}
        />
        {good.badge ? <span className="lfp-product__badge">{good.badge}</span> : null}
        <button
          aria-label={wished ? `${good.name} 이 화면에서만 관심 해제` : `${good.name} 이 화면에서만 관심 추가`}
          aria-pressed={wished}
          className={wished ? 'lfp-product__wish is-active' : 'lfp-product__wish'}
          onClick={() => onWish(good.id)}
          type="button"
        >
          {wished ? '♥' : '♡'}
        </button>
      </div>
      <div className="lfp-product__copy">
        <span className="lfp-product__ip">{ip?.title ?? good.type}</span>
        <Link href={`/shop/${good.id}?variant=${variant}`}>{good.name}</Link>
        <strong>{krw(good.price)}</strong>
        {good.stock === 'soldout' ? <small>품절</small> : good.stock === 'low' ? <small>품절 임박</small> : null}
      </div>
    </article>
  );
}

function ProductRows({
  goods,
  catalog,
  variant,
  wishedIds,
  toggleWish,
}: {
  goods: readonly Good[];
  catalog: CatalogSnapshot;
  variant: PrototypeVariant;
  wishedIds: ReadonlySet<string>;
  toggleWish: (id: string) => void;
}) {
  return (
    <div className="lfp-product-rows">
      {goods.map((good) => {
        const ip = catalog.ips.find((item) => item.id === good.ip);
        return (
          <article className="lfp-product-row" key={good.id}>
            <Link
              aria-label={`${good.name} 상세 보기`}
              className="lfp-product-row__image"
              href={`/shop/${good.id}?variant=${variant}`}
              style={backgroundStyle(good.img)}
            />
            <div>
              <span>{ip?.title}</span>
              <Link href={`/shop/${good.id}?variant=${variant}`}>{good.name}</Link>
              <strong>{krw(good.price)}</strong>
            </div>
            <button
              aria-label={wishedIds.has(good.id) ? `${good.name} 이 화면에서만 관심 해제` : `${good.name} 이 화면에서만 관심 추가`}
              aria-pressed={wishedIds.has(good.id)}
              onClick={() => toggleWish(good.id)}
              type="button"
            >
              {wishedIds.has(good.id) ? '♥' : '♡'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  href,
  variant,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  variant: PrototypeVariant;
}) {
  return (
    <header className="lfp-section-heading">
      <div>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {href ? <Link href={appendVariant(href, variant)}>전체 보기 <span aria-hidden>→</span></Link> : null}
    </header>
  );
}

function Hero({
  slides,
  variant,
}: {
  slides: readonly HeroSlide[];
  variant: PrototypeVariant;
}) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion || paused || slides.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, slides.length]);

  const selected = slides[index] ?? slides[0];
  if (!selected) return null;

  const move = (offset: number) => {
    setIndex((current) => (current + offset + slides.length) % slides.length);
  };

  return (
    <section
      aria-label="주요 큐레이션"
      className="lfp-hero"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={backgroundStyle(selected.background)}
    >
      <div className="lfp-hero__shade" />
      <div className="lfp-hero__content">
        <span>{selected.eyebrow}</span>
        <h1>{selected.title}</h1>
        <p>{selected.description}</p>
        <Link href={appendVariant(selected.href, variant)}>자세히 보기 <span aria-hidden>→</span></Link>
      </div>
      {slides.length > 1 ? (
        <>
          <button aria-label="이전 큐레이션" className="lfp-hero__prev" onClick={() => move(-1)} type="button">←</button>
          <button aria-label="다음 큐레이션" className="lfp-hero__next" onClick={() => move(1)} type="button">→</button>
          <div aria-label={`${index + 1} / ${slides.length}`} className="lfp-hero__progress">
            {slides.map((slide, slideIndex) => (
              <button
                aria-label={`${slideIndex + 1}번째 큐레이션`}
                aria-pressed={slideIndex === index}
                key={slide.id}
                onClick={() => setIndex(slideIndex)}
                type="button"
              ><span /></button>
            ))}
          </div>
          <button
            aria-label={paused ? '큐레이션 자동 넘김 재생' : '큐레이션 자동 넘김 일시정지'}
            aria-pressed={paused}
            className="lfp-hero__pause"
            onClick={() => setPaused((current) => !current)}
            type="button"
          >
            {paused ? '재생' : '일시정지'}
          </button>
        </>
      ) : null}
    </section>
  );
}

function EditorialRail({
  ips,
  variant,
  followed,
  postPreviewByIpId,
}: {
  ips: readonly Ip[];
  variant: PrototypeVariant;
  followed: ReadonlySet<string>;
  postPreviewByIpId: HomePostPreviewByIpId;
}) {
  return (
    <div className="lfp-editorial-rail">
      {ips.slice(0, 3).map((ip, index) => (
        <article className="lfp-editorial-card" key={ip.id}>
          <Link
            aria-label={`${ip.title} IP 보기`}
            className="lfp-editorial-card__image"
            href={`/ip/${ip.id}?variant=${variant}`}
            style={backgroundStyle(ip.bg)}
          />
          <span>{String(index + 1).padStart(2, '0')} · {followed.has(ip.id) ? '팔로우 중' : ip.v.label}</span>
          <h3><Link href={`/ip/${ip.id}?variant=${variant}`}>{ip.tagline}</Link></h3>
          <p>{postPreviewByIpId[ip.id]?.text ?? ip.synopsis}</p>
        </article>
      ))}
    </div>
  );
}

function CollectionFeature({
  ip,
  goods,
  catalog,
  variant,
  wishedIds,
  toggleWish,
  reverse = false,
}: {
  ip: Ip;
  goods: readonly Good[];
  catalog: CatalogSnapshot;
  variant: PrototypeVariant;
  wishedIds: ReadonlySet<string>;
  toggleWish: (id: string) => void;
  reverse?: boolean;
}) {
  return (
    <div className={`lfp-collection ${reverse ? 'lfp-collection--reverse' : ''}`}>
      <Link
        aria-label={`${ip.title} 컬렉션 보기`}
        className="lfp-collection__campaign"
        href={`/ip/${ip.id}?variant=${variant}`}
        style={backgroundStyle(ip.bg)}
      >
        <span>{ip.v.label}</span>
        <div><h3>{ip.title}</h3><p>{ip.tagline}</p><small>컬렉션 보기 →</small></div>
      </Link>
      <ProductRows catalog={catalog} goods={goods} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
    </div>
  );
}

function ProductGrid({
  goods,
  catalog,
  variant,
  wishedIds,
  toggleWish,
  compact = false,
}: {
  goods: readonly Good[];
  catalog: CatalogSnapshot;
  variant: PrototypeVariant;
  wishedIds: ReadonlySet<string>;
  toggleWish: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'lfp-product-grid lfp-product-grid--dense' : 'lfp-product-grid'}>
      {goods.map((good) => (
        <ProductCard
          compact={compact}
          good={good}
          ip={catalog.ips.find((ip) => ip.id === good.ip)}
          key={good.id}
          onWish={toggleWish}
          variant={variant}
          wished={wishedIds.has(good.id)}
        />
      ))}
    </div>
  );
}

function CategoryTabs({
  categories,
  selected,
  onSelect,
}: {
  categories: readonly string[];
  selected: string;
  onSelect: (category: string) => void;
}) {
  return (
    <div aria-label="굿즈 유형" className="lfp-category-tabs" role="tablist">
      {categories.map((category) => (
        <button
          aria-selected={category === selected}
          className={category === selected ? 'is-active' : undefined}
          key={category}
          onClick={() => onSelect(category)}
          role="tab"
          type="button"
        >
          {category}
        </button>
      ))}
    </div>
  );
}

function BenefitGrid() {
  return (
    <section className="lfp-benefits">
      <div className="lfp-section-inner">
        <SectionHeading description="ICONS에서 좋아하는 세계를 이어가는 방법" title="ICONS와 함께하면" variant="A" />
        <div className="lfp-benefit-grid">
          {BENEFITS.map((benefit) => (
            <article key={benefit.title}>
              <span>{benefit.icon}</span><h3>{benefit.title}</h3><p>{benefit.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LineFriendsHomePrototype({
  catalog,
  curation,
  followedIpIds,
  postPreviewByIpId,
  variant,
}: LineFriendsHomePrototypeProps) {
  const ips = useMemo(
    () => uniqueIps(catalog, curation.featuredIpIds),
    [catalog, curation.featuredIpIds],
  );
  const followed = useMemo(() => new Set(followedIpIds), [followedIpIds]);
  const [wishedIds, setWishedIds] = useState<Set<string>>(() => new Set());
  const [wishStatus, setWishStatus] = useState('');
  const categories = useMemo(
    () => ['전체', ...Array.from(new Set(catalog.goods.map((good) => good.type))).slice(0, 5)],
    [catalog.goods],
  );
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [popularIpId, setPopularIpId] = useState(ips[0]?.id ?? '');

  const toggleWish = (id: string) => {
    setWishedIds((current) => {
      const next = new Set(current);
      const good = catalog.goods.find((item) => item.id === id);
      if (next.has(id)) {
        next.delete(id);
        setWishStatus(`${good?.name ?? '굿즈'}의 화면 전용 관심 표시를 해제했습니다.`);
      } else {
        next.add(id);
        setWishStatus(`${good?.name ?? '굿즈'}를 이 화면에서만 관심 표시했습니다.`);
      }
      return next;
    });
  };

  const categoryGoods = selectedCategory === '전체'
    ? catalog.goods.slice(0, 8)
    : catalog.goods.filter((good) => good.type === selectedCategory).slice(0, 8);
  const popularGoods = catalog.goods.filter((good) => good.ip === popularIpId).slice(0, 4);
  const firstIp = ips[0];
  const secondIp = ips[1] ?? firstIp;

  const heroSlides = useMemo<HeroSlide[]>(() => {
    const curatedHero = curation.hero && (curation.hero.imageBg || ips[0]?.bg)
      ? [{
          id: curation.hero.id,
          title: curation.hero.title,
          description: ips[0]?.tagline ?? 'ICONS의 새로운 큐레이션을 만나보세요.',
          eyebrow: 'ICONS CURATION',
          href: curation.hero.href,
          background: curation.hero.imageBg ?? ips[0]?.bg ?? '#121212',
        }]
      : [];
    const ipSlides = ips.slice(0, 5).map((ip) => ({
      id: ip.id,
      title: ip.title,
      description: ip.tagline,
      eyebrow: ip.v.label,
      href: `/ip/${ip.id}`,
      background: ip.bg,
    }));
    const seen = new Set(curatedHero.map((slide) => slide.href));
    return [...curatedHero, ...ipSlides.filter((slide) => !seen.has(slide.href))];
  }, [curation.hero, ips]);

  const announcement = curation.announcement;

  const sharedCategory = (
    <>
      <CategoryTabs categories={categories} onSelect={setSelectedCategory} selected={selectedCategory} />
      <ProductGrid
        catalog={catalog}
        goods={categoryGoods.slice(0, variant === 'B' ? 8 : 4)}
        toggleWish={toggleWish}
        variant={variant}
        wishedIds={wishedIds}
      />
    </>
  );

  return (
    <StorefrontChrome currentPage="home" variant={variant}>
      <p aria-live="polite" className="lfp-local-status" role="status">{wishStatus}</p>
      <div className="lfp-home" data-home-variant={variant}>
        {variant === 'A' ? (
          <>
            <Hero slides={heroSlides} variant={variant} />

            <section className="lfp-section lfp-editorial-section">
              <div className="lfp-section-inner">
                <SectionHeading description="지금 눈여겨볼 세 가지 IP 이야기" eyebrow="EDITOR'S PROPOSAL" title="에디터의 제안" variant={variant} />
                <EditorialRail followed={followed} ips={ips} postPreviewByIpId={postPreviewByIpId} variant={variant} />
              </div>
            </section>

            {firstIp ? (
              <section className="lfp-section">
                <div className="lfp-section-inner">
                  <SectionHeading description={firstIp.synopsis} href={`/ip/${firstIp.id}`} title="추천 컬렉션" variant={variant} />
                  <CollectionFeature catalog={catalog} goods={goodsForCollection(catalog.goods, firstIp.id)} ip={firstIp} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                </div>
              </section>
            ) : null}

            <section className="lfp-section lfp-category-section">
              <div className="lfp-section-inner lfp-category-layout">
                <div className="lfp-category-layout__heading">
                  <SectionHeading description="유형별로 빠르게 찾는 현재 굿즈" title="카테고리 베스트" variant={variant} />
                  <CategoryTabs categories={categories} onSelect={setSelectedCategory} selected={selectedCategory} />
                </div>
                <ProductGrid catalog={catalog} goods={categoryGoods.slice(0, 4)} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
              </div>
            </section>

            {secondIp ? (
              <section className="lfp-section">
                <div className="lfp-section-inner">
                  <SectionHeading description={secondIp.synopsis} href={`/ip/${secondIp.id}`} title="새로운 IP 컬렉션" variant={variant} />
                  <CollectionFeature catalog={catalog} goods={goodsForCollection(catalog.goods, secondIp.id)} ip={secondIp} reverse toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                </div>
              </section>
            ) : null}

            {announcement ? (
              <section className="lfp-section lfp-announcement">
                <Link href={appendVariant(announcement.href, variant)} style={backgroundStyle(announcement.imageBg)}>
                  <span>ICONS NOW</span><h2>{announcement.title}</h2><small>자세히 보기 →</small>
                </Link>
              </section>
            ) : null}

            <section className="lfp-section lfp-popular-section">
              <div className="lfp-section-inner lfp-category-layout">
                <div className="lfp-category-layout__heading">
                  <SectionHeading description="다시 찾게 되는 IP별 굿즈" title="인기 굿즈" variant={variant} />
                  <div aria-label="IP 선택" className="lfp-category-tabs" role="tablist">
                    {ips.slice(0, 5).map((ip) => (
                      <button aria-selected={popularIpId === ip.id} className={popularIpId === ip.id ? 'is-active' : undefined} key={ip.id} onClick={() => setPopularIpId(ip.id)} role="tab" type="button">{ip.title}</button>
                    ))}
                  </div>
                </div>
                {popularGoods.length > 0 ? (
                  <ProductGrid catalog={catalog} goods={popularGoods} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                ) : (
                  <p className="lfp-product-empty" role="status">선택한 IP에 현재 등록된 굿즈가 없습니다.</p>
                )}
              </div>
            </section>

            <BenefitGrid />
          </>
        ) : null}

        {variant === 'B' ? (
          <>
            <section className="lfp-commerce-hero">
              {firstIp ? (
                <Link className="lfp-commerce-hero__campaign" href={`/ip/${firstIp.id}?variant=${variant}`} style={backgroundStyle(firstIp.bg)}>
                  <span>{firstIp.v.label}</span><h1>{firstIp.tagline}</h1><p>{firstIp.synopsis}</p><small>IP 컬렉션 보기 →</small>
                </Link>
              ) : null}
              <div className="lfp-commerce-hero__goods">
                <SectionHeading description="현재 카탈로그에서 바로 고르기" title="새로 만나는 굿즈" variant={variant} />
                <ProductGrid catalog={catalog} compact goods={catalog.goods.slice(0, 4)} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
              </div>
            </section>

            <section className="lfp-section lfp-commerce-category">
              <div className="lfp-section-inner">
                <SectionHeading description="탐색 시간을 줄인 촘촘한 굿즈 보드" href="/shop" title="굿즈부터 빠르게" variant={variant} />
                {sharedCategory}
              </div>
            </section>

            <section className="lfp-section lfp-commerce-strip">
              <div className="lfp-section-inner">
                <EditorialRail followed={followed} ips={ips.slice(1)} postPreviewByIpId={postPreviewByIpId} variant={variant} />
              </div>
            </section>

            {secondIp ? (
              <section className="lfp-section">
                <div className="lfp-section-inner">
                  <SectionHeading description="굿즈 목록 다음에 깊게 보는 IP 세계" title="하나의 IP, 하나의 컬렉션" variant={variant} />
                  <CollectionFeature catalog={catalog} goods={goodsForCollection(catalog.goods, secondIp.id)} ip={secondIp} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                </div>
              </section>
            ) : null}
            <BenefitGrid />
          </>
        ) : null}

        {variant === 'C' ? (
          <>
            <section className="lfp-story-intro">
              <span>ICONS EDITORIAL</span>
              <h1>좋아하는 세계를<br />천천히 발견하는 순서</h1>
              <p>IP의 이야기에서 시작해 지금 만날 수 있는 굿즈까지 이어집니다.</p>
            </section>

            <section className="lfp-section lfp-story-editorial">
              <div className="lfp-section-inner">
                <EditorialRail followed={followed} ips={ips} postPreviewByIpId={postPreviewByIpId} variant={variant} />
              </div>
            </section>

            <div className="lfp-story-hero"><Hero slides={heroSlides} variant={variant} /></div>

            <section className="lfp-section lfp-story-goods">
              <div className="lfp-section-inner">
                <SectionHeading description="이야기의 장면을 소장하는 현재 굿즈" href="/shop" title="스토리에서 굿즈로" variant={variant} />
                <ProductGrid catalog={catalog} goods={catalog.goods.slice(0, 4)} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
              </div>
            </section>

            {firstIp ? (
              <section className="lfp-section lfp-story-collection">
                <div className="lfp-section-inner">
                  <CollectionFeature catalog={catalog} goods={goodsForCollection(catalog.goods, firstIp.id)} ip={firstIp} toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                </div>
              </section>
            ) : null}

            {secondIp ? (
              <section className="lfp-section lfp-story-collection lfp-story-collection--second">
                <div className="lfp-section-inner">
                  <CollectionFeature catalog={catalog} goods={goodsForCollection(catalog.goods, secondIp.id)} ip={secondIp} reverse toggleWish={toggleWish} variant={variant} wishedIds={wishedIds} />
                </div>
              </section>
            ) : null}

            <BenefitGrid />
          </>
        ) : null}
      </div>
      <PrototypeSwitcher variant={variant} />
    </StorefrontChrome>
  );
}
