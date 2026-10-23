import { describe, expect, it } from 'vitest';
import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { Card, FandomEvent, Good, Ip, Vertical } from './data';
import {
  benefitTileIcon,
  buildHomeIpWorld,
  getHomeSelectableIps,
  isCommunityDestination,
  MAX_HOME_PICKER_IPS,
  prioritizeHomePostPreviews,
  readHomeGoodsSelection,
  resolveHomeLatestGoodsCards,
  resolveHomeGoodsCards,
  withoutCommunityCurations,
  withoutCardRewardCurations,
  type HomeCurationSnapshot,
} from './home-catalog';

const vertical: Vertical = { key: 'global', label: '글로벌 IP', color: '#2DE2FF' };

it('링크 없는 프로모션 배너는 카드·커뮤니티 게이트와 무관하게 남긴다', () => {
  const curation: HomeCurationSnapshot = { hero: null, announcement: null, featuredIpIds: [], editorPicks: [], goodsBands: [], categoryBestTabs: [], popularTabs: [], benefitTiles: [],
    heroSlides: [{ id: 'no-link', title: '', subtitle: null, imageUrl: '/banner.webp', mobileImageUrl: null, href: null }] };
  expect(withoutCommunityCurations(withoutCardRewardCurations(curation)).heroSlides).toEqual(curation.heroSlides);
});

/* LD-15(11 DT-11): 게이트 OFF 는 혜택 밴드를 통째로 비우지 않는다 — 카드팩·게임 목적지 타일만 뺀다. */
it('게이트가 꺼지면 카드팩·게임으로 가는 혜택 타일만 걸러내고 나머지 혜택은 남긴다', () => {
  const curation: HomeCurationSnapshot = { hero: null, announcement: null, featuredIpIds: [], heroSlides: [], editorPicks: [], goodsBands: [], categoryBestTabs: [], popularTabs: [],
    benefitTiles: [
      { id: 'packs', title: '카드팩', description: null, href: '/packs' },
      { id: 'game', title: '게임', description: null, href: '/games/reward?x=1' },
      { id: 'coupon', title: '쿠폰', description: null, href: '/events/welcome' },
      { id: 'broken', title: '깨진 링크', description: null, href: 'http://[' },
    ] };

  expect(withoutCardRewardCurations(curation).benefitTiles.map((tile) => tile.id)).toEqual(['coupon']);
  expect(curation.benefitTiles).toHaveLength(4);
});

/* 커뮤니티 노출 게이트는 카드 리워드 게이트와 별개다 — 혜택 타일도 다른 큐레이션처럼 커뮤니티 목적지를 거른다.
   게이트 OFF(홈 순서: 카드 → 커뮤니티)와 게이트 ON 두 경로 모두에서 커뮤니티 타일이 남지 않아야 한다. */
it('커뮤니티가 닫히면 커뮤니티로 가는 혜택 타일도 카드 게이트와 무관하게 걸러낸다', () => {
  const curation: HomeCurationSnapshot = { hero: null, announcement: null, featuredIpIds: [], heroSlides: [], editorPicks: [], goodsBands: [], categoryBestTabs: [], popularTabs: [],
    benefitTiles: [
      { id: 'community-events', title: '팬 이벤트', description: null, href: '/community/events' },
      { id: 'community', title: '커뮤니티', description: null, href: '/community' },
      { id: 'packs', title: '카드팩', description: null, href: '/packs' },
      { id: 'coupon', title: '쿠폰', description: null, href: '/events/first' },
      { id: 'lookalike', title: '비슷한 경로', description: null, href: '/communitylike' },
      { id: 'broken', title: '깨진 링크', description: null, href: 'http://[' },
    ] };

  expect(withoutCommunityCurations(withoutCardRewardCurations(curation)).benefitTiles.map((tile) => tile.id)).toEqual(['coupon', 'lookalike']);
  expect(withoutCommunityCurations(curation).benefitTiles.map((tile) => tile.id)).toEqual(['packs', 'coupon', 'lookalike']);
  expect(curation.benefitTiles).toHaveLength(6);
});

