import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Good, Ip } from '@/lib/data';
import type { MypageDashboard } from '@/lib/mypage-dashboard';
import type { OrderListItem } from '@/lib/orders';
import { RecentGoodsCards } from '@/components/mypage/MypageRecentGoods';
import { MyPage } from './MyPage';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));
const gates = vi.hoisted(() => ({ cardRewards: true, cart: { ready: true, count: 0 } }));
vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => gates.cardRewards,
}));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ ...gates.cart, resetForSignOut: vi.fn() }),
}));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/app/shop/experience-actions', () => ({ loadInterestCollectionAction: vi.fn(() => new Promise(() => {})) }));

afterEach(() => {
  gates.cardRewards = true;
  gates.cart = { ready: true, count: 0 };
});

const good = {
  id: 'g13',
  name: '홍실 아크릴 블록',
  ip: 'hong-sil-quest',
  type: '아크릴',
  price: 12000,
  compareAtPrice: 16000,
  badge: null,
  stock: 'ok',
  stockQty: 20,
  img: 'none',
} as unknown as Good;

const ip = {
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
  tagline: '',
  synopsis: '',
} as Ip;

function order(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'shipping',
    total: 30000,
    createdAt: '2026-10-01T06:00:00.000Z',
    itemLabel: '홍실 아크릴 블록 외 1건',
    itemCount: 2,
    paymentMethod: 'card',
    ...overrides,
  };
}

const filled: MypageDashboard = {
  orders: { counts: { paid: 1, confirmed: 0, shipping: 2, delivered: 0, done: 4 }, recent: [order()] },
  wishlist: { count: 3, goods: [{ good, brand: '홍실' }] },
  follows: { count: 1, ips: [ip] },
  coupons: { usable: 2 },
  storeCredit: { available: 4500 },
  ipTitles: { 'hong-sil-quest': '홍실' },
};

const empty: MypageDashboard = {
  orders: { counts: { paid: 0, confirmed: 0, shipping: 0, delivered: 0, done: 0 }, recent: [] },
  wishlist: { count: 0, goods: [] },
  follows: { count: 0, ips: [] },
  coupons: { usable: 0 },
  storeCredit: { available: 0 },
  ipTitles: {},
};

function render(overrides: Partial<React.ComponentProps<typeof MyPage>> = {}) {
  return renderToStaticMarkup(
    <MyPage
      avatarInitial="아"
      avatarUrl="https://signed.example/avatar.png"
      dashboard={filled}
      loyalty={{ grade: 'silver', label: 'SILVER', nextNote: 'GOLD까지 150,000원' }}
      nickname="아이콘즈 팬"
      recentGoodsEnabled={false}
      viewerId="00000000-0000-4000-8000-000000001201"
      {...overrides}
    />,
  );
}

function section(html: string, start: string, end: string) {
  return html.slice(html.indexOf(start), html.indexOf(end));
}

