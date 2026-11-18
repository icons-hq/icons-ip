import { describe, expect, it } from 'vitest';
import {
  COLLECTIBLE_FEATURES_OFF,
  isCollectibleFeature,
  isHiddenCollectibleRoute,
  parseCollectibleFeatures,
} from './collectible-features';
import { isHiddenCollectibleDestination, withoutHiddenCollectibleCurations, type HomeCurationSnapshot } from './home-catalog';
import { CATEGORY_MEGA_GROUPS, MENU_SHEET_GROUPS, withoutHiddenCollectibleGroups, withoutHiddenCollectibleItems } from './routes';

const ON = { binder: true, market: true, exchange: true };

describe('카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치 값', () => {
  it('세 키가 정확히 불리언일 때만 통과하고, 나머지는 null(호출부가 꺼짐으로 읽는다)이다', () => {
    expect(parseCollectibleFeatures({ binder: true, market: false, exchange: false })).toEqual({ binder: true, market: false, exchange: false });
    for (const value of [null, undefined, true, 'true', [], {}, { binder: true, market: false }, { binder: 'true', market: false, exchange: false },
      { binder: true, market: false, exchange: false, community: true }]) {
      expect(parseCollectibleFeatures(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('기본값은 전부 꺼짐이고 바뀌지 않는다', () => {
    expect(COLLECTIBLE_FEATURES_OFF).toEqual({ binder: false, market: false, exchange: false });
    expect(Object.isFrozen(COLLECTIBLE_FEATURES_OFF)).toBe(true);
  });

  it('스위치는 세 기능 id 만 판정하고 다른 내비 항목은 건드리지 않는다', () => {
    expect(['binder', 'market', 'exchange'].every(isCollectibleFeature)).toBe(true);
    expect(isCollectibleFeature('packs')).toBe(false);
    expect(isHiddenCollectibleRoute('market', COLLECTIBLE_FEATURES_OFF)).toBe(true);
    expect(isHiddenCollectibleRoute('market', ON)).toBe(false);
    expect(isHiddenCollectibleRoute('packs', COLLECTIBLE_FEATURES_OFF)).toBe(false);
  });
});

describe('링크 묶음 거르기', () => {
  it('꺼진 기능 항목을 빼고, 비게 된 그룹은 제목째 걷어낸다', () => {
    const offGroups = withoutHiddenCollectibleGroups(CATEGORY_MEGA_GROUPS, COLLECTIBLE_FEATURES_OFF);
    expect(offGroups.map((group) => group.heading)).toEqual(['굿즈샵', '수집']);
    expect(offGroups.flatMap((group) => group.items.map((item) => item.id))).not.toEqual(expect.arrayContaining(['binder']));
    expect(withoutHiddenCollectibleGroups(CATEGORY_MEGA_GROUPS, ON)).toEqual(CATEGORY_MEGA_GROUPS);

    const sheet = withoutHiddenCollectibleGroups(MENU_SHEET_GROUPS, { binder: false, market: true, exchange: false });
    const ids = sheet.flatMap((group) => group.items.map((item) => item.id));
    expect(ids).toContain('market');
    expect(ids).not.toContain('binder');
    expect(ids).not.toContain('exchange');
    expect(withoutHiddenCollectibleItems([{ id: 'exchange', label: '카드 트레이드' }, { id: 'shop', label: '전체 굿즈' }], COLLECTIBLE_FEATURES_OFF))
      .toEqual([{ id: 'shop', label: '전체 굿즈' }]);
  });
});

describe('큐레이션·공지 목적지 거르기', () => {
  it('꺼진 기능의 경로와 그 하위 경로·쿼리를 숨기고, 비슷한 다른 경로와 켜진 기능은 남긴다', () => {
    for (const href of ['/binder', '/binder/', '/market?tab=1', '/exchange/abc', '/%62inder', 'https://icons.local/market']) {
      expect(isHiddenCollectibleDestination(href, COLLECTIBLE_FEATURES_OFF), href).toBe(true);
    }
    for (const href of ['/binders', '/marketing', '/shop/market', '/events']) {
      expect(isHiddenCollectibleDestination(href, COLLECTIBLE_FEATURES_OFF), href).toBe(false);
    }
    expect(isHiddenCollectibleDestination('/binder', ON)).toBe(false);
    expect(isHiddenCollectibleDestination('/binder', { binder: true, market: false, exchange: false })).toBe(false);
    expect(isHiddenCollectibleDestination('/market', { binder: true, market: false, exchange: false })).toBe(true);
    /* 해석할 수 없는 주소는 안전하게 숨긴다(카드 리워드 판정과 같다). */
    expect(isHiddenCollectibleDestination('/%E0%A4%A', COLLECTIBLE_FEATURES_OFF)).toBe(true);
  });

  it('홈 큐레이션의 모든 링크 지면에서 꺼진 기능 목적지만 걸러낸다', () => {
    const curation = {
      heroSlides: [{ href: '/binder' }, { href: null }, { href: '/events' }],
      editorPicks: [{ href: '/market' }, { href: '/shop' }],
      goodsBands: [{ href: '/exchange' }, { href: '/shop/best' }],
      benefitTiles: [{ href: '/binder' }, { href: '/events/x' }],
      stripBanner: { href: '/market' },
    } as unknown as HomeCurationSnapshot;

    const filtered = withoutHiddenCollectibleCurations(curation, COLLECTIBLE_FEATURES_OFF);
    expect(filtered.heroSlides.map((slide) => slide.href)).toEqual([null, '/events']);
    expect(filtered.editorPicks.map((pick) => pick.href)).toEqual(['/shop']);
    expect(filtered.goodsBands.map((band) => band.href)).toEqual(['/shop/best']);
    expect(filtered.benefitTiles.map((tile) => tile.href)).toEqual(['/events/x']);
    expect(filtered.stripBanner).toBeNull();
    expect(withoutHiddenCollectibleCurations(curation, ON)).toEqual(curation);
  });
});