it('혜택 타일 아이콘은 목적지에서 ICONS 아이콘 이름으로 고른다', () => {
  expect(benefitTileIcon('/packs')).toBe('card');
  expect(benefitTileIcon('/packs/season-1')).toBe('card');
  expect(benefitTileIcon('/games/marble')).toBe('spark');
  expect(benefitTileIcon('/events/welcome')).toBe('event');
  expect(benefitTileIcon('/review-events/abc')).toBe('event');
  expect(benefitTileIcon('/shop?type=%ED%82%A4%EB%A7%81')).toBe('shop');
  expect(benefitTileIcon('/ip/rilakkuma')).toBe('ip');
  expect(benefitTileIcon('/my/coupons')).toBe('star');
  expect(benefitTileIcon('/packsale')).toBe('star');
});

describe('automatic home goods selection', () => {
  it('keeps the sale-period reason and boundary in compact home cards', () => {
    const salePeriod = { state: 'scheduled' as const, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-15T00:00:00Z', calculatedAt: '2026-10-13T00:00:00Z', nextChangeAt: '2026-10-14T00:00:00Z' };
    const selected = resolveHomeGoodsCards({ ips: [ip('brand')], goods: [{ ...good('scheduled', 'brand'), stock: 'soldout', stockQty: 0, salePeriod }] }, ['scheduled'], 1);
    expect(selected).toHaveLength(1); expect(selected[0].salePeriod).toEqual(salePeriod); expect(selected[0].href).toBe('/shop/scheduled');
  });
  it('keeps old manual payloads and rejects ambiguous or malformed automatic rules', () => {
    expect(readHomeGoodsSelection({ good_ids: ['g2', 'g1'] })).toEqual({ mode: 'manual', goodIds: ['g2', 'g1'] });
    expect(readHomeGoodsSelection({ selection_mode: 'latest', item_count: 6 })).toEqual({ mode: 'latest', count: 6 });
    for (const payload of [
      { selection_mode: 'latest' }, { selection_mode: 'latest', item_count: 2 },
      { selection_mode: 'latest', item_count: 11 }, { selection_mode: 'latest', item_count: 3.5 },
      { selection_mode: 'latest', item_count: '3' }, { selection_mode: 'latest', item_count: 3, good_ids: ['g1'] },
      { selection_mode: 'popular', item_count: 3 }, { item_count: 3 },
    ]) expect(readHomeGoodsSelection(payload)).toBeNull();
  });

  it('uses real registration dates, keeps ties stable and never fills missing catalog entries', () => {
    const goods = [
      { ...good('older', 'brand'), createdAt: '2026-01-01T00:00:00Z' },
      { ...good('new-b', 'brand'), createdAt: '2026-10-12T00:00:00Z' },
      { ...good('new-a', 'brand'), createdAt: '2026-10-12T00:00:00Z' },
      good('unknown', 'brand'),
      { ...good('invalid', 'brand'), createdAt: 'invalid' },
    ];
    const catalog = { ips: [ip('brand')], goods };
    expect(resolveHomeLatestGoodsCards(catalog, 3).map((row) => row.id)).toEqual(['new-a', 'new-b', 'older']);
    expect(resolveHomeLatestGoodsCards({ ...catalog, goods: goods.filter((row) => row.id !== 'new-a') }, 3).map((row) => row.id)).toEqual(['new-b', 'older']);
    expect(resolveHomeLatestGoodsCards(catalog, 11)).toEqual([]);
    expect(goods[0].id).toBe('older');
  });
});

function ip(id: string, featured = false): Ip {
  return {
    id,
    title: `IP ${id}`,
    sub: '테스트',
    v: vertical,
    glyph: id.toUpperCase(),
    bg: `bg-${id}`,
    fans: 1000,
    goods: 1,
    cards: 1,
    featured,
    tagline: `${id} tagline`,
    synopsis: `${id} synopsis`,
  };
}

function good(id: string, ipId: string): Good {
  return {
    id,
    ip: ipId,
    name: `Good ${id}`,
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 10,
    img: `good-${id}`,
  };
}

function card(id: string, ipId: string): Card {
  return {
    id,
    ip: ipId,
    name: `Card ${id}`,
    no: '001/010',
    rarity: 'SR',
    owned: false,
    bg: `card-${id}`,
  };
}

function event(id: string, ipId: string | null): FandomEvent {
  return {
    id,
    ip: ipId,
    title: `Event ${id}`,
    mode: '오프라인',
    status: '예정',
    date: '6.30',
    loc: '서울',
    accent: '#2DE2FF',
    img: `event-${id}`,
  };
}

function post(id: string, ipName: string): CatalogPostPreview {
  return {
    id,
    user: `user-${id}`,
    ipName,
    avatar: '#2DE2FF',
    text: `${id} text`,
    likes: 10,
    comments: 2,
    time: '방금 전',
    tag: '후기',
  };
}

function catalog(overrides: Partial<CatalogSnapshot>): CatalogSnapshot {
  return {
    source: 'mock',
    verticals: [vertical],
    ips: [],
    goods: [],
    cards: [],
    events: [],
    ...overrides,
  };
}

describe('getHomeSelectableIps', () => {
  it('returns featured IPs first and caps the picker at five entries', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('featured-1', true),
        ip('featured-2', true),
        ip('featured-3', true),
        ip('featured-4', true),
        ip('featured-5', true),
        ip('featured-6', true),
        ip('regular-1'),
      ],
    }));

    expect(selectable).toHaveLength(MAX_HOME_PICKER_IPS);
    expect(selectable.map((item) => item.id)).toEqual([
      'featured-1',
      'featured-2',
      'featured-3',
      'featured-4',
      'featured-5',
    ]);
  });

  it('falls back to the first five IPs when no featured IP exists', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [ip('one'), ip('two'), ip('three'), ip('four'), ip('five'), ip('six')],
    }));

    expect(selectable.map((item) => item.id)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('uses curated IP order, removes duplicates and missing IDs, and only then caps at five', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('one', true),
        ip('two'),
        ip('three'),
        ip('four'),
        ip('five'),
        ip('six'),
      ],
    }), ['missing', 'six', 'six', 'five', 'four', 'three', 'two', 'one']);

    expect(selectable.map((item) => item.id)).toEqual(['six', 'five', 'four', 'three', 'two']);
  });

  it('falls back to the first five catalog IPs for an explicit empty Supabase curation', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [
        ip('regular-first'),
        ip('legacy-featured', true),
        ip('three'),
        ip('four'),
        ip('five'),
        ip('six'),
      ],
    }), []);

    expect(selectable.map((item) => item.id)).toEqual([
      'regular-first',
      'legacy-featured',
      'three',
      'four',
      'five',
    ]);
  });

  it('falls back to the first five catalog IPs when no curated ID exists in the catalog', () => {
    const selectable = getHomeSelectableIps(catalog({
      ips: [ip('regular-first'), ip('legacy-featured', true), ip('three')],
    }), ['missing', 'also-missing']);

    expect(selectable.map((item) => item.id)).toEqual(['regular-first', 'legacy-featured', 'three']);
  });

  it('keeps the legacy featured fallback only when curated IDs are undefined', () => {
    const snapshot = catalog({
      ips: [ip('regular-first'), ip('legacy-featured', true), ip('regular-last')],
    });

    expect(getHomeSelectableIps(snapshot, undefined).map((item) => item.id)).toEqual(['legacy-featured']);
    expect(getHomeSelectableIps(snapshot, []).map((item) => item.id)).toEqual([
      'regular-first',
      'legacy-featured',
      'regular-last',
    ]);
  });
});

