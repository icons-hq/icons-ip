import { describe, expect, it } from 'vitest';
import { CATEGORY_MEGA_GROUPS, CATEGORY_SHEET_SHORTCUTS, hrefFor, STOREFRONT_MENU_ITEMS } from './routes';
import { configuredNavigationGroups, DEFAULT_STORE_NAVIGATION, DEFAULT_STOREFRONT_NAVIGATION, parseStorefrontNavigation, parseStoreNavigation, resolveStorefrontNavigation, RETIRED_STORE_MENU_IDS, storefrontNavigation, storeMenuSheetGroups, type StorefrontNavigation } from './store-navigation';

describe('공개 메뉴 설정 계약', () => {
  it('고정 9개 ID를 정확히 한 번 보존하고 실제 경로만 연결한다', () => {
    expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION)).toEqual(DEFAULT_STORE_NAVIGATION);
    /* 카드팩('packs')은 2026-11-24 지운 퇴역 칸이다(ADR-0052) — DB 저장 계약 때문에 ID만 남고 경로는 없다. */
    expect([...RETIRED_STORE_MENU_IDS]).toEqual(['packs']);
    for (const item of STOREFRONT_MENU_ITEMS) {
      if (RETIRED_STORE_MENU_IDS.has(item.id)) expect(hrefFor(item.id)).toBe('/');
      else expect(hrefFor(item.id)).not.toBe('/');
    }
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
    const settings = [...DEFAULT_STORE_NAVIGATION].reverse().map(item => ({ ...item, visible: item.id !== 'new' }));
    const projection = storefrontNavigation(settings);
    expect(projection.map(item => item.id)).toEqual(['stories', 'community', 'packs', 'iphub', 'events', 'popups', 'shop', 'best']);
    expect(parseStorefrontNavigation(projection)).toEqual(projection);
    expect(parseStorefrontNavigation(settings)).toBeNull();
    expect(parseStorefrontNavigation(projection.filter(item => item.id !== 'shop'))).toBeNull();
    expect(parseStorefrontNavigation([...projection, projection[0]])).toBeNull();
  });
  it('메뉴 노출 설정으로 커뮤니티 기능 게이트를 우회하지 못하고, 퇴역한 카드팩 칸은 켜져 있어도 그리지 않는다', () => {
    const projection = storefrontNavigation(DEFAULT_STORE_NAVIGATION.map(item => ({ ...item, visible: true })));
    expect(resolveStorefrontNavigation(projection, false).map(item => item.id)).toEqual(['new', 'best', 'shop', 'popups', 'events', 'iphub', 'stories']);
    expect(resolveStorefrontNavigation(projection, true)).toEqual(projection.filter(item => item.id !== 'packs'));
  });
  it('메뉴시트는 전체 순서와 이름을 공유하고 관련 메가 링크도 숨김을 존중한다', () => {
    const navigation = [{ id: 'events', label: '행사' }, { id: 'best', label: '인기 상품' }, { id: 'shop', label: '상품 분류' }];
    const sheet = storeMenuSheetGroups(navigation);
    expect(sheet[0]).toEqual({ heading: '스토어', items: navigation });
    expect(sheet.flatMap(group => group.items).filter(item => item.id === 'new')).toEqual([]);
    expect(sheet.flatMap(group => group.items).filter(item => item.id === 'shop')).toHaveLength(1);
    expect(sheet.find(group => group.heading === '내 활동')?.items.map(item => item.id)).toContain('orders');
    const mega = configuredNavigationGroups(CATEGORY_MEGA_GROUPS, navigation);
    /* 메가메뉴 트리거(shop)의 운영 이름은 메뉴 이름이다 — 메뉴 안의 /shop 링크는 '전체 굿즈'로 남는다(CH-06). */
    expect(mega[0].items).toEqual([{ id: 'best', label: '인기 상품' }, { id: 'shop', label: '전체 상품' }]);
    expect(mega.flatMap(group => group.items).map(item => item.id)).not.toContain('packs');
    expect(mega.flatMap(group => group.items).map(item => item.id)).not.toContain('binder');
  });
  it('기본 메뉴에서도 메가메뉴의 전체 상품 링크가 GNB 트리거 이름으로 덮이지 않는다', () => {
    const mega = configuredNavigationGroups(CATEGORY_MEGA_GROUPS, storefrontNavigation(DEFAULT_STORE_NAVIGATION));
    const goods = mega.find(group => group.heading === '쇼핑');
    expect(goods?.items).toEqual([{ id: 'new', label: 'NEW' }, { id: 'best', label: 'BEST' }, { id: 'shop', label: '전체 상품' }]);
    expect(mega.flatMap(group => group.items).map(item => item.label)).not.toContain('카테고리');
  });
});

