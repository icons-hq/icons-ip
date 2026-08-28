import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { WishlistEntry } from '@/lib/wishlist.server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'fan@icons.gg' } as { id: string; email: string | null } | null,
  entries: [] as WishlistEntry[],
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  usePathname: () => '/my/wishlist',
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: async () => ({
    isConfigured: true,
    user: mocks.user,
    profile: null,
    isStaff: false,
  }),
}));
vi.mock('@/lib/wishlist.server', () => ({
  getWishlistEntries: async () => mocks.entries,
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async () => catalog,
}));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({
    items: [],
    count: 0,
    ready: true,
    mode: 'server' as const,
    pending: false,
    error: null,
    getQuantity: () => 0,
    add: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    resetForSignOut: vi.fn(),
  }),
}));

const catalog = {
  source: 'supabase',
  verticals: [],
  ips: [{
    id: 'hong-sil-quest',
    title: '홍실',
    sub: '리디 · 로판',
    v: { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' },
    glyph: '홍실',
    bg: 'none',
    fans: 1,
    goods: 1,
    cards: 0,
    featured: false,
  }],
  goods: [{
    id: 'g13',
    name: '홍실 아크릴 블록',
    ip: 'hong-sil-quest',
    type: '아크릴',
    price: 12000,
    compareAtPrice: 16000,
    badge: null,
    stock: 'ok' as const,
    stockQty: 20,
    img: 'none',
  }],
  cards: [],
  events: [],
} as unknown as CatalogSnapshot;

async function render() {
  return renderToStaticMarkup(await Page());
}

describe('/my/wishlist page', () => {
  beforeEach(() => {
    mocks.user = { id: 'user-1', email: 'fan@icons.gg' };
    mocks.entries = [];
    mocks.push.mockReset();
  });

  it('keeps the personal list out of search indexes', () => {
    expect(metadata).toMatchObject({
      title: '위시리스트 — ICONS',
      robots: { index: false, follow: false },
    });
  });

  /* 로그인 없이 열면 빈 목록이 "찜한 게 없다"는 거짓말이 된다 — 진입에서 막는다. */
  it('sends a guest to login with the wishlist as the return path', async () => {
    mocks.user = null;

    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Fwishlist');
  });

  it('renders the empty state with a way back to the shop', async () => {
    const html = await render();

    expect(html).toContain('아직 찜한 굿즈가 없어요');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵 둘러보기');
  });

  it('lists a wished good with its price, detail link and an unwish control', async () => {
    mocks.entries = [{ goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' }];

    const html = await render();

    expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('href="/shop/g13"');
    expect(html).toContain('₩12,000');
    expect(html).toContain('₩16,000');
    expect(html).toContain('aria-label="위시리스트에서 빼기"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('아직 찜한 굿즈가 없어요');
  });

  /* 카탈로그에서 빠진 굿즈의 행을 조용히 지우면 사용자는 자기가 해제한 줄 안다. */
  it('keeps a delisted good as a 판매 종료 row instead of dropping it', async () => {
    mocks.entries = [{ goodId: 'gone', createdAt: '2026-08-28T00:00:00.000Z' }];

    const html = await render();

    expect(html).toContain('판매 종료');
    expect(html).toContain('aria-label="위시리스트에서 빼기"');
    expect(html).not.toContain('아직 찜한 굿즈가 없어요');
  });
});
