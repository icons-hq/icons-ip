import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import type { CatalogIpDetail } from '@/lib/catalog';
import type { IpFollowState } from '@/lib/ip-follow';
import { IP_HALL_BANNER_EMPTY_SOURCE, type IpHallBanner } from '@/lib/ip-hall-banner';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { listingQueryString, parseListingSearchParams, selectCollectionGoods } from '@/lib/shop-catalog';
import { IpDetail, type IpGoodsCollection } from './IpDetail';

/* IP관 행동 단언 — 팔로우·알림 폼의 hidden 필드 계약(app/ip/actions.ts), 해시태그 실데이터 파생,
 * 굿즈샵 카테고리 화면과 같은 목록 틀(필터 없음·정렬 7종·4열 카드), 연결 링크 경로. */

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
    { id: 'g1', name: '단풍 키링', ip: ip.id, price: 12000, badge: 'NEW', stock: 'ok', stockQty: 10, img: 'linear-gradient(#333, #444)' },
    { id: 'g2', name: '슬라임 인형', ip: ip.id, price: 29000, badge: null, stock: 'soldout', stockQty: 0, img: 'linear-gradient(#333, #444)' },
    { id: 'g3', name: '버섯 키링', ip: ip.id, price: 9000, badge: null, stock: 'ok', stockQty: 4, img: 'linear-gradient(#333, #444)' },
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
  banner?: IpHallBanner | null;
} = {}) {
  return renderToStaticMarkup(
    <IpDetail
      banner={overrides.banner}
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
  const { query } = parseListingSearchParams(params, 'all');
  return { query, result: selectCollectionGoods(source.goods, { ips: [source.ip] }, query) };
}

function inputNamed(html: string, name: string) {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
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

/* 팔로우·알림 저장(성공·실패·로그인 왕복) 뒤에도 고른 굿즈 정렬이 남아야 한다(Codex #598). */
describe('IpDetail form return path', () => {
  it('sends the current sorted hall URL as next from every follow and notification form', () => {
    const collection = collectionOf({ sort: 'price_asc' });
    const expected = `/ip/maplestory?${listingQueryString(collection.query)}`.replace(/&/g, '&amp;');
    expect(expected).toContain('sort=price_asc');

    const follower = render({ collection, followState: { isFollowed: true, notifyDrops: true, notifyEvents: false } });
    const guest = render({ collection });
    const nextValues = (html: string) => [...html.matchAll(/<input[^>]*name="next"[^>]*value="([^"]*)"/g)].map((match) => match[1]);

    expect(nextValues(follower)).toEqual([expected, expected]);
    expect(nextValues(guest)).toEqual([expected, expected]);
  });

  it('keeps the bare hall path when no sort is chosen', () => {
    const nextValues = [...render().matchAll(/<input[^>]*name="next"[^>]*value="([^"]*)"/g)].map((match) => match[1]);
    expect(nextValues).toEqual(['/ip/maplestory', '/ip/maplestory']);
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

    expect(html).toContain('새 상품·드롭');
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

  /* 해시태그는 배너 안 한 곳에만 선다 — 배너가 스트립이라 모바일에서도 글자 단 안에 들어간다. */
  it('puts the hashtag list once, inside the banner', () => {
    const html = render();

    expect(html.match(/wc-iphall__hashtags/g)).toHaveLength(1);
    expect(html.indexOf('wc-iphall__hashtags')).toBeLessThan(html.indexOf('</section>'));
    expect(html).not.toContain('wc-iphall__tags-band');
  });

  it('renders the ip name as the page heading with its description', () => {
    const html = render();

    expect(html.match(/<h1[^>]*>메이플스토리<\/h1>/)).toBeTruthy();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('작은 용사들의 큰 모험 메이플 월드의 이야기');
  });
});

/* IP-06(L8b): IP관 PC/MO 배너. 없으면 키아트 배경 그대로(마크업 불변), 있으면 폭별 picture 가 배경 위·스크림 아래에 선다. */
describe('IpDetail hall banner artwork', () => {
  const sectionOf = (html: string) => html.match(/<section class="wc-iphall__banner"[^>]*>/)?.[0] ?? '';

  it('keeps the key-art background exactly as before when the IP has no hall banner', () => {
    for (const banner of [undefined, null, { imageUrl: null, mobileImageUrl: null }]) {
      const html = render({ banner });

      expect(sectionOf(html)).toBe('<section class="wc-iphall__banner" style="background:linear-gradient(#111, #222);background-size:cover;background-position:center">');
      expect(html).not.toContain('wc-iphall__banner-media');
    }
  });

  it('draws the PC banner for every width and swaps in the mobile banner below 750px', () => {
    const html = render({ banner: { imageUrl: 'https://cdn.test/pc.webp', mobileImageUrl: 'https://cdn.test/mo.webp' } });

    expect(sectionOf(html)).toBe('<section class="wc-iphall__banner" data-banner="all">');
    expect(html).toContain('<picture class="wc-iphall__banner-media"><source media="(max-width: 749px)" srcSet="https://cdn.test/mo.webp"/><img alt="" decoding="async" fetchPriority="high" loading="eager" sizes="100vw" src="https://cdn.test/pc.webp"/></picture>');
    expect(html.indexOf('wc-iphall__banner-media')).toBeLessThan(html.indexOf('<h1'));
  });

  it('uses the PC banner on mobile too when no mobile banner exists', () => {
    const html = render({ banner: { imageUrl: 'https://cdn.test/pc.webp', mobileImageUrl: null } });

    expect(html).not.toContain('<source');
    expect(html).toContain('src="https://cdn.test/pc.webp"');
  });

  /* l8b-qa-6 — 데스크톱 PC 배너는 전면 스크림 대신 왼쪽 글자 단에만 스크림을 깐다(그림 오른쪽은 그대로). 키아트·모바일은 전면 그대로. */
  it('scrims only the left text column over a desktop PC banner and keeps the full scrim elsewhere', () => {
    const css = readFileSync(new URL('../../app/styles/wc-discovery.css', import.meta.url), 'utf8');
    const rules: Array<{ media: string | null; selector: string; decls: Record<string, string> }> = [];
    postcss.parse(css).walkRules((rule) => {
      const parent = rule.parent?.type === 'atrule' ? rule.parent as AtRule : null;
      const decls: Record<string, string> = {};
      rule.walkDecls((decl) => { decls[decl.prop] = decl.value; });
      for (const selector of rule.selectors) rules.push({ media: parent?.name === 'media' ? parent.params : null, selector: selector.trim(), decls });
    });
    const find = (selector: string, media: string | null) => rules.filter((rule) => rule.selector === selector && rule.media === media);

    /* 기본(키아트·모바일): 전면 세로 스크림 .45→.62 그대로. */
    expect(find('.wc-iphall__banner::before', null)[0]?.decls.background).toBe('linear-gradient(180deg, rgba(0, 0, 0, .45) 0%, rgba(0, 0, 0, .62) 100%)');
    /* 데스크톱 PC 배너만: 왼쪽 글자 단(글자 최대 폭 640) 안은 .62→.54(기존 스크림의 글자 줄 값 이상), 그 끝에서 280px 동안 0 으로 풀린다. */
    const pc = find(".wc-iphall__banner[data-banner='all']::before", '(min-width: 750px)');
    expect(pc).toHaveLength(1);
    expect(pc[0].decls['--wc-iphall-text-end']).toBe('640px');
    expect(pc[0].decls.background.replace(/\s+/g, ' ')).toBe(
      'linear-gradient(90deg, rgba(0, 0, 0, .62) 0, rgba(0, 0, 0, .54) var(--wc-iphall-text-end), rgba(0, 0, 0, 0) calc(var(--wc-iphall-text-end) + 280px))',
    );
    /* 모바일 폭과 모바일 배너만 있는 IP 의 데스크톱(키아트)에는 이 완화가 걸리지 않는다. */
    expect(rules.filter((rule) => rule.selector.includes('::before') && rule.selector.includes('wc-iphall__banner') && rule.media === '(max-width: 749px)')).toHaveLength(0);
    expect(rules.filter((rule) => rule.selector.includes("data-banner='mobile']::before"))).toHaveLength(0);
  });

  it('keeps the key art on desktop for a mobile-only banner without downloading the mobile art there', () => {
    const html = render({ banner: { imageUrl: null, mobileImageUrl: 'https://cdn.test/mo.webp' } });

    expect(sectionOf(html)).toBe('<section class="wc-iphall__banner" data-banner="mobile" style="--wc-iphall-keyart:linear-gradient(#111, #222)">');
    expect(html).toContain(`<source media="(min-width: 750px)" srcSet="${IP_HALL_BANNER_EMPTY_SOURCE}"/>`);
    expect(html).toContain('src="https://cdn.test/mo.webp"');
  });
});

describe('IpDetail goods section', () => {
  it('titles the goods list like the category screens and keeps sold-out goods', () => {
    const html = render();

    expect(html).toMatch(/<h2 class="wc-listing-head__title" id="iphall-goods-heading">메이플스토리의 상품<\/h2>/);
    expect(html).toContain('aria-labelledby="iphall-goods-heading"');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('href="/shop/g1"');
    expect(html).toContain('href="/shop/g2"');
  });

  it('links to the shop scoped to this ip', () => {
    const html = render();

    expect(html).toContain('전체 상품 보기');
    expect(html).toContain('href="/shop?ip=maplestory"');
  });

  /* 굿즈샵 카테고리 화면과 같은 틀 — 왼쪽 필터(타입·가격)·수량 줄·필터 시트가 없다. */
  it('has no filter sidebar, count row or filter sheet', () => {
    const html = render();

    expect(html).not.toContain('aria-label="상품 필터"');
    expect(html).not.toContain('wc-collection');
    expect(html).not.toContain('전체 ›');
    expect(html).not.toContain('전체 초기화');
    expect(html).toContain('class="wc-x-grid" data-density="listing"');
    expect(html).toContain('wc-listing-sort__select');
  });

  it('offers the seven listing sorts with recommended selected by default', () => {
    const html = render();
    const values = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);

    expect(values).toEqual(['recommended', 'popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews']);
    expect(html).toMatch(/<option[^>]*value="recommended"[^>]*selected/);
  });

  it('renders the server-computed collection with its sort applied and ignores the old type filter', () => {
    const html = render({ collection: collectionOf({ type: '키링', min: '10000', sort: 'price_asc' }) });

    /* 옛 ?type=·min= 링크는 무시된다 — 3개 모두 보이고 정렬만 적용된다. */
    expect(html).toContain('슬라임 인형');
    expect(html.indexOf('버섯 키링')).toBeLessThan(html.indexOf('단풍 키링'));
    expect(html.indexOf('단풍 키링')).toBeLessThan(html.indexOf('슬라임 인형'));
  });

  it('pages beyond twenty goods with VIEW MORE', () => {
    const many: CatalogIpDetail = {
      ...detail,
      goods: Array.from({ length: 25 }, (_, index) => ({ ...detail.goods[0], id: `m${index}`, name: `상품 ${index}` })),
    };
    const html = render({ detail: many });

    expect((html.match(/wc-product-card__name-link/g) ?? []).length).toBe(20);
    expect(html).toContain('VIEW MORE');
  });

  it('puts a listing heart on every card when the wish set is passed', () => {
    const html = render({ wishlist: { viewerId: 'viewer-1', goodIds: ['g3'] } });

    expect((html.match(/<button[^>]*class="wc-list-heart[ "]/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="버섯 키링 위시리스트에서 빼기"');
  });

  it('shows only the empty state when the hall has no goods', () => {
    const empty = render({ detail: { ...detail, goods: [] } });

    expect(empty).toContain('등록된 상품이 아직 없습니다');
    expect(empty).toContain('id="iphall-goods-heading"');
    expect(empty).not.toContain('wc-listing-sort__select');
    expect(empty).not.toContain('wc-x-grid');
  });
});

describe('IpDetail follow row', () => {
  it('puts follow and notification controls in one row under the banner, before the goods list', () => {
    const html = render({ followState: { isFollowed: true, notifyDrops: true, notifyEvents: false } });
    const bar = html.match(/<section aria-label="IP 알림" class="wc-iphall__bar">[\s\S]*?<\/section>/)?.[0] ?? '';

    expect(bar).toContain('wc-iphall__follow-heart');
    expect(bar).toContain('name="notifyDrops"');
    expect(bar).toContain('알림 설정 저장');
    expect(html.indexOf('</section>')).toBeLessThan(html.indexOf('wc-iphall__bar'));
    expect(html.indexOf('wc-iphall__bar')).toBeLessThan(html.indexOf('iphall-goods-heading'));
  });
});

describe('IpDetail link band', () => {
  const popup = { id: 'e1', title: '메이플 팝업', ip: 'maplestory', mode: '오프라인', status: '진행중', date: '11.1', loc: '서울', accent: '#fff', img: 'none' };

  /* 카드 바인더는 2026-11-24 지웠다(ADR-0052) — 카드 도감 링크 없이 오프라인 팝업·팬덤 채널 링크만 남는다. */
  it('links offline pop-ups and the fandom channel without a card codex', () => {
    const html = render({ detail: { ...detail, events: [popup] } });

    expect(html).not.toContain('href="/binder"');
    expect(html).not.toContain('카드 도감');
    expect(html).toContain('href="/offline-popups?ip=maplestory"');
    /* 팬덤 채널은 커뮤니티 임시 비공개 스위치를 따른다. */
    expect(html.includes('href="/community?ip=maplestory"')).toBe(COMMUNITY_ENABLED);
  });

  /* 진행·예매·예정 중인 오프라인 팝업이 없으면 링크 칸을 그리지 않는다(온라인 팝업·끝난 팝업은 세지 않는다). */
  it('shows the offline pop-up link only while this ip has a running or upcoming offline pop-up', () => {
    expect(render()).not.toContain('/offline-popups');
    expect(render({ detail: { ...detail, events: [{ ...popup, mode: '온라인' }] } })).not.toContain('/offline-popups');
    expect(render({ detail: { ...detail, events: [{ ...popup, status: '종료' }] } })).not.toContain('/offline-popups');
    expect(render({ detail: { ...detail, events: [{ ...popup, status: '예정' }] } })).toContain('/offline-popups');
  });
});