describe('buildHomeIpWorld', () => {
  it('uses the first selectable IP as the default selection', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true), ip('regular-1')],
    }));

    expect(world.selectedIp?.id).toBe('featured-1');
    expect(world.selectableIps.map((item) => item.id)).toEqual(['featured-1', 'featured-2']);
  });

  it('derives representative goods, cards, and events from the selected IP only', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('hwasan', true), ip('lumen', true)],
      goods: [good('other-good', 'lumen'), good('selected-good', 'hwasan')],
      cards: [card('other-card', 'lumen'), card('selected-card', 'hwasan')],
      events: [event('global-event', null), event('other-event', 'lumen'), event('selected-event', 'hwasan')],
    }), 'hwasan', {
      hwasan: post('selected-post', 'IP hwasan'),
      lumen: post('other-post', 'IP lumen'),
    });

    expect(world.representativeGood?.id).toBe('selected-good');
    expect(world.representativeCard?.id).toBe('selected-card');
    expect(world.representativeEvent?.id).toBe('selected-event');
    expect(world.representativePost?.id).toBe('selected-post');
  });

  it('recovers to the default IP when the requested selection is not available', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true)],
      goods: [good('default-good', 'featured-1'), good('other-good', 'featured-2')],
      cards: [card('default-card', 'featured-1')],
      events: [event('default-event', 'featured-1')],
    }), 'missing');

    expect(world.selectedIp?.id).toBe('featured-1');
    expect(world.representativeGood?.id).toBe('default-good');
  });

  it('uses null representative post when the selected IP has no preview', () => {
    const world = buildHomeIpWorld(catalog({
      ips: [ip('featured-1', true), ip('featured-2', true)],
    }), 'featured-2', {
      'featured-1': post('default-post', 'IP featured-1'),
    });

    expect(world.selectedIp?.id).toBe('featured-2');
    expect(world.representativePost).toBeNull();
  });
});

