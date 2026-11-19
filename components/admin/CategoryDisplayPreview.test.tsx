import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, Stock } from '@/lib/data';
import type { CategoryDisplayPage } from '@/lib/category-display';
import type { HomeGoodsCard, HomeHeroSlide } from '@/lib/home-catalog';
import type { HomeProductCollectionBand } from '@/lib/home-product-collection';
import type { ShopListQuery } from '@/lib/shop-catalog';
import { CategoryDisplayPreviewBody } from './CategoryDisplayPreview';

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';

function good(id: string, overrides: Partial<Good> = {}): Good {
  return {
    id, ip: 'ip1', name: `전시 굿즈 ${id}`, price: 10000, badge: null, stock: 'ok' as Stock, stockQty: 10,
    img: 'linear-gradient(#111, #222)', ...overrides,
  };
}

function card(id: string): HomeGoodsCard {
  return { id, name: `추천 굿즈 ${id}`, brand: '홍실', price: 12000, badge: null, imageBg: 'linear-gradient(#111, #222)', href: `/shop/${id}`, soldOut: false };
}

const slide: HomeHeroSlide = {
  id: 'category-banner', title: '겨울 전시 배너', subtitle: '따뜻한 굿즈', imageUrl: 'https://cdn.test/banner.webp', mobileImageUrl: null,
  href: '/shop/new', imageAlt: '', imageDim: 'none', textColor: 'black',
};

const band: HomeProductCollectionBand = { id: 'recommendations', title: '추천 굿즈 모음', layout: 'list', imageShape: 'square', goods: [card('r1'), card('r2'), card('r3')] };

function query(overrides: Partial<ShopListQuery> = {}): ShopListQuery {
  return { displayCategory: CATEGORY_ID, view: 'all', ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended', ...overrides };
}

function page(overrides: Partial<CategoryDisplayPage> = {}): CategoryDisplayPage {
  const goods = [good('g1'), good('g2')];
  return {
    category: { id: CATEGORY_ID, name: '겨울 전시' }, checkedAt: '2026-11-17T00:00:00Z', token: '0'.repeat(32), offset: 0, nextOffset: null,
    query: query(), result: { goods, filteredTotal: goods.length, total: goods.length, priceCeil: 10000, ipFacets: [], typeFacets: [] },
    navigation: [], banner: slide, video: null, recommendations: null, ...overrides,
  };
}

function render(value: CategoryDisplayPage) {
  return renderToStaticMarkup(<CategoryDisplayPreviewBody page={value} onQueryChange={() => undefined} />);
}

describe('어드민 카테고리 전시 미리보기 본문', () => {
  it('고객 화면과 같은 틀로 전시 배너를 스트립 배너로 그린다(옛 전폭 히어로가 아니다)', () => {
    const html = render(page());

    expect(html).toContain('data-slot="category"');
    expect(html).toContain('aria-label="카테고리 배너"');
    expect(html).toContain('wc-strip-banners__single');
    expect(html).toContain('겨울 전시 배너');
    // 옛 모양: 전폭 히어로 캐러셀과 그 래퍼 클래스.
    expect(html).not.toContain('wc-category-display__banner');
    expect(html).not.toContain('aria-roledescription="carousel"');
  });

  it('제목 줄·정렬·그리드가 같은 Shop 틀에서 배너 아래에 선다', () => {
    const html = render(page());

    expect(html).toContain('<h1 class="wc-listing-head__title">겨울 전시</h1>');
    expect(html.indexOf('wc-strip-banners')).toBeLessThan(html.indexOf('wc-listing-head'));
    expect(html).toContain('전시 굿즈 g1');
    expect(html).toContain('전시 굿즈 g2');
  });

  it('배너를 끈 전시와 굿즈가 없는 전시는 배너를 그리지 않는다', () => {
    expect(render(page({ banner: null }))).not.toContain('wc-strip-banners');

    const empty = page({ result: { goods: [], filteredTotal: 0, total: 0, priceCeil: 0, ipFacets: [], typeFacets: [] } });
    const html = render(empty);
    expect(html).not.toContain('wc-strip-banners');
    expect(html).toContain('아직 준비 중이에요');
  });

  it('질의에 전시 id 가 없어도 배너가 빠지지 않는다', () => {
    const { displayCategory: _omitted, ...withoutCategory } = query();
    void _omitted;

    expect(render(page({ query: withoutCategory }))).toContain('wc-strip-banners');
  });

  it('추천 밴드와 영상은 고객 화면처럼 배너 아래·제목 줄 위에 낀다', () => {
    const html = render(page({ recommendations: band }));

    expect(html).toContain('wc-category-display');
    expect(html).toContain('추천 굿즈 모음');
    expect(html).toContain('추천 굿즈 r1');
    expect(html.indexOf('wc-strip-banners')).toBeLessThan(html.indexOf('추천 굿즈 모음'));
    expect(html.indexOf('추천 굿즈 모음')).toBeLessThan(html.indexOf('wc-listing-head'));
  });

  it('추천이 없으면 전시 밴드 래퍼도 그리지 않는다', () => {
    expect(render(page())).not.toContain('wc-category-display');
  });

  it('첫 20개만 보여 주는 안내는 20개를 넘는 전시에서만 선다', () => {
    const many = Array.from({ length: 20 }, (_, index) => good(`m${index + 1}`));
    const html = render(page({ result: { goods: many, filteredTotal: 25, total: 25, priceCeil: 10000, ipFacets: [], typeFacets: [] }, nextOffset: 20 }));

    expect(html).toContain('전체 25개 중 첫 20개를 미리 봅니다.');
    expect(render(page())).not.toContain('첫 20개를 미리 봅니다');
  });
});
