import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorePresentationProvider } from '@/components/shell/StorePresentationProvider';
import type { CatalogSnapshot } from '@/lib/catalog';
import { DEFAULT_STORE_PRESENTATION } from '@/lib/store-presentation';
import type { WishlistEntry } from '@/lib/wishlist.server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  user: { id: '00000000-0000-4000-8000-000000000501', email: 'fan@icons.gg' } as { id: string; email: string | null } | null,
  entries: [] as WishlistEntry[],
  follows: [] as string[] | null,
  cartQuantity: 0,
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
vi.mock('@/lib/my-follows.server', () => ({
  loadMyFollowedIpIds: async () => mocks.follows,
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async () => catalog,
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('@/app/ip/actions', () => ({ toggleIpFollowAction: vi.fn() }));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({
    items: [],
    count: 0,
    ready: true,
    mode: 'server' as const,
    pending: false,
    error: null,
    getQuantity: () => mocks.cartQuantity,
    add: vi.fn(),
    addSelection: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    resetForSignOut: vi.fn(),
  }),
}));

const VARIANT = '00000000-0000-4000-8000-0000000005a1';

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
  }, {
    id: 'maplestory',
    title: '메이플스토리',
    sub: '넥슨 · 게임',
    v: { key: 'game', label: '게임', color: '#38F0C0' },
    glyph: '메이플',
    bg: 'none',
    fans: 1,
    goods: 0,
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
    options: [{ id: VARIANT, name: '기본', code: 'G13', price: 12000, stockQty: 20, isDefault: true, attributes: {} }],
  }, {
    id: 'g14',
    name: '홍실 옵션 굿즈',
    ip: 'hong-sil-quest',
    type: '키링',
    price: 9000,
    badge: null,
    stock: 'ok' as const,
    stockQty: 8,
    img: 'none',
    options: [
      { id: '00000000-0000-4000-8000-0000000005b1', name: '레드', code: 'G14-R', price: 9000, stockQty: 4, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-0000000005b2', name: '블루', code: 'G14-B', price: 9000, stockQty: 4, isDefault: false, attributes: {} },
    ],
  }, {
    id: 'g15',
    name: '찜하지 않은 굿즈',
    ip: 'hong-sil-quest',
    type: '문구',
    price: 3000,
    badge: null,
    stock: 'ok' as const,
    stockQty: 3,
    img: 'none',
  }],
  cards: [],
  events: [],
} as unknown as CatalogSnapshot;

async function render(tab?: string, extra: Record<string, string> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...(tab ? { tab } : {}), ...extra }) }));
}