/* X SQUARE GNB(ADR-0043, 2026-11-17) — 새 기본 메뉴, 쇼핑스토리 제거(MD-0035), 옛 8개 저장값의 관용 파싱. */
describe('X SQUARE 기본 메뉴', () => {
  it('기본 노출은 NEW·BEST·카테고리·POP-UP·EVENT이고 나머지 네 메뉴는 숨김이다', () => {
    expect(DEFAULT_STORE_NAVIGATION.map(item => `${item.id}:${item.label}:${item.visible}`)).toEqual([
      'new:NEW:true', 'best:BEST:true', 'shop:카테고리:true', 'popups:POP-UP:true', 'events:EVENT:true',
      'iphub:온라인 팝업:false', 'packs:카드팩:false', 'community:커뮤니티:false', 'stories:쇼핑스토리:false',
    ]);
    expect(DEFAULT_STOREFRONT_NAVIGATION).toEqual([
      { id: 'new', label: 'NEW' }, { id: 'best', label: 'BEST' }, { id: 'shop', label: '카테고리' }, { id: 'popups', label: 'POP-UP' }, { id: 'events', label: 'EVENT' },
    ]);
    /* 공개 기본은 보이는 항목의 id·이름뿐이다 — 공개 응답 계약(parseStorefrontNavigation)과 같은 모양. */
    expect(parseStorefrontNavigation(DEFAULT_STOREFRONT_NAVIGATION)).toEqual(DEFAULT_STOREFRONT_NAVIGATION);
    expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION)).toEqual(DEFAULT_STORE_NAVIGATION);
  });

  /* MD-0035 "카테고리에 쇼핑스토리 항목 삭제": GNB·모바일 탭·카테고리 시트 바로가기·전체 메뉴 시트에서 한 번에 빠진다(/stories 화면 자체는 남는다). */
  it('쇼핑스토리는 기본 메뉴의 GNB·카테고리 시트 바로가기·전체 메뉴 시트 어디에도 나오지 않고, 운영자가 켜면 모두에 돌아온다', () => {
    const idsOf = (navigation: StorefrontNavigation) => {
      const items = resolveStorefrontNavigation(navigation, true);
      return {
        gnb: items.map(item => item.id),
        shortcuts: configuredNavigationGroups([CATEGORY_SHEET_SHORTCUTS], items)[0].items.map(item => item.id),
        sheet: storeMenuSheetGroups(items).flatMap(group => group.items).map(item => item.id),
      };
    };
    const hidden = idsOf(DEFAULT_STOREFRONT_NAVIGATION);
    expect(hidden.gnb).not.toContain('stories');
    expect(hidden.shortcuts).toEqual(['new', 'best', 'shop', 'events']);
    expect(hidden.sheet).not.toContain('stories');
    /* 같은 규칙으로 온라인 팝업(IP관 디렉토리)도 기본 메뉴에서는 전체 메뉴 시트에 없다. */
    expect(hidden.sheet).not.toContain('iphub');
    const shown = idsOf([...DEFAULT_STOREFRONT_NAVIGATION, { id: 'stories', label: '쇼핑스토리' }]);
    expect(shown.gnb).toContain('stories');
    expect(shown.shortcuts).toContain('stories');
    expect(shown.sheet).toContain('stories');
    /* 바로가기 이름은 운영 메뉴 이름을 따른다 — 이벤트가 EVENT 로 바뀐다. */
    expect(configuredNavigationGroups([CATEGORY_SHEET_SHORTCUTS], resolveStorefrontNavigation(DEFAULT_STOREFRONT_NAVIGATION, true))[0].items.find(item => item.id === 'events')).toEqual({ id: 'events', label: 'EVENT' });
  });

  /* 이행 전에 저장된 8개짜리 설정은 버리지 않는다 — popups(POP-UP, 노출)를 카테고리 바로 뒤에 끼워 9개로 읽는다. DB 이행과 같은 규칙. */
  describe('옛 8개 저장값 관용 파싱', () => {
    const legacy = DEFAULT_STORE_NAVIGATION.filter(item => item.id !== 'popups');

    it('popups 없는 8개를 받으면 카테고리 바로 뒤에 노출 상태로 끼운 9개를 돌려준다', () => {
      const parsed = parseStoreNavigation(legacy);
      expect(parsed?.map(item => item.id)).toEqual(['new', 'best', 'shop', 'popups', 'events', 'iphub', 'packs', 'community', 'stories']);
      expect(parsed?.[3]).toEqual({ id: 'popups', label: 'POP-UP', visible: true });
      /* 나머지 이름·노출은 그대로다. */
      expect(parsed?.filter(item => item.id !== 'popups')).toEqual(legacy);
    });

    it('운영자가 바꾼 순서·이름·노출을 보존하고 카테고리 위치를 따라 끼운다', () => {
      const custom = [...legacy].reverse().map(item => item.id === 'stories' ? { ...item, label: '스토리', visible: true } : item);
      const parsed = parseStoreNavigation(custom);
      const ids = parsed?.map(item => item.id) ?? [];
      expect(ids).toEqual(['stories', 'community', 'packs', 'iphub', 'events', 'shop', 'popups', 'best', 'new']);
      expect(parsed?.find(item => item.id === 'stories')).toEqual({ id: 'stories', label: '스토리', visible: true });
    });

    it('개수·중복·미지 id·숨긴 카테고리가 어긋난 값은 그대로 거절한다', () => {
      expect(parseStoreNavigation(legacy.slice(1))).toBeNull();
      expect(parseStoreNavigation([...legacy.slice(1), legacy[1]])).toBeNull();
      expect(parseStoreNavigation(legacy.map((item, index) => index === 0 ? { ...item, id: 'admin' } : item))).toBeNull();
      expect(parseStoreNavigation(legacy.map(item => item.id === 'shop' ? { ...item, visible: false } : item))).toBeNull();
      expect(parseStoreNavigation(legacy.map(item => ({ ...item, href: '/admin' })))).toBeNull();
      /* 9개 중 popups 를 다른 id 로 바꾼 값도, popups 를 갖고 다른 하나가 빠진 8개도 옛 저장값이 아니다. */
      expect(parseStoreNavigation(DEFAULT_STORE_NAVIGATION.filter(item => item.id !== 'new'))).toBeNull();
    });

    it('공개 목록 파싱은 그대로다 — 보이는 항목만 받고 popups 가 없으면 숨김으로 본다', () => {
      const projection = storefrontNavigation(legacy);
      expect(parseStorefrontNavigation(projection)).toEqual(projection);
      expect(projection.map(item => item.id)).not.toContain('popups');
    });
  });
});

