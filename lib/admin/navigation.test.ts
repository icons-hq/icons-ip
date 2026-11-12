import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUPS,
  ADMIN_SCREENS,
  adminGroupForPath,
  adminDetailTitleForPath,
  adminScreenForPath,
  adminConsoleForPath,
  adminConsoleHomeHref,
  legacyAdminSectionHref,
  visibleAdminNavGroups,
} from './navigation';
import { ERP_ITEMS_PATH } from './erp-items';

describe('어드민 IA 정의', () => {
  it('IP·콘텐츠 운영과 현장 운영은 별도 콘솔이고 도움말은 두 콘솔이 공유한다 (D9)', () => {
    expect(adminConsoleForPath('/admin/catalog/cards')).toBe('content');
    expect(adminConsoleForPath('/admin/catalog/ips/maple')).toBe('content');
    expect(adminConsoleForPath('/admin/community/moderation')).toBe('content');
    expect(adminConsoleForPath('/admin/catalog/goods?create=1')).toBe('commerce');
    expect(adminConsoleForPath('/admin/guide/getting-started')).toBe('commerce');
    expect(visibleAdminNavGroups('admin', undefined, 'content').map(group => group.id)).toEqual(['content', 'field', 'help']);
    expect(visibleAdminNavGroups('admin', undefined, 'commerce').map(group => group.id)).not.toContain('content');
    expect(adminConsoleHomeHref('commerce', 'staff')).toBe('/admin');
    expect(adminConsoleHomeHref('content', 'staff')).toBe('/admin/catalog/ips');
    expect(adminConsoleHomeHref('content', 'staff', { mode: 'configured', managerRole: 'deputy', capabilities: ['home', 'cs.manage'], revision: 1, setupRequired: false })).toBeNull();
  });

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

  it('상품 등록 쿼리는 별도 메뉴로 연결하고 목록 필터와 수정은 목록 메뉴를 유지한다', () => {
    expect(adminScreenForPath('/admin/catalog/goods?status=draft&create=1')?.id).toBe('goods-create');
    expect(adminGroupForPath('/admin/catalog/goods?create=1')?.id).toBe('catalog');
    expect(adminScreenForPath('/admin/catalog/goods?create=0')?.id).toBe('goods');
    expect(adminScreenForPath('/admin/catalog/goods?goodId=good-a')?.id).toBe('goods');
    expect(adminScreenForPath('/admin/catalog/goods/import?create=1')?.id).toBe('goods-import');
  });

  it('그룹상품 목록과 전환 화면은 상품관리 메뉴에 연결된다', () => {
    expect(adminScreenForPath('/admin/catalog/groups?id=group-id')).toMatchObject({ id: 'goods-groups', label: '그룹상품 조회/수정', status: 'ready' });
    expect(adminScreenForPath('/admin/catalog/groups/new?mode=assemble')).toMatchObject({ id: 'goods-groups-create', label: '그룹상품 등록', status: 'ready' });
    expect(adminScreenForPath('/admin/catalog/groups/new')?.id).toBe('goods-groups-create');
    expect(adminGroupForPath('/admin/catalog/groups/new')?.id).toBe('catalog');
  });

  /*
   * 2026-11-05 IA 재정의(10/27 R21·D9①·MD-0007 확장): 화면 라벨·id·경로는 그대로 두고 묶음과 순서만 운영 업무 기준으로 바꾼다.
   * 매일 쓰는 업무 그룹이 위, 설정 구역(배송관리·템플릿 관리·판매자 정보)이 아래다.
   */
  it('커머스 대분류를 업무 순서로 세우고 설정 구역을 맨 아래에 둔다', () => {
    const commerce = ADMIN_NAV_GROUPS.filter((group) => !group.consoles || group.consoles.includes('commerce'));
    expect(commerce.map((group) => [group.id, group.label])).toEqual([
      ['home', '홈'], ['sales', '주문관리'], ['claims', '취소·반품·교환'], ['catalog', '상품관리'], ['cs', '문의/리뷰관리'],
      ['customers', '고객관리'], ['store', '스토어 전시관리'], ['display', '혜택/마케팅'], ['stats', '데이터분석'],
      ['settlements', '정산관리'], ['shipping', '배송관리'], ['templates', '템플릿 관리'], ['seller', '판매자 정보'], ['help', '도움말'],
    ]);
    const ids = (groupId: string) => ADMIN_NAV_GROUPS.find((group) => group.id === groupId)?.screens.map((screen) => screen.id);
    expect(ids('sales')).toEqual(['orders', 'unpaid', 'dispatch', 'shipping', 'settled', 'gifts', 'subscriptions']);
    expect(ids('claims')).toEqual(['claims-cancels', 'claims-returns', 'claims-exchanges', 'refund-transfers']);
    expect(ids('catalog')).toEqual(['goods', 'goods-create', 'goods-groups-create', 'goods-groups', 'goods-import', 'goods-photos', 'categories',
      'erp-items', 'related-goods', 'announcements']);
    expect(ids('cs')).toEqual(['inquiries', 'inquiry-chat', 'qna', 'reviews', 'review-events', 'review-insights', 'faq', 'inquiry-operator-history']);
    expect(ids('customers')).toEqual(['members', 'customer-grades', 'customer-segments', 'purchase-restrictions']);
    expect(ids('store')).toEqual(['curations', 'category-display', 'campaigns', 'shopping-stories', 'product-detail-presentation', 'store-presentation']);
    expect(ids('display')).toEqual(['coupon-register', 'coupons', 'discount-promotions', 'store-credit-console', 'marketing-messages', 'notifications', 'emails', 'marketing-links']);
    expect(ids('stats')).toEqual(['stats-sales', 'stats-claims', 'stats-customers', 'stats-traffic', 'stats-marketing', 'benefit-report']);
    expect(ids('shipping')).toEqual(['fulfillment-origins', 'return-addresses', 'stock-reconcile', 'defective-stock', 'shipping-regions', 'shipping-carriers', 'shipping-settings-templates', 'shipping-notice-templates']);
    expect(ids('templates')).toEqual(['notice-presets', 'goods-event-templates', 'category-templates', 'goods-after-sales-templates', 'size-templates',
      'goods-attributes']);
    expect(ids('seller')).toEqual(['operations-settings', 'store-settings', 'roles', 'store-credits']);
    expect(ADMIN_NAV_GROUPS.some((group) => group.id === 'promotion')).toBe(false);
    for (const group of commerce.filter((item) => item.id !== 'help')) expect(group.consoles).toBeUndefined();
    /* 한 그룹은 한 업무 — 사이드바에 보이는 화면은 그룹당 8개 이하다. */
    for (const group of visibleAdminNavGroups('admin', undefined, 'commerce')) expect(group.screens.length).toBeLessThanOrEqual(8);
    expect(adminGroupForPath('/admin/settings/origins')?.id).toBe('shipping');
    expect(adminGroupForPath('/admin/settings/shipping-notices')?.id).toBe('shipping');
    expect(adminGroupForPath('/admin/sales/claims/returns')?.id).toBe('claims');
    expect(adminGroupForPath('/admin/sales/purchase-restrictions')?.id).toBe('customers');
    expect(adminGroupForPath('/admin/settings/store-credits')?.id).toBe('seller');
    expect(adminGroupForPath('/admin/sales/benefit-report')?.id).toBe('stats');
    expect(adminConsoleForPath('/admin/settings/shipping-templates')).toBe('commerce');
  });

  it('IA 재정의는 화면 id·라벨·경로를 바꾸지 않는다', () => {
    const before = [
      ['overview', '/admin'], ['goods', '/admin/catalog/goods'], ['goods-create', '/admin/catalog/goods?create=1'],
      ['claims-cancels', '/admin/sales/claims/cancels'], ['refund-transfers', '/admin/sales/claims/refund-transfers'],
      ['members', '/admin/community/members'], ['customer-grades', '/admin/marketing/customer-grades'], ['campaigns', '/admin/display/campaigns'],
      ['benefit-report', '/admin/sales/benefit-report'], ['shipping-notice-templates', '/admin/settings/shipping-notices'],
      ['goods-attributes', '/admin/catalog/attributes'], ['store-credits', '/admin/settings/store-credits'],
    ];
    for (const [id, href] of before) expect(ADMIN_SCREENS.find((screen) => screen.id === id)?.href).toBe(href);
    expect(ADMIN_SCREENS.find((screen) => screen.id === 'purchase-restrictions')?.label).toBe('판매방해 고객관리');
    expect(ADMIN_SCREENS.filter((screen) => screen.adminOnly).map((screen) => screen.id).sort()).toEqual([
      'customer-grades', 'goods-attributes', 'pg-settlements', 'refund-transfers', 'roles', 'store-credit-console', 'store-credits',
    ]);
  });

  it('그룹상품 등록·조회는 사이드바에서만 숨기고 라우트·화면 판정은 그대로 둔다', () => {
    const hidden = ADMIN_SCREENS.filter((screen) => screen.navHidden).map((screen) => screen.id);
    expect(hidden).toEqual(['gifts', 'subscriptions', 'goods-groups-create', 'goods-groups']);
    const visible = visibleAdminNavGroups('admin').flatMap((group) => group.screens.map((screen) => screen.id));
    for (const id of hidden) expect(visible).not.toContain(id);
    expect(adminScreenForPath('/admin/catalog/groups')?.id).toBe('goods-groups');
    expect(adminScreenForPath('/admin/catalog/groups/new')?.id).toBe('goods-groups-create');
  });

  it('운영에서 꺼진 선물 수락 대기·정기구매 관리는 사이드바에서만 숨기고 주문관리 화면 판정은 그대로 둔다', () => {
    const sales = ADMIN_NAV_GROUPS.find((group) => group.id === 'sales');
    expect(sales?.screens.filter((screen) => screen.navHidden).map((screen) => screen.label)).toEqual(['선물 수락 대기', '정기구매 관리']);
    const visibleSales = visibleAdminNavGroups('admin').find((group) => group.id === 'sales')?.screens.map((screen) => screen.id) ?? [];
    expect(visibleSales).not.toContain('gifts');
    expect(visibleSales).not.toContain('subscriptions');
    expect(visibleSales).toContain('orders');
    expect(adminScreenForPath('/admin/sales/gifts?status=pending')).toMatchObject({ id: 'gifts', status: 'ready' });
    expect(adminScreenForPath('/admin/sales/subscriptions/plan-id')).toMatchObject({ id: 'subscriptions', status: 'ready' });
    expect(adminGroupForPath('/admin/sales/gifts')?.id).toBe('sales');
    expect(adminGroupForPath('/admin/sales/subscriptions')?.id).toBe('sales');
  });

  it('상담하기는 문의 관리와 구분되는 실시간 상담 화면으로 연결된다', () => {
    expect(adminScreenForPath('/admin/cs/chat?inquiry=case-a')).toMatchObject({ id: 'inquiry-chat', label: '상담하기', status: 'ready' });
    expect(adminGroupForPath('/admin/cs/chat')?.id).toBe('cs');
    expect(adminScreenForPath('/admin/cs/inquiries/case-a')?.id).toBe('inquiries');
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

  /* MD 회의(2026-10-07) ⑦ — ERP 품목 반입은 고객 카테고리 바로 뒤, 상품 관리 대분류에 둔다. */
  it('ERP 품목 화면이 상품 관리 대분류의 고객 카테고리 뒤에 붙어 있다', () => {
    const catalog = ADMIN_NAV_GROUPS.find((group) => group.id === 'catalog');
    const ids = catalog?.screens.map((screen) => screen.id) ?? [];

    expect(catalog?.screens.find((screen) => screen.id === 'erp-items')).toMatchObject({
      label: 'ERP 품목', href: ERP_ITEMS_PATH, status: 'ready',
    });
    expect(ids.indexOf('erp-items')).toBe(ids.indexOf('categories') + 1);
    expect(adminScreenForPath('/admin/catalog/erp-items')?.id).toBe('erp-items');
    expect(adminGroupForPath('/admin/catalog/erp-items')?.id).toBe('catalog');
    expect(visibleAdminNavGroups('staff').flatMap((group) => group.screens).some((screen) => screen.id === 'erp-items')).toBe(true);
  });

  /* S8 화면 두 개(#330). 메뉴에 자리가 없으면 라우트만 있고 아무도 못 찾는다. */
  it('캠페인과 상품 Q&A가 각자의 대분류에 붙어 있다', () => {
    const campaigns = ADMIN_SCREENS.find((screen) => screen.id === 'campaigns');
    const qna = ADMIN_SCREENS.find((screen) => screen.id === 'qna');

    expect(campaigns).toMatchObject({ href: '/admin/display/campaigns', status: 'ready' });
    expect(qna).toMatchObject({ href: '/admin/cs/qna', status: 'ready' });
    expect(adminGroupForPath('/admin/display/campaigns')?.id).toBe('store');
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
    expect(adminScreenForPath('/admin/customers/customer-id')?.id).toBe('members');
    expect(adminGroupForPath('/admin/customers/customer-id')?.id).toBe('customers');
  });

  it('끝 슬래시를 붙여도 같은 화면을 고른다', () => {
    expect(adminScreenForPath('/admin/catalog/cards/')?.id).toBe('cards');
  });

  it('어드민 밖 경로는 화면이 없다', () => {
    expect(adminScreenForPath('/shop')).toBeNull();
  });

  it('화면이 속한 대분류를 찾는다', () => {
    expect(adminGroupForPath('/admin/catalog/pools')?.label).toBe('IP·콘텐츠 운영');
    expect(adminGroupForPath('/admin/community/roles')?.label).toBe('판매자 정보');
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

describe('상세 화면 셸 제목(ADR-0029)', () => {
  it('레코드 상세는 상세 이름을, 목록·등록은 목록 이름을 쓴다', () => {
    expect(adminDetailTitleForPath('/admin/sales/orders/abc')).toBe('주문 상세');
    expect(adminDetailTitleForPath('/admin/sales/claims/returns/abc')).toBe('반품 상세');
    expect(adminDetailTitleForPath('/admin/cs/inquiries/abc')).toBe('고객문의 상세');
    expect(adminDetailTitleForPath('/admin/customers/abc')).toBe('고객 상세');
    expect(adminDetailTitleForPath('/admin/sales/claims/returns/fees')).toBeNull();
    expect(adminDetailTitleForPath('/admin/sales/claims/returns/fee-policy')).toBeNull();
    expect(adminDetailTitleForPath('/admin/sales/orders')).toBeNull();
    expect(adminDetailTitleForPath('/admin/sales/claims/cancels')).toBeNull();
  });
});
