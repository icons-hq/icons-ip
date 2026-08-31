import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUPS,
  ADMIN_SCREENS,
  adminGroupForPath,
  adminScreenForPath,
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
    expect(adminGroupForPath('/admin/catalog/pools')?.label).toBe('카탈로그 관리');
    expect(adminGroupForPath('/admin/community/roles')?.label).toBe('커뮤니티·회원');
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
