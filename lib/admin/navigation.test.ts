import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUPS,
  ADMIN_SCREENS,
  ADMIN_NAV_GROUPS_KEY,
  ADMIN_NAV_TIER_KEY,
  adminGroupForPath,
  adminNavGroupsForView,
  adminNavTierValue,
  adminScreenForPath,
  isAdminNavShowingAll,
  isNavGroupCollapsed,
  parseNavGroupState,
  serializeNavGroupState,
  toggleNavGroup,
  legacyAdminSectionHref,
  visibleAdminNavGroups,
} from './navigation';

describe('어드민 IA 정의', () => {
  it('화면 id와 경로가 서로 겹치지 않는다', () => {
    const ids = ADMIN_SCREENS.map((screen) => screen.id);
    const hrefs = ADMIN_SCREENS.map((screen) => screen.href);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('모든 경로가 /admin 아래에 있다', () => {
    for (const screen of ADMIN_SCREENS) {
      expect(screen.href === '/admin' || screen.href.startsWith('/admin/')).toBe(true);
    }
  });

  /* 기존 17개 섹션이 하나도 빠지지 않고 새 IA에 자리를 잡아야 한다.
   * 하나라도 빠지면 그 화면은 메뉴에서 사라진 채 라우트만 남는다. */
  it('기존 섹션 17개가 전부 ready 화면으로 재배치돼 있다', () => {
    const readyHrefs = new Set(
      ADMIN_SCREENS.filter((screen) => screen.status === 'ready').map((screen) => screen.href),
    );
    const legacySections = [
      'overview', 'orders', 'ip', 'good', 'card', 'pool', 'policy', 'grants',
      'game', 'event', 'ticket', 'curations', 'notifications', 'emails',
      'moderation', 'members', 'roles',
    ];

    for (const section of legacySections) {
      const href = legacyAdminSectionHref(section) ?? '/admin';
      expect(readyHrefs.has(href)).toBe(true);
    }
  });

  /* S8 화면 두 개(#330). 메뉴에 자리가 없으면 라우트만 있고 아무도 못 찾는다. */
  it('캠페인과 상품 Q&A가 각자의 대분류에 붙어 있다', () => {
    const campaigns = ADMIN_SCREENS.find((screen) => screen.id === 'campaigns');
    const qna = ADMIN_SCREENS.find((screen) => screen.id === 'qna');

    expect(campaigns).toMatchObject({ href: '/admin/display/campaigns', status: 'ready' });
    expect(qna).toMatchObject({ href: '/admin/cs/qna', status: 'ready' });
    expect(adminGroupForPath('/admin/display/campaigns')?.id).toBe('display');
    expect(adminGroupForPath('/admin/cs/qna')?.id).toBe('cs');
  });
});

describe('편성 / 원장 / 거래 재편', () => {
  it('대분류 10개를 편성 → 원장 → 거래 → 공통 순으로 세우고, 매일 쓰지 않는 셋은 뒤로 뺀다', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.id)).toEqual([
      'home', 'popups', 'display', 'catalog', 'sales', 'cs', 'stats', 'fandom', 'events', 'settings',
    ]);
  });

  it('커머스 원장과 팬덤 원장이 다른 대분류에 있다', () => {
    expect(adminGroupForPath('/admin/catalog/goods')?.id).toBe('catalog');
    expect(adminGroupForPath('/admin/catalog/cards')?.id).toBe('fandom');
    expect(adminGroupForPath('/admin/catalog/events')?.id).toBe('events');
    expect(adminGroupForPath('/admin/sales/coupons')?.id).toBe('display');
    expect(adminGroupForPath('/admin/community/members')?.id).toBe('cs');
  });

  /* planned 는 설계서 v2 모듈의 자리다. 여기 없는 planned 가 생기면 라우트 없는 메뉴다. */
  it('준비 중 자리 표시는 설계서 v2 모듈 4개뿐이다 (팝업 목록·편성은 팝업 객체 슬라이스로 열림)', () => {
    expect(ADMIN_SCREENS.filter((screen) => screen.status === 'planned').map((screen) => screen.id)).toEqual([
      'promotions', 'auto-notifications', 'customer-history', 'stats-ips',
    ]);
  });
});

