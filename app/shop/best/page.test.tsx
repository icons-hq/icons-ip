import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot, HomeSnapshot } from '@/lib/catalog';
import type { Good } from '@/lib/data';
import type { HomeBestTab, HomeGoodsCard } from '@/lib/home-catalog';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  categoryBestTabs: [] as HomeBestTab[],
  popularTabs: [] as HomeBestTab[],
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/best',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/catalog', () => ({
  getHomeSnapshot: async (): Promise<HomeSnapshot> => ({
    catalog: snapshot(),
    curation: {
      hero: null,
      announcement: null,
      featuredIpIds: [],
      heroSlides: [],
      editorPicks: [],
      goodsBands: [],
      categoryBestTabs: mocks.categoryBestTabs,
      popularTabs: mocks.popularTabs,
      benefitTiles: [],
    },
    postPreviewByIpId: {},
  }),
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
    goods: [good('a', '1위 굿즈', 30000), good('b', '2위 굿즈', 10000), good('c', '큐레이션 밖 굿즈', 20000)],
    cards: [],
    events: [],
  };
}

function tab(id: string, goodIds: string[]): HomeBestTab {
  return {
    id,
    label: id,
    goods: goodIds.map((goodId): HomeGoodsCard => ({
      id: goodId,
      name: goodId,
      brand: '홍실',
      price: 0,
      badge: null,
      imageBg: 'none',
      href: `/shop/${goodId}`,
      soldOut: false,
    })),
  };
}

async function render(params: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

describe('/shop/best page', () => {
  it('실화면이므로 색인을 막지 않는다', () => {
    expect(metadata).toMatchObject({
      title: 'BEST — ICONS',
      description: '지금 가장 사랑받는 굿즈예요.',
    });
    expect(metadata.robots).toBeUndefined();
  });

  it('카테고리 BEST → 인기템 순서의 큐레이션 굿즈만 그린다', async () => {
    mocks.categoryBestTabs = [tab('키링', ['a'])];
    mocks.popularTabs = [tab('인기', ['b', 'a'])];
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>BEST<\/h1>/);
    expect(html).toContain('지금 가장 사랑받는 굿즈예요.');
    expect(html.replace(/<[^>]+>/g, '')).toContain('전체 2개 굿즈');
    expect(html.indexOf('1위 굿즈')).toBeLessThan(html.indexOf('2위 굿즈'));
    expect(html).not.toContain('큐레이션 밖 굿즈');
  });

  it('큐레이션 스코프 안에서만 정렬을 다시 매긴다', async () => {
    mocks.categoryBestTabs = [tab('키링', ['a', 'b'])];
    mocks.popularTabs = [];
    const html = await render({ sort: 'price_asc' });

    expect(html.indexOf('2위 굿즈')).toBeLessThan(html.indexOf('1위 굿즈'));
    expect(html).not.toContain('큐레이션 밖 굿즈');
  });

  it('큐레이션이 비면 가짜 순위 대신 준비 중 안내를 그린다', async () => {
    mocks.categoryBestTabs = [];
    mocks.popularTabs = [];
    const html = await render();

    expect(html).toContain('아직 준비 중이에요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-product-grid');
  });
});
