import { describe, expect, it } from 'vitest';
import { CATEGORY_MEGA_GROUPS, hrefFor, STOREFRONT_MENU_ITEMS } from './routes';
import { configuredNavigationGroups, DEFAULT_STORE_NAVIGATION, parseStorefrontNavigation, parseStoreNavigation, resolveStorefrontNavigation, storefrontNavigation, storeMenuSheetGroups } from './store-navigation';

describe('공개 메뉴 설정 계약', () => {
  it('고정 8개 ID를 정확히 한 번 보존하고 실제 경로만 연결한다', () => {
    expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION)).toEqual(DEFAULT_STORE_NAVIGATION);
    for (const item of STOREFRONT_MENU_ITEMS) expect(hrefFor(item.id)).not.toBe('/');
    const invalid = [null, {}, DEFAULT_STORE_NAVIGATION.slice(1), [...DEFAULT_STORE_NAVIGATION, DEFAULT_STORE_NAVIGATION[0]],
      DEFAULT_STORE_NAVIGATION.map((item, index) => index === 0 ? { ...item, id: 'admin' } : item),
      DEFAULT_STORE_NAVIGATION.map((item, index) => index === 0 ? { ...item, id: 'best' } : item),
      DEFAULT_STORE_NAVIGATION.map(item => ({ ...item, href: '/admin' })),
      DEFAULT_STORE_NAVIGATION.map(item => item.id === 'shop' ? { ...item, visible: false } : item),
      DEFAULT_STORE_NAVIGATION.map(item => ({ ...item, visible: 'true' })),
    ];
    for (const value of invalid) expect(parseStoreNavigation(value)).toBeNull();
  });
  it('20 codepoint 한 줄 메뉴명과 공백·제어문자를 검증한다', () => {
    for (const label of ['', '  ', ' NEW', 'NEW\n', '가'.repeat(21), 'x\u007f']) {
      expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION.map(item => ({ ...item, label })))).toBeNull();
    }
    expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION.map(item => ({ ...item, label: '😀'.repeat(20) })))).not.toBeNull();
  });
  it('숨김 메뉴·내부 필드를 공개 응답에서 빼고 순서를 유지한다', () => {
    const settings = [...DEFAULT_STORE_NAVIGATION].reverse().map(item => item.id === 'new' ? { ...item, visible: false } : item);
    const projection = storefrontNavigation(settings);
    expect(projection.map(item => item.id)).toEqual(['stories', 'community', 'events', 'packs', 'iphub', 'shop', 'best']);
    expect(parseStorefrontNavigation(projection)).toEqual(projection);
    expect(parseStorefrontNavigation(settings)).toBeNull();
    expect(parseStorefrontNavigation(projection.filter(item => item.id !== 'shop'))).toBeNull();
    expect(parseStorefrontNavigation([...projection, projection[0]])).toBeNull();
  });
  it('메뉴 노출 설정으로 카드팩·커뮤니티 기능 게이트를 우회하지 못한다', () => {
    const projection = storefrontNavigation(DEFAULT_STORE_NAVIGATION);
    expect(resolveStorefrontNavigation(projection, false, false).map(item => item.id)).toEqual(['new', 'best', 'shop', 'iphub', 'events', 'stories']);
    expect(resolveStorefrontNavigation(projection, true, true)).toEqual(projection);
  });
  it('메뉴시트는 전체 순서와 이름을 공유하고 관련 메가 링크도 숨김을 존중한다', () => {
    const navigation = [{ id: 'events', label: '행사' }, { id: 'best', label: '인기 상품' }, { id: 'shop', label: '상품 분류' }];
    const sheet = storeMenuSheetGroups(navigation);
    expect(sheet[0]).toEqual({ heading: '스토어', items: navigation });
    expect(sheet.flatMap(group => group.items).filter(item => item.id === 'new')).toEqual([]);
    expect(sheet.flatMap(group => group.items).filter(item => item.id === 'shop')).toHaveLength(1);
    expect(sheet.find(group => group.heading === '내 활동')?.items.map(item => item.id)).toContain('orders');
    const mega = configuredNavigationGroups(CATEGORY_MEGA_GROUPS, navigation);
    expect(mega[0].items).toEqual([{ id: 'best', label: '인기 상품' }, { id: 'shop', label: '상품 분류' }]);
    expect(mega.flatMap(group => group.items).map(item => item.id)).not.toContain('packs');
    expect(mega.flatMap(group => group.items).map(item => item.id)).toContain('binder');
  });
});