describe('prioritizeHomePostPreviews', () => {
  it('moves followed-IP previews first while preserving both groups order', () => {
    const previews = {
      hwasan: post('hwasan', 'IP hwasan'),
      lumen: post('lumen', 'IP lumen'),
      maple: post('maple', 'IP maple'),
    };

    expect(prioritizeHomePostPreviews(previews, new Set(['lumen', 'maple'])).map(([ipId]) => ipId)).toEqual([
      'lumen',
      'maple',
      'hwasan',
    ]);
  });

  it('keeps the existing order and excludes empty previews when there are no follows', () => {
    const previews = {
      hwasan: post('hwasan', 'IP hwasan'),
      empty: null,
      lumen: post('lumen', 'IP lumen'),
    };

    expect(prioritizeHomePostPreviews(previews, new Set()).map(([ipId]) => ipId)).toEqual(['hwasan', 'lumen']);
  });

  it('uses explicit selectable order for numeric-like IP IDs', () => {
    const previews = {
      '10': post('ten', 'IP ten'),
      '2': post('two', 'IP two'),
    };

    expect(
      prioritizeHomePostPreviews(previews, new Set(), ['10', '2']).map(([ipId]) => ipId),
    ).toEqual(['10', '2']);
  });
});

describe('커뮤니티 목적지 큐레이션 필터', () => {
  it('커뮤니티 경로만 목적지로 판정하고 파싱 불가 href는 안전하게 게이트한다', () => {
    expect(isCommunityDestination('/community')).toBe(true);
    expect(isCommunityDestination('/community?ip=rilakkuma')).toBe(true);
    expect(isCommunityDestination('/community/post/1')).toBe(true);
    expect(isCommunityDestination('/communityhub')).toBe(false);
    expect(isCommunityDestination('/shop')).toBe(false);
    expect(isCommunityDestination('%')).toBe(true);
  });

  it('히어로·에디터픽·굿즈밴드에서 커뮤니티 목적지만 걷어낸다', () => {
    const curation = {
      heroSlides: [
        { id: 'h1', title: '커뮤니티', subtitle: null, imageUrl: 'a', mobileImageUrl: null, href: '/community' },
        { id: 'h2', title: '굿즈샵', subtitle: null, imageUrl: 'b', mobileImageUrl: null, href: '/shop' },
      ],
      editorPicks: [
        { id: 'p1', title: '팬덤', imageUrl: 'c', href: '/community?tag=notice' },
        { id: 'p2', title: '이벤트', imageUrl: 'd', href: '/events' },
      ],
      goodsBands: [
        { id: 'b1', title: '커뮤니티 밴드', href: '/community', goods: [] },
        { id: 'b2', title: '신상', href: '/shop/new', goods: [] },
      ],
      categoryBestTabs: [],
      popularTabs: [],
      benefitTiles: [],
    } as unknown as HomeCurationSnapshot;

    const filtered = withoutCommunityCurations(curation);

    expect(filtered.heroSlides.map((slide) => slide.href)).toEqual(['/shop']);
    expect(filtered.editorPicks.map((pick) => pick.href)).toEqual(['/events']);
    expect(filtered.goodsBands.map((band) => band.href)).toEqual(['/shop/new']);
  });
});