describe('adminScreenForPath', () => {
  /* /admin 이 모든 경로의 접두라서 접두 일치만 쓰면 전부 개요로 떨어진다. */
  it('개요는 정확히 /admin 일 때만 고른다', () => {
    expect(adminScreenForPath('/admin')?.id).toBe('overview');
    expect(adminScreenForPath('/admin/sales/orders')?.id).toBe('orders');
    expect(adminScreenForPath('/admin/catalog/goods')?.id).toBe('goods');
  });

  it('하위 경로는 가장 긴 접두 화면으로 붙는다', () => {
    expect(adminScreenForPath('/admin/sales/claims/cancels')?.id).toBe('claims-cancels');
    expect(adminScreenForPath('/admin/catalog/goods/some-id')?.id).toBe('goods');
  });

  it('끝 슬래시를 붙여도 같은 화면을 고른다', () => {
    expect(adminScreenForPath('/admin/catalog/cards/')?.id).toBe('cards');
  });

  it('어드민 밖 경로는 화면이 없다', () => {
    expect(adminScreenForPath('/shop')).toBeNull();
  });

  it('화면이 속한 대분류를 찾는다', () => {
    expect(adminGroupForPath('/admin/catalog/pools')?.label).toBe('팬덤 콘텐츠');
    expect(adminGroupForPath('/admin/community/roles')?.label).toBe('고객·CS');
  });
});

describe('legacyAdminSectionHref', () => {
  /* 예전 딥링크 허용 목록은 11개뿐이었고 나머지는 조용히 개요로 떨어졌다.
   * 리다이렉트는 상세 레코드 선택 없이 화면만 열면 되므로 17개를 전부 매핑한다. */
  it('구 섹션 딥링크를 새 라우트로 옮긴다', () => {
    expect(legacyAdminSectionHref('orders')).toBe('/admin/sales/orders');
    expect(legacyAdminSectionHref('ip')).toBe('/admin/catalog/ips');
    expect(legacyAdminSectionHref('ticket')).toBe('/admin/catalog/ticket-types');
    expect(legacyAdminSectionHref('emails')).toBe('/admin/messaging/emails');
    expect(legacyAdminSectionHref('roles')).toBe('/admin/community/roles');
  });

  it('개요와 모르는 값은 리다이렉트하지 않는다', () => {
    expect(legacyAdminSectionHref('overview')).toBeNull();
    expect(legacyAdminSectionHref('nope')).toBeNull();
    expect(legacyAdminSectionHref(undefined)).toBeNull();
    expect(legacyAdminSectionHref(['orders'])).toBeNull();
  });
});

describe('사이드바 대분류 순서', () => {
  it('팬덤 콘텐츠·이벤트·설정은 맨 아래로 내린다 — 매일 쓰는 그룹이 아니다', () => {
    const ids = ADMIN_NAV_GROUPS.map((group) => group.id);
    const core = ADMIN_NAV_GROUPS.filter((group) => group.tier === 'core').map((group) => group.id);
    const extended = ADMIN_NAV_GROUPS.filter((group) => group.tier === 'extended').map((group) => group.id);

    expect(extended).toEqual(['fandom', 'events', 'settings']);
    /* 확장 그룹은 전부 기본 그룹 뒤에 있어야 한다 — 켜면 아래로 이어 붙는 구조다. */
    expect(ids).toEqual([...core, ...extended]);
    expect(ids.indexOf('fandom')).toBeGreaterThan(ids.indexOf('sales'));
    expect(ids.indexOf('events')).toBeGreaterThan(ids.indexOf('stats'));
  });
});

describe('adminNavGroupsForView', () => {
  it('기본 메뉴는 core 만 보여 준다', () => {
    const ids = adminNavGroupsForView('admin', { showAll: false }).map((group) => group.id);

    expect(ids).not.toContain('fandom');
    expect(ids).not.toContain('events');
    expect(ids).toContain('catalog');
  });

  it('전체 메뉴는 전부 보여 주고 순서는 그대로다', () => {
    expect(adminNavGroupsForView('admin', { showAll: true }).map((group) => group.id))
      .toEqual(ADMIN_NAV_GROUPS.map((group) => group.id));
  });

  it('기본 메뉴여도 지금 보고 있는 그룹은 남긴다 — 왼쪽에서 현재 위치가 사라지면 안 된다', () => {
    const ids = adminNavGroupsForView('admin', { showAll: false, activeGroupId: 'fandom' })
      .map((group) => group.id);

    expect(ids).toContain('fandom');
    expect(ids).not.toContain('events');
  });

  it('감춘 그룹에도 staff 규칙은 그대로 걸린다', () => {
    const staff = adminNavGroupsForView('staff', { showAll: true }).flatMap((group) => group.screens);
    expect(staff.some((screen) => screen.id === 'roles')).toBe(false);
  });
});