describe('MyPage dashboard', () => {
  it('renders the private profile summary without account identifiers or links', () => {
    const html = render();
    const strip = section(html, 'aria-label="프로필 요약"', 'aria-label="마이페이지 바로가기"');

    expect(html).toContain('<main');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="wc-sr-only">마이페이지</h1>');
    expect(strip).toContain('아이콘즈 팬');
    expect(strip).toContain('src="https://signed.example/avatar.png"');
    expect(strip).toContain('wc-mypage__tier-badge--silver');
    expect(strip).toContain('GOLD까지 150,000원');
    /* 위시 수는 텍스트 — 스트립에는 메뉴와 같은 목적지 링크를 두지 않는다(한 화면 한 링크). */
    expect(strip).toContain('위시리스트');
    expect(strip).toMatch(/wc-mypage__stat-count">3<span class="wc-sr-only">개<\/span>/);
    expect(strip).not.toContain('<a ');
    expect(html).not.toContain('@');
  });

  it('uses the server-computed initial when no avatar URL is available', () => {
    const html = render({ avatarInitial: '👩‍🎤', avatarUrl: null });

    expect(html).toContain('>👩‍🎤</span>');
    expect(html).not.toContain('<img');
  });

  it('does not invent a grade or a wish count it could not read', () => {
    const html = render({ loyalty: null, dashboard: { ...filled, wishlist: null } });
    const strip = section(html, 'aria-label="프로필 요약"', 'aria-label="마이페이지 바로가기"');

    expect(strip).not.toContain('wc-mypage__tier-badge');
    expect(strip.match(/확인하지 못했어요/g)).toHaveLength(2);
  });

  it('keeps the shell menu once as the account navigation, including the grade benefits page', () => {
    const html = render();
    const menu = section(html, 'aria-label="마이페이지 메뉴"', 'wc-mypage__content');

    expect(html.match(/aria-label="마이페이지 메뉴"/g)).toHaveLength(1);
    expect(html).toContain('wc-mypage--dashboard');
    for (const [href, label] of [
      ['/orders', '주문 내역'],
      ['/tickets', '내 티켓'],
      ['/my/wishlist', '위시리스트'],
      ['/binder', '바인더'],
      ['/packs', '카드팩'],
      ['/my/reviews', '내 리뷰'],
      ['/my/grade-benefits', '회원 등급 혜택'],
      ['/my/coupons', '쿠폰함'],
      ['/notifications', '알림함'],
      ['/settings', '설정'],
      ['/my/inquiries', '1:1 문의'],
    ]) {
      expect(menu.match(new RegExp(`href="${href}"`, 'g'))).toHaveLength(1);
      expect(menu).toContain(`>${label}</a>`);
    }
  });

  it('hides gated destinations while their gate is closed', () => {
    gates.cardRewards = false;
    const html = render();

    expect(html).not.toContain('href="/packs"');
    expect(html).not.toContain('>카드팩</');
  });

  it('summarises orders by step and links the latest orders', () => {
    const html = render();
    const orders = section(html, 'id="mydash-orders"', 'id="mydash-benefits"');

    expect(orders).toContain('aria-label="주문 상태별 건수"');
    for (const [label, count] of [['결제완료', 1], ['발주확인', 0], ['배송중', 2], ['배송완료', 0], ['거래확정', 4]]) {
      expect(orders).toContain(`<span class="wc-mydash__step-label">${label}</span><strong class="wc-mydash__step-count">${count}<span class="wc-sr-only">건</span></strong>`);
    }
    expect(orders).toContain('href="/orders/11111111-1111-4111-8111-111111111111"');
    expect(orders).toContain('홍실 아크릴 블록 외 1건');
    expect(orders).toContain('₩30,000');
    expect(html).toMatch(/href="\/orders"[^>]*>더보기<span class="wc-sr-only"> 최근 주문<\/span>/);
  });

  it('summarises coupons and store credit as links to their own pages', () => {
    const html = render();
    const benefits = section(html, 'id="mydash-benefits"', 'id="mydash-wish"');

    expect(benefits).toContain('href="/my/coupons"');
    expect(benefits).toContain('2장');
    expect(benefits).toContain('href="/my/store-credits"');
    expect(benefits).toContain('₩4,500');
  });

  it('shows wished goods and followed IPs with their counts and full lists', () => {
    const html = render();
    const wish = section(html, 'id="mydash-wish"', 'id="mydash-follows"');
    const follows = html.slice(html.indexOf('id="mydash-follows"'));

    expect(wish).toContain('위시리스트<span class="wc-mydash__count"> (3)</span>');
    expect(wish).toContain('href="/shop/g13"');
    expect(wish).toContain('wc-product-card__brand">홍실');
    expect(wish).toContain('₩12,000');
    expect(wish).not.toContain('shop-cart-button');
    expect(follows).toContain('팔로우한 IP<span class="wc-mydash__count"> (1)</span>');
    expect(follows).toContain('href="/my/wishlist?tab=ip"');
    expect(follows).toContain('href="/ip/hong-sil-quest"');
    expect(follows).toContain('RED THREAD QUEST');
  });

  it('gives each block an empty state and an unavailable state of its own', () => {
    const blank = render({ dashboard: empty });
    expect(blank).toContain('최근 주문이 없어요.');
    expect(blank).toContain('아직 찜한 굿즈가 없어요.');
    expect(blank).toContain('아직 팔로우한 IP가 없어요.');
    expect(blank).toContain('0장');

    const broken = render({ dashboard: { orders: null, wishlist: null, follows: null, coupons: null, storeCredit: null } });
    expect(broken).toContain('주문 내역을 확인하지 못했어요.');
    expect(broken).toContain('위시리스트를 확인하지 못했어요.');
    expect(broken).toContain('팔로우한 IP를 확인하지 못했어요.');
    expect(broken).not.toContain('aria-label="주문 상태별 건수"');

    /* 카탈로그만 못 읽었으면 찜 수(스트립·머리)는 그대로, 줄만 못 읽음으로 접는다. */
    const noShelf = render({ dashboard: { ...filled, wishlist: { count: 3, goods: null } } });
    expect(noShelf).toContain('위시리스트<span class="wc-mydash__count"> (3)</span>');
    expect(noShelf).toContain('찜한 굿즈 목록을 불러오지 못했어요.');
    expect(noShelf).toMatch(/wc-mypage__stat-count">3<span class="wc-sr-only">개<\/span>/);
  });

  it('carries the mobile shortcuts with count badges and a sign-out form', () => {
    gates.cart = { ready: true, count: 120 };
    const html = render();
    const shortcuts = section(html, 'aria-label="마이페이지 바로가기"', 'aria-label="마이페이지 메뉴"');

    expect(shortcuts).toContain('href="/cart"');
    expect(shortcuts).toContain('99+');
    expect(shortcuts).toContain('<span class="wc-sr-only"> 120개</span>');
    expect(shortcuts).toContain('href="/orders"');
    expect(shortcuts).toContain('href="/my/coupons"');
    expect(shortcuts).toContain('href="/my/wishlist"');
    expect(shortcuts).toContain('<span class="wc-sr-only"> 3개</span>');
    /* 장바구니 배지는 카트 수량 뱃지(액센트), 위시 배지는 액센트 사용처 밖이라 잉크다(DESIGN §2 — l6-ui-2). */
    expect(shortcuts).toContain('<span aria-hidden="true" class="wc-mydash__badge">99+</span>');
    expect(shortcuts).toContain('<span aria-hidden="true" class="wc-mydash__badge wc-mydash__badge--ink">3</span>');
    expect(html).toContain('wc-mydash__signout');
    expect(html).toContain('>로그아웃</button>');
  });

  /* 같은 굿즈가 위시 줄과 최근 본 굿즈 줄에 함께 보여도 카드 구성(배지 → IP 이름 → 이름 → 가격)이 같다(l6-ui-5). */
  it('draws recently viewed cards with the same anatomy as the wish shelf', () => {
    const wishShelf = section(render(), 'aria-labelledby="mydash-wish"', 'aria-labelledby="mydash-follows"');
    const wishCards = wishShelf.slice(wishShelf.indexOf('<ul class="wc-mydash__shelf">'), wishShelf.indexOf('</ul>') + 5);
    const recentCards = renderToStaticMarkup(<RecentGoodsCards goods={[good]} ipTitles={filled.ipTitles} />);

    expect(wishCards).toContain('<p class="wc-product-card__brand">홍실</p>');
    expect(recentCards).toBe(wishCards);
    /* 카탈로그를 못 읽어 이름표가 없으면 브랜드 줄만 비우고 카드는 그린다. */
    expect(renderToStaticMarkup(<RecentGoodsCards goods={[good]} ipTitles={null} />)).not.toContain('wc-product-card__brand');
  });

  it('draws the recently viewed block only while the detail interests switch is on', () => {
    expect(render({ recentGoodsEnabled: false })).not.toContain('최근 본 굿즈');
    expect(render({ recentGoodsEnabled: true })).toContain('최근 본 굿즈를 불러오는 중이에요.');
  });
});
