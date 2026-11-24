import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good } from '@/lib/data';
import type { ListingSortOrders } from '@/lib/listing-sorts';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({ goods: [] as Good[], orders: null as ListingSortOrders | null, orderLoads: 0 }));
const bannerMocks = vi.hoisted(() => ({ slots: [] as string[], enabled: false }));
vi.mock('@/lib/collection-banners.server', () => ({
  getCollectionBanners: async (slot: string) => {
    bannerMocks.slots.push(slot);
    return bannerMocks.enabled
      ? [{ id: 'n1', slot, title: 'NEW 배너', subtitle: null, imageUrl: 'https://cdn.test/n1.webp', mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black', endsAt: null }]
      : []
  },
}));
vi.mock('@/lib/goods-listing-orders.server', () => ({
  loadListingSortOrders: async () => { mocks.orderLoads += 1; return mocks.orders; },
}));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => ({ viewerId: 'viewer-1', goodIds: ['a'] }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/new',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async (): Promise<CatalogSnapshot> => ({
    source: 'supabase',
    verticals: [],
    ips: [{
      id: 'ip1',
      title: '홍실',
      sub: '',
      v: { key: 'story', label: '스토리', color: '#111' },
      glyph: '◆',
      bg: 'none',
      fans: 0,
      goods: 0,
      cards: 0,
      featured: false,
      tagline: '',
      synopsis: '',
    }],
    goods: mocks.goods,
    events: [],
  }),
}));

function good(id: string, overrides: Partial<Good> = {}): Good {
  return {
    id,
    ip: 'ip1',
    name: `굿즈 ${id}`,
    price: 10000,
    badge: null,
    stock: 'ok',
    stockQty: 5,
    img: 'none',
    ...overrides,
  };
}

async function render(params: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  mocks.orders = null;
  mocks.orderLoads = 0;
});

describe('/shop/new page', () => {
  it('실화면이므로 색인을 막지 않는다', () => {
    expect(metadata).toMatchObject({
      title: 'NEW — 엑스스퀘어',
      description: '새로 나온 굿즈를 모아 봤어요.',
    });
    expect(metadata.robots).toBeUndefined();
  });

  it('NEW 배지 굿즈만 담은 목록을 Figma 머리(제목 + 탭 줄)로 그린다', async () => {
    mocks.goods = [
      good('a', { name: '신상 키링', badge: 'NEW' }),
      good('b', { name: '평범한 키링' }),
    ];
    const html = await render();

    expect(html).toContain('class="wc-root wc-listing"');
    expect(html).toMatch(/<h1[^>]*>NEW<\/h1>/);
    expect(html).toContain('신상 키링');
    expect(html).not.toContain('평범한 키링');
    expect(html).toContain('<nav aria-label="정렬" class="wc-listing-tabs">');
    expect(html).not.toContain('wc-filter-group');
    expect(html).not.toContain('<select');
  });

  /* 목록 페이지는 로그인 회원의 위시 ID 집합을 한 번 읽어 카드 하트의 초기 상태로 내려 준다(CL-01). */
  it('passes the listing wish set to the card hearts', async () => {
    mocks.goods = [good('a', { name: '신상 키링', badge: 'NEW' })];
    const html = await render();

    expect(html).toContain('aria-label="신상 키링 위시리스트에서 빼기"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('가격순 탭은 URL 의 sort 로 선택되고 그 순서로 줄 세운다', async () => {
    mocks.goods = [
      good('a', { name: '비싼 신상', badge: 'NEW', price: 30000 }),
      good('b', { name: '싼 신상', badge: 'NEW', price: 10000 }),
    ];
    const html = await render({ sort: 'price_asc' });

    expect(html.indexOf('싼 신상')).toBeLessThan(html.indexOf('비싼 신상'));
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['낮은 가격순']);
    expect(mocks.orderLoads).toBe(0);
  });

  it('필터 쿼리(?ip·?min·?type)는 읽지 않는다 — 결과가 같다', async () => {
    mocks.goods = [
      good('a', { name: '싼 신상', badge: 'NEW', price: 10000 }),
      good('b', { name: '비싼 신상', badge: 'NEW', price: 30000, }),
    ];
    const filtered = await render({ ip: 'ghost', min: '20000', type: '피규어' });

    expect(filtered).toBe(await render());
    expect(filtered).toContain('싼 신상');
    expect(filtered).toContain('비싼 신상');
  });

  it('기본은 최신 등록순이고 추천순·이름순 같은 화면에 없는 정렬은 기본값으로 떨어진다', async () => {
    mocks.goods = [
      good('old', { name: '옛 신상', badge: 'NEW', createdAt: '2026-08-01T00:00:00Z' }),
      good('new', { name: '새 신상', badge: 'NEW', createdAt: '2026-10-01T00:00:00Z' }),
    ];

    for (const params of [{}, { sort: 'recommended' }, { sort: 'name_asc' }, { sort: 'oldest' }]) {
      const html = await render(params);
      expect(html.indexOf('새 신상'), JSON.stringify(params)).toBeLessThan(html.indexOf('옛 신상'));
      expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['최신 등록순']);
    }
  });

  it('인기도·판매량·리뷰 많은순 탭일 때만 DB 정렬 순서를 읽어 그 순서로 줄 세운다', async () => {
    mocks.goods = [
      good('a', { name: '첫째', badge: 'NEW' }),
      good('b', { name: '둘째', badge: 'NEW' }),
      good('c', { name: '셋째', badge: 'NEW' }),
    ];
    mocks.orders = { popular: ['c', 'b'], sales: ['b', 'a'], reviews: [] };

    await render({ sort: 'price_asc' });
    expect(mocks.orderLoads).toBe(0);

    const popular = await render({ sort: 'popular' });
    expect(mocks.orderLoads).toBe(1);
    expect(popular.indexOf('셋째')).toBeLessThan(popular.indexOf('둘째'));
    expect(popular.indexOf('둘째')).toBeLessThan(popular.indexOf('첫째'));

    const sales = await render({ sort: 'sales' });
    expect(sales.indexOf('둘째')).toBeLessThan(sales.indexOf('첫째'));
    expect(sales.indexOf('첫째')).toBeLessThan(sales.indexOf('셋째'));
  });

  it('DB 정렬 순서를 읽지 못해도 목록은 스코프 순서로 그려진다(목록을 막지 않는다)', async () => {
    mocks.goods = [good('a', { name: '첫째', badge: 'NEW' }), good('b', { name: '둘째', badge: 'NEW' })];
    mocks.orders = null;
    const html = await render({ sort: 'sales' });

    expect(html.indexOf('첫째')).toBeLessThan(html.indexOf('둘째'));
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['판매량순']);
  });

  it('NEW 굿즈가 없으면 준비 중 안내와 굿즈샵 링크만 남긴다', async () => {
    mocks.goods = [good('b', { name: '평범한 키링' })];
    const html = await render();

    expect(html).toContain('아직 준비 중이에요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-x-grid');
  });

  it('NEW 슬롯 배너를 읽어 콘텐츠 폭 스트립 배너로 그린다(CL-09)', async () => {
    mocks.goods = [good('a', { name: '신상 키링', badge: 'NEW' })];
    bannerMocks.slots = [];
    bannerMocks.enabled = true;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    bannerMocks.enabled = false;

    expect(bannerMocks.slots).toEqual(['new']);
    expect(html).toContain('wc-strip-banners');
    expect(html).toContain('NEW 배너');
  });
});