describe('저장소 키', () => {
  it('보기 상태는 브라우저에만 남는다 — 운영자 개인 취향이라 계정에 저장하지 않는다', () => {
    expect(ADMIN_NAV_TIER_KEY).toBe('admin:nav:tier');
    expect(ADMIN_NAV_GROUPS_KEY).toBe('admin:nav:groups');
  });

  it('현재 그룹은 기존 경로 헬퍼로 찾는다', () => {
    expect(adminGroupForPath('/admin/catalog/cards')?.id).toBe('fandom');
  });
});

describe('그룹 접기 상태', () => {
  const empty = { expanded: [], collapsed: [] };

  it('깨진 저장값은 기본값으로 떨어뜨린다', () => {
    expect(parseNavGroupState('')).toEqual(empty);
    expect(parseNavGroupState('{')).toEqual(empty);
    expect(parseNavGroupState('["sales"]')).toEqual(empty);
    expect(parseNavGroupState('{"expanded":["catalog","catalog",5,""],"collapsed":"x"}'))
      .toEqual({ expanded: ['catalog'], collapsed: [] });
  });

  /* 처음엔 전부 접혀 있고, 보고 있는 그룹만 펼쳐 준다(PM 2026-09-09). */
  it('저장값이 없으면 보고 있는 그룹만 펼쳐진다', () => {
    expect(isNavGroupCollapsed(empty, 'catalog', 'catalog')).toBe(false);
    expect(isNavGroupCollapsed(empty, 'catalog', 'sales')).toBe(true);
    expect(isNavGroupCollapsed(empty, 'catalog', null)).toBe(true);
  });

  it('운영자가 손댄 그룹은 그 선택이 기본값을 이긴다 — 보고 있는 그룹도 접힌다', () => {
    expect(isNavGroupCollapsed({ expanded: ['catalog'], collapsed: [] }, 'catalog', 'sales')).toBe(false);
    expect(isNavGroupCollapsed({ expanded: [], collapsed: ['sales'] }, 'sales', 'sales')).toBe(true);
  });

  it('토글은 지금 보이는 상태의 반대를 저장한다', () => {
    const opened = toggleNavGroup(empty, 'catalog', 'sales');
    expect(opened).toEqual({ expanded: ['catalog'], collapsed: [] });
    expect(toggleNavGroup(opened, 'catalog', 'sales')).toEqual({ expanded: [], collapsed: ['catalog'] });
    const closedActive = toggleNavGroup(empty, 'sales', 'sales');
    expect(closedActive).toEqual({ expanded: [], collapsed: ['sales'] });
    expect(toggleNavGroup(closedActive, 'sales', 'sales')).toEqual({ expanded: ['sales'], collapsed: [] });
    expect(JSON.parse(serializeNavGroupState({ expanded: ['a', 'a'], collapsed: ['b'] })))
      .toEqual({ expanded: ['a'], collapsed: ['b'] });
  });
});

describe('기본/전체 저장값', () => {
  it('저장값이 없으면 기본 메뉴로 시작한다', () => {
    expect(isAdminNavShowingAll('')).toBe(false);
    expect(isAdminNavShowingAll('core')).toBe(false);
    expect(isAdminNavShowingAll('all')).toBe(true);
    expect(adminNavTierValue(true)).toBe('all');
    expect(adminNavTierValue(false)).toBe('core');
  });
});

describe('visibleAdminNavGroups', () => {
  it('staff에게는 역할 관리를 감춘다', () => {
    const staffScreens = visibleAdminNavGroups('staff').flatMap((group) => group.screens);
    const adminScreens = visibleAdminNavGroups('admin').flatMap((group) => group.screens);

    expect(staffScreens.some((screen) => screen.id === 'roles')).toBe(false);
    expect(adminScreens.some((screen) => screen.id === 'roles')).toBe(true);
  });

  it('대분류 순서를 바꾸지 않는다', () => {
    expect(visibleAdminNavGroups('admin').map((group) => group.id))
      .toEqual(ADMIN_NAV_GROUPS.map((group) => group.id));
  });
});
