import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CollectionBanner } from '@/lib/collection-banners';
import type { Good } from '@/lib/data';
import type { ListingSortOrders } from '@/lib/listing-sorts';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  ranking: [] as string[] | null,
  rankingPeriods: [] as string[],
  orders: null as ListingSortOrders | null,
  orderLoads: 0,
  banners: [] as CollectionBanner[],
  bannerSlots: [] as string[],
}));
vi.mock('@/lib/collection-banners.server', () => ({
  getCollectionBanners: async (slot: string) => {
    mocks.bannerSlots.push(slot);
    return mocks.banners.filter((banner) => banner.slot === slot);
  },
}));
vi.mock('@/lib/goods-listing-orders.server', () => ({
  loadSalesRanking: async (period: string) => { mocks.rankingPeriods.push(period); return mocks.ranking; },
  loadListingSortOrders: async () => { mocks.orderLoads += 1; return mocks.orders; },
}));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => ({ viewerId: null, goodIds: [] }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/best',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async (): Promise<CatalogSnapshot> => snapshot(),
}));

function good(id: string, name: string, price: number): Good {
  return {
    id,
    ip: 'ip1',
    name,
    type: '키링',
    price,
    badge: null,
    stock: 'ok',
    stockQty: 5,
    img: 'none',
  };
}

function snapshot(): CatalogSnapshot {
  return {
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
    goods: [good('a', '1위 굿즈', 30000), good('b', '2위 굿즈', 10000), good('c', '랭킹 밖 굿즈', 20000)],
    cards: [],
    events: [],
  };
}

async function render(params: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

function collectionBanner(id: string, slot: CollectionBanner['slot']): CollectionBanner {
  return { id, slot, title: `배너 ${id}`, subtitle: null, imageUrl: `https://cdn.test/${id}.webp`, mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black', endsAt: null };
}

const currentTab = (html: string) => [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);

beforeEach(() => {
  mocks.ranking = ['a', 'b'];
  mocks.rankingPeriods = [];
  mocks.orders = null;
  mocks.orderLoads = 0;
  mocks.banners = [];
  mocks.bannerSlots = [];
});

describe('/shop/best page', () => {
  it('실화면이므로 색인을 막지 않는다', () => {
    expect(metadata).toMatchObject({
      title: 'BEST — ICONS',
      description: '지금 가장 사랑받는 굿즈예요.',
    });
    expect(metadata.robots).toBeUndefined();
  });

  it('기본은 실시간 판매 랭킹 순서이고 랭킹 밖 굿즈는 담지 않는다', async () => {
    mocks.ranking = ['b', 'a'];
    const html = await render();

    expect(mocks.rankingPeriods).toEqual(['realtime']);
    expect(html).toMatch(/<h1[^>]*>BEST<\/h1>/);
    expect(currentTab(html)).toEqual(['실시간']);
    expect(html.indexOf('2위 굿즈')).toBeLessThan(html.indexOf('1위 굿즈'));
    expect(html).not.toContain('랭킹 밖 굿즈');
    /* 게스트에게도 카드 하트가 보인다(누르면 로그인 벽 — CL-01). */
    expect((html.match(/<button[^>]*class="wc-list-heart"/g) ?? []).length).toBe(2);
  });

  it('?period 를 그 기간 랭킹으로 읽고 잘못된 값은 실시간으로 떨어뜨린다', async () => {
    for (const period of ['daily', 'weekly', 'monthly']) {
      mocks.rankingPeriods = [];
      const html = await render({ period });
      expect(mocks.rankingPeriods, period).toEqual([period]);
      expect(currentTab(html), period).toEqual([{ daily: '일간', weekly: '주간', monthly: '월간' }[period]]);
    }

    mocks.rankingPeriods = [];
    const bad = await render({ period: 'yearly' });
    expect(mocks.rankingPeriods).toEqual(['realtime']);
    expect(currentTab(bad)).toEqual(['실시간']);
  });

  it('셀렉트 정렬은 랭킹 목록 안에서만 다시 줄 세우고 정렬 순서는 필요할 때만 읽는다', async () => {
    mocks.ranking = ['a', 'b'];
    const html = await render({ sort: 'price_asc' });

    expect(html.indexOf('2위 굿즈')).toBeLessThan(html.indexOf('1위 굿즈'));
    expect(html).not.toContain('랭킹 밖 굿즈');
    expect(html).toMatch(/<option[^>]*value="price_asc"[^>]*selected/);
    expect(mocks.orderLoads).toBe(0);

    mocks.orders = { popular: ['c', 'b', 'a'], sales: [], reviews: [] };
    const popular = await render({ sort: 'popular' });
    expect(mocks.orderLoads).toBe(1);
    expect(popular.indexOf('2위 굿즈')).toBeLessThan(popular.indexOf('1위 굿즈'));
    expect(popular).not.toContain('랭킹 밖 굿즈');
  });

  it('필터 쿼리와 이름순은 읽지 않는다 — 결과가 같다', async () => {
    expect(await render({ ip: 'ghost', min: '1', type: '인형', sort: 'name_asc' })).toBe(await render());
  });

  it('랭킹이 비면(집계된 굿즈 없음) 기간 탭은 남기고 "이 기간에 집계된 굿즈가 없어요" 안내를 그린다', async () => {
    mocks.ranking = [];
    const html = await render({ period: 'weekly' });

    expect(html).toContain('이 기간에 집계된 굿즈가 없어요');
    expect(html).toContain('다른 기간을 골라 보세요.');
    expect(currentTab(html)).toEqual(['주간']);
    expect(html).not.toContain('wc-x-grid');
  });

  it('랭킹을 읽지 못하면(null) 가짜 순위 대신 실패 안내를 그린다', async () => {
    mocks.ranking = null;
    const html = await render();

    expect(html).toContain('순위를 불러오지 못했어요.');
    expect(html).toContain('잠시 후 다시 확인해주세요.');
    expect(html).not.toContain('이 기간에 집계된 굿즈가 없어요');
    expect(html).not.toContain('wc-x-grid');
  });

  it('BEST 배너는 그 슬롯만 읽어 한 장 스트립 배너로 그리고 제목 줄은 그대로다(CL-09)', async () => {
    mocks.banners = [collectionBanner('b1', 'best'), collectionBanner('n1', 'new')];
    const html = await render();

    expect(mocks.bannerSlots).toEqual(['best']);
    expect(html).toContain('wc-strip-banners');
    expect(html).toContain('배너 b1');
    expect(html).not.toContain('배너 n1');
    expect(html).toMatch(/<h1[^>]*>BEST<\/h1>/);
  });
});
