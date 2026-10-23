import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { IpFollowState } from '@/lib/ip-follow';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { parseShopSearchParams, selectCollectionGoods } from '@/lib/shop-catalog';
import { IpDetail, type IpGoodsCollection } from './IpDetail';

/* R-03 §1.9 개별 관 행동 단언 — 팔로우·알림 폼의 hidden 필드 계약(app/ip/actions.ts),
 * 해시태그 실데이터 파생, 품절 포함 굿즈 카운트 행, 연결 밴드 경로. */

const actions = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  toggleFollow: vi.fn(),
}));

vi.mock('@/app/ip/actions', () => ({
  setIpNotificationPreferencesAction: actions.setPreferences,
  toggleIpFollowAction: actions.toggleFollow,
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/ip/maplestory',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ip = {
  id: 'maplestory', // ip-display META 등재 → ipEn = MAPLESTORY
  title: '메이플스토리',
  sub: 'GAME IP',
  v: { key: 'game', label: '게임', color: '#38F0C0' },
  glyph: '楓',
  tagline: '작은 용사들의 큰 모험',
  synopsis: '메이플 월드의 이야기',
  bg: 'linear-gradient(#111, #222)',
  fans: 100,
  goods: 3,
  cards: 2,
  featured: true,
};

const detail: CatalogIpDetail = {
  source: 'mock',
  ip,
  goods: [
    { id: 'g1', name: '단풍 키링', ip: ip.id, type: '키링', price: 12000, badge: 'NEW', stock: 'ok', stockQty: 10, img: 'linear-gradient(#333, #444)' },
    { id: 'g2', name: '슬라임 인형', ip: ip.id, type: '인형', price: 29000, badge: null, stock: 'soldout', stockQty: 0, img: 'linear-gradient(#333, #444)' },
    { id: 'g3', name: '버섯 키링', ip: ip.id, type: '키링', price: 9000, badge: null, stock: 'ok', stockQty: 4, img: 'linear-gradient(#333, #444)' },
  ],
  cards: [
    { id: 'c1', ip: ip.id, name: '단풍잎 용사', no: '001', rarity: 'SSR', owned: false, bg: 'linear-gradient(#111, #222)' },
    { id: 'c2', ip: ip.id, name: '슬라임', no: '002', rarity: 'N', owned: true, bg: 'linear-gradient(#111, #222)' },
  ],
  events: [],
  posts: [],
};

const notFollowed: IpFollowState = { isFollowed: false, notifyDrops: false, notifyEvents: false };

function render(overrides: {
  detail?: CatalogIpDetail;
  followState?: IpFollowState;
  followError?: boolean;
  notificationError?: boolean;
  notificationSaved?: boolean;
  collection?: IpGoodsCollection;
  wishlist?: ListingWishlist | null;
} = {}) {
  return renderToStaticMarkup(
    <IpDetail
      collection={overrides.collection}
      detail={overrides.detail ?? detail}
      followError={overrides.followError ?? false}
      followState={overrides.followState ?? notFollowed}
      notificationError={overrides.notificationError ?? false}
      notificationSaved={overrides.notificationSaved ?? false}
      wishlist={overrides.wishlist}
    />,
  );
}

/* 페이지가 URL 로 계산해 내려주는 IP관 컬렉션을 테스트에서도 같은 함수로 만든다. */
function collectionOf(params: Record<string, string | string[]>, source: CatalogIpDetail = detail): IpGoodsCollection {
  const query = parseShopSearchParams(params, { view: 'ip', validIpIds: new Set() });
  return { query, result: selectCollectionGoods(source.goods, { ips: [source.ip] }, query) };
}

function inputNamed(html: string, name: string) {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
}

function text(html: string) {
  return html.replace(/<[^>]+>/g, '');
}

describe('IpDetail follow form', () => {
  it('keeps the immutable follow form fields and offers a free join for non-followers', () => {
    const html = render();

    expect(inputNamed(html, 'ipId')).toContain('value="maplestory"');
    expect(inputNamed(html, 'intent')).toContain('value="follow"');
    expect(inputNamed(html, 'next')).toContain('value="/ip/maplestory"');
    expect(html).toContain('팬덤 가입 — 무료');
  });

  it('flips the intent to unfollow for followers and marks the joined state', () => {
    const html = render({ followState: { isFollowed: true, notifyDrops: false, notifyEvents: false } });

    expect(inputNamed(html, 'intent')).toContain('value="unfollow"');
    expect(html).toContain('팬덤 가입됨 ✓');
    expect(html).toContain('is-followed');
  });

  it('shows the fan count in the follow row', () => {
    const html = render();

    expect(html).toContain('wc-iphall__follow-count');
    expect(html).toContain('팬 </span>100');
    expect(html).not.toContain('is-followed');
  });

  it('keeps internal follow identity while redirecting action feedback to the canonical public slug', () => {
    const html = renderToStaticMarkup(
      <IpDetail
        detail={detail}
        followError={false}
        followState={notFollowed}
        notificationError={false}
        notificationSaved={false}
        publicSlug="maple-world"
      />,
    );
    expect(inputNamed(html, 'ipId')).toContain('value="maplestory"');
    expect(inputNamed(html, 'next')).toContain('value="/ip/maple-world"');
  });
});

describe('IpDetail notification forms', () => {
  it('sends the one-click auto-follow payload for non-followers', () => {
    const html = render();

    expect(html).toContain('팔로우하고 알림 받기');
    expect(inputNamed(html, 'autoFollow')).toContain('value="1"');
    expect(inputNamed(html, 'setBoth')).toContain('value="1"');
    expect(inputNamed(html, 'notifyDrops')).toContain('value="1"');
    expect(inputNamed(html, 'notifyEvents')).toContain('value="1"');
  });

  it('shows followers two switch checkboxes with their saved values', () => {
    const html = render({ followState: { isFollowed: true, notifyDrops: true, notifyEvents: false } });
    const drops = inputNamed(html, 'notifyDrops');
    const events = inputNamed(html, 'notifyEvents');

    expect(html).toContain('새 굿즈·드롭');
    expect(html).toContain('팝업·이벤트');
    expect(html).toContain('알림 설정 저장');
    expect(inputNamed(html, 'setBoth')).toContain('value="1"');
    expect(drops).toContain('role="switch"');
    expect(drops).toContain('checked=""');
    expect(events).toContain('role="switch"');
    expect(events).not.toContain('checked=""');
  });

  it('announces follow and notification failures as alerts', () => {
    const html = render({ followError: true, notificationError: true });

    expect(html).toContain('role="alert"');
    expect(html).toContain('팔로우 상태를 저장하지 못했습니다');
    expect(html).toContain('알림 설정을 저장하지 못했습니다');
  });

  it('announces a successful preference save, but never alongside an error', () => {
    const saved = render({ notificationSaved: true });
    expect(saved).toContain('role="status"');
    expect(saved).toContain('알림 설정을 저장했습니다');

    const conflicted = render({ notificationError: true, notificationSaved: true });
    expect(conflicted).not.toContain('알림 설정을 저장했습니다');
  });
});

describe('IpDetail banner', () => {
  it('derives the hashtags from real catalog data only', () => {
    const html = render();
    const hashtagList = html.match(/wc-iphall__hashtags[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(hashtagList).toContain('#MAPLESTORY');
    expect(hashtagList).toContain('#게임');
    expect(hashtagList.match(/<li>/g)).toHaveLength(2);
  });

  /* 데스크톱은 배너 안, 모바일은 배너 아래 흰 지면에 해시태그가 선다(11 IP-05) — 같은 목록을 폭마다 하나만 보인다. */
  it('places the same hashtag list inside the banner and below it for the mobile layout', () => {
    const html = render();
    const banner = html.match(/<ul class="wc-iphall__hashtags wc-iphall__hashtags--banner">[\s\S]*?<\/ul>/)?.[0] ?? '';
    const below = html.match(/<div class="wc-container wc-iphall__tags-band"><ul class="wc-iphall__hashtags wc-iphall__hashtags--below">[\s\S]*?<\/ul>/)?.[0] ?? '';

    expect(banner.match(/<li>/g)).toHaveLength(2);
    expect(below.match(/<li>/g)).toHaveLength(2);
    expect(html.indexOf('wc-iphall__hashtags--banner')).toBeLessThan(html.indexOf('</section>'));
    expect(html.indexOf('wc-iphall__hashtags--below')).toBeGreaterThan(html.indexOf('</section>'));
  });

  it('renders the ip name as the page heading with its description', () => {
    const html = render();

    expect(html.match(/<h1[^>]*>메이플스토리<\/h1>/)).toBeTruthy();
    expect(html).toContain('작은 용사들의 큰 모험 메이플 월드의 이야기');
  });
});

describe('IpDetail goods section', () => {
  it('counts every good including sold-out ones and keeps the sold-out band', () => {
    const html = render();

    expect(text(html)).toContain('전체 › 3개 굿즈');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('href="/shop/g1"');
  });

  it('links to the shop scoped to this ip', () => {
    const html = render();

    expect(html).toContain('굿즈샵에서 전체 보기');
    expect(html).toContain('href="/shop?ip=maplestory"');
  });

  /* IP-01: 상품 영역은 IP로 좁힌 굿즈샵 컬렉션이다 — 사이드바(타입·가격)·정렬·212 카드·VIEW MORE.
     IP 그룹은 값이 하나뿐이라 그리지 않는다(레퍼런스 브랜드관의 1항목 브랜드 그룹 생략). */
  it('replaces the type chips with the collection sidebar narrowed to this ip', () => {
    const html = render();

    expect(html).toContain('aria-label="굿즈 필터"');
    expect(html).toContain('타입 (0)');
    expect(text(html)).toContain('키링 (2)');
    expect(text(html)).toContain('인형 (1)');
    expect(html).not.toContain('IP (0)');
    expect(html).not.toContain('wc-iphall__filter-chip');
    expect(html).toContain('class="wc-product-grid"');
  });

  it('offers the seven collection sorts with recommended selected by default', () => {
    const html = render();
    const values = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);

    expect(values).toEqual(['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest']);
    expect(html).toMatch(/<option[^>]*value="recommended"[^>]*selected/);
  });

  it('renders the server-computed collection with its filters and sort applied', () => {
    const html = render({ collection: collectionOf({ type: '키링', sort: 'price_asc' }) });

    expect(text(html)).toContain('전체 › 2/3개 굿즈');
    expect(html.indexOf('버섯 키링')).toBeLessThan(html.indexOf('단풍 키링'));
    expect(html).not.toContain('슬라임 인형');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="키링"/);
  });

  it('pages beyond twenty goods with VIEW MORE', () => {
    const many: CatalogIpDetail = {
      ...detail,
      goods: Array.from({ length: 25 }, (_, index) => ({ ...detail.goods[0], id: `m${index}`, name: `굿즈 ${index}` })),
    };
    const html = render({ detail: many });

    expect((html.match(/wc-product-card__name-link/g) ?? []).length).toBe(20);
    expect(html).toContain('>VIEW MORE</button>');
  });

  it('puts a listing heart on every card when the wish set is passed', () => {
    const html = render({ wishlist: { signedIn: true, goodIds: ['g3'] } });

    expect((html.match(/<button[^>]*class="wc-list-heart[ "]/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="버섯 키링 위시리스트에서 빼기"');
  });

  it('shows only the empty state when the hall has no goods', () => {
    const empty = render({ detail: { ...detail, goods: [] } });

    expect(empty).toContain('등록된 굿즈가 아직 없습니다');
    expect(empty).toContain('id="iphall-goods-heading"');
    expect(empty).not.toContain('aria-label="굿즈 필터"');
    expect(empty).not.toContain('wc-product-grid');
  });
});

describe('IpDetail link band', () => {
  it('links the card binder with the lineup size, offline pop-ups, and the fandom channel', () => {
    const html = render();

    expect(html).toContain('카드 도감 2종');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('href="/offline-popups"');
    /* 팬덤 채널은 커뮤니티 임시 비공개 스위치를 따른다. */
    expect(html.includes('href="/community?ip=maplestory"')).toBe(COMMUNITY_ENABLED);
  });
});
