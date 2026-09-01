import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good } from '@/lib/data';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({ goods: [] as Good[] }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/new',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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
    cards: [],
    events: [],
  }),
}));

function good(id: string, overrides: Partial<Good> = {}): Good {
  return {
    id,
    ip: 'ip1',
    name: `굿즈 ${id}`,
    type: '키링',
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

describe('/shop/new page', () => {
  it('실화면이므로 색인을 막지 않는다', () => {
    expect(metadata).toMatchObject({
      title: 'NEW — ICONS',
      description: '새로 나온 굿즈를 모아 봤어요.',
    });
    expect(metadata.robots).toBeUndefined();
  });

  it('NEW 배지 굿즈만 담은 컬렉션을 그린다', async () => {
    mocks.goods = [
      good('a', { name: '신상 키링', badge: 'NEW' }),
      good('b', { name: '평범한 키링' }),
    ];
    const html = await render();

    expect(html).toContain('class="wc-root wc-collection"');
    expect(html).toMatch(/<h1[^>]*>NEW<\/h1>/);
    expect(html).toContain('신상 키링');
    expect(html).not.toContain('평범한 키링');
    expect(html.replace(/<[^>]+>/g, '')).toContain('전체 1개 굿즈');
  });

  it('URL 의 필터·정렬 파라미터를 그대로 목록에 반영한다', async () => {
    mocks.goods = [
      good('a', { name: '비싼 신상', badge: 'NEW', price: 30000 }),
      good('b', { name: '싼 신상', badge: 'NEW', price: 10000 }),
    ];
    const html = await render({ sort: 'price_asc' });

    expect(html.indexOf('싼 신상')).toBeLessThan(html.indexOf('비싼 신상'));
    expect(html).toMatch(/<option[^>]*value="price_asc"[^>]*selected/);
  });

  it('NEW 굿즈가 없으면 준비 중 안내와 굿즈샵 링크만 남긴다', async () => {
    mocks.goods = [good('b', { name: '평범한 키링' })];
    const html = await render();

    expect(html).toContain('아직 준비 중이에요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-product-grid');
  });
});