describe('/my/wishlist page', () => {
  beforeEach(() => {
    mocks.user = { id: '00000000-0000-4000-8000-000000000501', email: 'fan@icons.gg' };
    mocks.entries = [];
    mocks.follows = [];
    mocks.cartQuantity = 0;
    mocks.push.mockReset();
  });

  it('keeps the personal list out of search indexes', () => {
    expect(metadata).toMatchObject({
      title: '위시리스트 — ICONS',
      robots: { index: false, follow: false },
    });
  });

  /* 로그인 없이 열면 빈 목록이 "찜한 게 없다"는 거짓말이 된다 — 진입에서 막고, 보던 탭으로 돌아오게 한다. */
  it('sends a guest to login with the wishlist tab as the return path', async () => {
    mocks.user = null;

    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Fwishlist');
    await expect(render('ip')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Fwishlist%3Ftab%3Dip');
  });

  it('renders the empty state with a way back to the shop', async () => {
    const html = await render();

    expect(html).toContain('아직 찜한 굿즈가 없어요');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵 둘러보기');
  });

  it('lists wished goods as product cards with the listing heart as the unwish control', async () => {
    mocks.entries = [{ goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' }];

    const html = await render();

    expect(html).toContain('wc-wish__grid');
    expect(html).toContain('wc-product-card');
    expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('wc-product-card__brand">홍실');
    expect(html).toContain('href="/shop/g13"');
    expect(html).toContain('₩12,000');
    expect(html).toContain('₩16,000');
    expect(html).toContain('aria-label="홍실 아크릴 블록 위시리스트에서 빼기"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('총 <strong>1</strong>개');
    /* 위시 화면은 고른 굿즈만 내려받는다 — 찜하지 않은 굿즈는 화면에 없다. */
    expect(html).not.toContain('찜하지 않은 굿즈');
    expect(html).not.toContain('아직 찜한 굿즈가 없어요');
  });

  /* S14: 목록 카드의 showCart 설정(기본 꺼짐)과 무관하게 수량 없는 담기가 선다. */
  it('offers a quantity-less add-to-cart regardless of the listing cart setting', async () => {
    mocks.entries = [
      { goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' },
      { goodId: 'g14', createdAt: '2026-08-27T00:00:00.000Z' },
    ];

    const html = await render();

    expect(html).toContain('aria-label="홍실 아크릴 블록 장바구니에 한 개 담기"');
    expect(html).toContain('>장바구니 담기</button>');
    expect(html).not.toContain('shop-cart-button');
    expect(html).not.toMatch(/type="number"|수량 선택<\/button>/);
    /* 옵션을 골라야 하는 굿즈는 여기서 담지 않고 상세로 보낸다(목록 담기 버튼과 같은 규칙). */
    expect(html).toMatch(/aria-label="홍실 옵션 굿즈 옵션 선택"[^>]*href="\/shop\/g14"|href="\/shop\/g14"[^>]*aria-label="홍실 옵션 굿즈 옵션 선택"/);
  });

  it('keeps focusable but inert add buttons when stock is already in the cart', async () => {
    mocks.entries = [{ goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' }];
    mocks.cartQuantity = 20;

    const html = await render();

    expect(html).toContain('aria-label="홍실 아크릴 블록, 장바구니 20개, 재고 한도 20개"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('>장바구니 · 20</button>');
    expect(html).not.toContain('담김');
  });

  /* 카탈로그에서 빠진 굿즈의 행을 조용히 지우면 사용자는 자기가 해제한 줄 안다. */
  it('keeps a delisted good as a 판매 종료 card instead of dropping it', async () => {
    mocks.entries = [{ goodId: 'gone', createdAt: '2026-08-28T00:00:00.000Z' }];

    const html = await render();

    expect(html).toContain('판매 종료');
    expect(html).toContain('aria-label="판매 종료 굿즈 위시리스트에서 빼기"');
    expect(html).not.toContain('장바구니 담기');
    expect(html).not.toContain('아직 찜한 굿즈가 없어요');
  });

  /* 판매 종료 카드도 같은 그리드의 상품 카드처럼 스토어 목록 이미지 비율(listing.imageShape)을 따른다(l6-ui-3). */
  it('frames the 판매 종료 card with the same listing image shape as its neighbours', async () => {
    mocks.entries = [
      { goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' },
      { goodId: 'gone', createdAt: '2026-08-27T00:00:00.000Z' },
    ];
    const portrait = { ...DEFAULT_STORE_PRESENTATION, listing: { ...DEFAULT_STORE_PRESENTATION.listing, imageShape: 'portrait' as const } };

    const html = renderToStaticMarkup(
      <StorePresentationProvider value={portrait}>{await Page({ searchParams: Promise.resolve({}) })}</StorePresentationProvider>,
    );
    const cards = html.match(/<article class="wc-product-card[^"]*"[^>]*>/g) ?? [];

    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.includes('data-list-shape="portrait"'))).toBe(true);
    expect(cards[1]).toContain('wc-wish__ended');

    const square = await render();
    expect(square.match(/<article class="wc-product-card wc-wish__ended"[^>]*>/)?.[0]).toContain(`data-list-shape="${DEFAULT_STORE_PRESENTATION.listing.imageShape}"`);
  });

  it('switches between wished goods and followed IPs by URL with counts on both tabs', async () => {
    mocks.entries = [{ goodId: 'g13', createdAt: '2026-08-28T00:00:00.000Z' }];
    mocks.follows = ['maplestory', 'unpublished-ip', 'hong-sil-quest'];

    const goods = await render();
    expect(goods).toContain('aria-label="위시리스트 종류"');
    expect(goods).toMatch(/aria-current="page" href="\/my\/wishlist">굿즈 \(1\)/);
    expect(goods).toContain('href="/my/wishlist?tab=ip">팔로우한 IP (2)');

    const ips = await render('ip');
    expect(ips).toMatch(/aria-current="page" href="\/my\/wishlist\?tab=ip">팔로우한 IP \(2\)/);
    expect(ips).not.toContain('wc-wish__grid');
    expect(ips).toContain('href="/ip/maplestory"');
    expect(ips).toContain('MAPLESTORY');
    expect(ips.indexOf('href="/ip/maplestory"')).toBeLessThan(ips.indexOf('href="/ip/hong-sil-quest"'));
    expect(ips).toContain('name="intent" value="unfollow"');
    expect(ips).toContain('name="next" value="/my/wishlist?tab=ip"');
    expect(ips).toContain('aria-label="MAPLESTORY 팔로우 해제"');
    /* IP 는 위시가 아니라 팔로우다 — 이 탭에는 위시 하트가 없다. */
    expect(ips).not.toContain('위시리스트에서 빼기');
  });

  it('separates "no follows" from "could not read follows"', async () => {
    mocks.follows = [];
    const none = await render('ip');
    expect(none).toContain('아직 팔로우한 IP가 없어요');
    expect(none).toContain('href="/ip"');

    mocks.follows = null;
    const unavailable = await render('ip');
    expect(unavailable).toContain('팔로우한 IP를 확인하지 못했어요.');
    expect(unavailable).not.toContain('아직 팔로우한 IP가 없어요');
    expect(unavailable).toContain('href="/my/wishlist?tab=ip">팔로우한 IP</a>');
  });

  /* 팔로우 해제는 IP 관 폼 계약이다 — 저장에 실패하면 follow_error=1 로 이 탭에 돌아오고, 그 사실을 알린다(l6-data-5). */
  it('says when an unfollow could not be saved, on the IP tab only', async () => {
    mocks.follows = ['maplestory'];

    const failed = await render('ip', { follow_error: '1' });
    expect(failed).toContain('<p class="wc-wish__alert" role="alert">팔로우 해제를 저장하지 못했어요. 잠시 후 다시 시도해주세요.</p>');
    /* 저장하지 못했으니 타일과 해제 버튼은 그대로 남는다. */
    expect(failed).toContain('aria-label="MAPLESTORY 팔로우 해제"');
    expect(failed.indexOf('wc-wish__alert')).toBeLessThan(failed.indexOf('href="/ip/maplestory"'));

    expect(await render('ip')).not.toContain('wc-wish__alert');
    expect(await render('ip', { follow_error: '0' })).not.toContain('wc-wish__alert');
    expect(await render(undefined, { follow_error: '1' })).not.toContain('wc-wish__alert');
  });
});
