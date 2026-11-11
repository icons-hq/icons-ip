import { describe, expect, it } from 'vitest';
import { ADMIN_CAPABILITIES, adminScreenCapability, canAccessAdminScreen, hasAdminCapability, IMPLIED_ADMIN_CAPABILITIES, MANAGER_ROLES, NO_OPERATOR_ACCESS, parseOperatorAccess, type AdminCapability } from './access';
import { adminScreenForPath, ADMIN_SCREENS, visibleAdminNavGroups } from './navigation';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from './access.test-fixtures';
import { allowedAdminAlertCategories } from './operations-dock';

describe('manager authorization contract', () => {
  it('missing, malformed and suspended snapshots fail closed', () => {
    expect(hasAdminCapability({ role: 'admin', isStaff: true }, 'sales.manage')).toBe(false);
    expect(hasAdminCapability({ isStaff: false, operatorAccess: configuredOperatorAccessFixture('owner') }, 'home')).toBe(false);
    expect(parseOperatorAccess({ ...NO_OPERATOR_ACCESS, capabilities: ['home'] })).toBeNull();
    expect(parseOperatorAccess({ ...configuredOperatorAccessFixture('primary'), capabilities: ['unknown'] })).toBeNull();
    expect(parseOperatorAccess({ ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'home'] })).toBeNull();
    expect(parseOperatorAccess({ ...NO_OPERATOR_ACCESS, mode: 'configured' })).toBeNull();
    expect(parseOperatorAccess({ ...NO_OPERATOR_ACCESS, revision: -1 })).toBeNull();
  });
  it('all ready screens have an explicit capability and unknown URLs are denied', () => {
    const owner = configuredOperatorAccessFixture('owner');
    for (const screen of ADMIN_SCREENS) expect(canAccessAdminScreen(owner, screen), screen.id).toBe(true);
    expect(canAccessAdminScreen(owner, adminScreenForPath('/admin/unknown'))).toBe(false);
    expect(adminScreenForPath('/admin/sales/orders?status=paid')?.id).toBe('orders');
    expect(ADMIN_CAPABILITIES).toHaveLength(18);
  });
  it.each(MANAGER_ROLES)('%s sidebar grants exactly the same screens as direct access', managerRole => {
    const operatorAccess = configuredOperatorAccessFixture(managerRole);
    const visible = new Set(visibleAdminNavGroups('staff', operatorAccess).flatMap(group => group.screens.map(screen => screen.id)));
    // 사이드바에서만 숨긴 화면(R21 그룹상품, 운영에서 꺼진 선물·정기구매)은 메뉴에 없지만 직접 경로 권한은 그대로다.
    for (const screen of ADMIN_SCREENS) expect(visible.has(screen.id), screen.id).toBe(!screen.navHidden && canAccessAdminScreen(operatorAccess, screen));
  });
  it('사이드바에서 숨긴 그룹상품·선물·정기구매 화면도 같은 권한으로 직접 열고 쓸 수 있다', () => {
    const owner = configuredOperatorAccessFixture('owner');
    for (const path of ['/admin/catalog/groups', '/admin/catalog/groups/new?mode=assemble', '/admin/sales/gifts', '/admin/sales/subscriptions', '/admin/sales/subscriptions/plan-id']) {
      const screen = adminScreenForPath(path);
      expect(screen?.navHidden, path).toBe(true);
      expect(canAccessAdminScreen(owner, screen), path).toBe(true);
      expect(canAccessAdminScreen(owner, screen, { intent: 'write' }), path).toBe(true);
    }
  });
  it('influencer can search orders and manage restrictions without fulfilling or refunding', () => {
    const auth = configuredOperatorAccessFixture('influencer');
    expect(canAccessAdminScreen(auth, adminScreenForPath('/admin/sales/orders/uuid'))).toBe(true);
    expect(canAccessAdminScreen(auth, adminScreenForPath('/admin/sales/orders'), { intent: 'write' })).toBe(false);
    expect(canAccessAdminScreen(auth, adminScreenForPath('/admin/sales/purchase-restrictions'), { intent: 'write' })).toBe(true);
    for (const path of ['/admin/sales/settled', '/admin/sales/dispatch', '/admin/sales/claims/returns']) expect(canAccessAdminScreen(auth, adminScreenForPath(path))).toBe(false);
  });
  it('상품 조회만 가능한 매니저는 그룹 전환 메뉴와 직접 경로에 접근하지 못한다', () => {
    const screen = adminScreenForPath('/admin/catalog/groups/new');
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('owner'), screen)).toBe(true);
    expect(canAccessAdminScreen({ ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'catalog.read'] }, screen)).toBe(false);
  });
  it('상품 등록 메뉴는 상품 관리 권한이 있는 계정에만 보인다', () => {
    const readOnly = { ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'catalog.read'] as const };
    const source = { ...readOnly, capabilities: [...readOnly.capabilities] };
    const createScreen = adminScreenForPath('/admin/catalog/goods?create=1');
    expect(canAccessAdminScreen(source, createScreen)).toBe(false);
    expect(visibleAdminNavGroups('staff', source).flatMap(group => group.screens).map(screen => screen.id)).not.toContain('goods-create');
    expect(canAccessAdminScreen(configuredOperatorAccessFixture('primary'), createScreen)).toBe(true);
  });

  it('상담 콘솔은 문의 응대 권한으로만 접근한다', () => {
    const screen = adminScreenForPath('/admin/cs/chat');
    expect(canAccessAdminScreen({ ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'cs.manage'] }, screen)).toBe(true);
    expect(canAccessAdminScreen({ ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'sales.read'] }, screen)).toBe(false);
    expect(canAccessAdminScreen(NO_OPERATOR_ACCESS, screen)).toBe(false);
  });
  it('logistics adds only the dispatch and shipping consoles to product announcements, home and guide (1014-084)', () => {
    const logistics = configuredOperatorAccessFixture('logistics');
    const screens = visibleAdminNavGroups('staff', logistics).flatMap(group => group.screens.map(screen => screen.id));
    expect(screens).toEqual(['overview', 'dispatch', 'shipping', 'announcements', 'guide']);
    for (const path of ['/admin/sales/dispatch', '/admin/sales/shipping']) {
      expect(canAccessAdminScreen(logistics, adminScreenForPath(path)), path).toBe(true);
      expect(canAccessAdminScreen(logistics, adminScreenForPath(path), { intent: 'write' }), path).toBe(true);
    }
    // 발주확인·취소·환불·클레임·고객·상품 관리와 주문 조회·상세, 정산은 열지 않는다. 화면 안의 발주확인·합포장·지연 안내·목록 엑셀 동작은 sales.manage다.
    for (const path of ['/admin/sales/orders', '/admin/sales/orders/order-id', '/admin/sales/unpaid', '/admin/sales/settled', '/admin/sales/claims/cancels',
      '/admin/sales/claims/returns', '/admin/sales/claims/exchanges', '/admin/sales/claims/refund-transfers', '/admin/sales/purchase-restrictions',
      '/admin/community/members', '/admin/catalog/goods', '/admin/settings/origins', '/admin/cs/inquiries']) {
      expect(adminScreenForPath(path), path).not.toBeNull();
      expect(canAccessAdminScreen(logistics, adminScreenForPath(path)), path).toBe(false);
    }
    expect(canAccessAdminScreen(logistics, adminScreenForPath('/admin/sales/dispatch'), { capability: 'sales.manage' })).toBe(false);
    expect(hasAdminCapability(logistics, 'sales.manage')).toBe(false);
    expect(hasAdminCapability(logistics, 'sales.read')).toBe(false);
    expect(allowedAdminAlertCategories(configuredOperatorAccessFixture('logistics')).map(([key]) => key)).toEqual(['all']);
    expect(allowedAdminAlertCategories(configuredOperatorAccessFixture('agency')).map(([key]) => key)).toEqual(['all', 'inquiries', 'questions', 'reviews']);
    expect(allowedAdminAlertCategories(configuredOperatorAccessFixture('influencer')).map(([key]) => key)).toEqual(['all', 'orders', 'inquiries', 'questions', 'reviews']);
  });
  it('legacy admin-only restrictions survive while primary configured authority is capability-based', () => {
    const screen = adminScreenForPath('/admin/marketing/customer-grades');
    expect(canAccessAdminScreen({ role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') }, screen)).toBe(false);
    expect(canAccessAdminScreen({ role: 'admin', operatorAccess: legacyOperatorAccessFixture() }, screen)).toBe(true);
    expect(canAccessAdminScreen({ role: 'staff', operatorAccess: configuredOperatorAccessFixture('primary') }, screen)).toBe(true);
  });
});

describe('logistics dispatch capability keeps every other role unchanged (1014-084)', () => {
  /* 변경 전 화면 능력: 발주확인·발송관리와 배송현황은 sales.manage였다. 나머지 화면의 능력은 바뀌지 않았다. */
  const previousCapability = (screenId: string, intent: 'read' | 'write') =>
    screenId === 'dispatch' || screenId === 'shipping' ? 'sales.manage' as const : adminScreenCapability(screenId, intent);
  const existing = [
    ...(['owner', 'primary', 'deputy', 'influencer', 'agency'] as const).map(role => [role, { role: 'staff', operatorAccess: configuredOperatorAccessFixture(role) }] as const),
    ['legacy admin', { role: 'admin', operatorAccess: legacyOperatorAccessFixture('admin') }] as const,
    ['legacy staff', { role: 'staff', operatorAccess: legacyOperatorAccessFixture('staff') }] as const,
  ];

  it.each(existing)('%s opens exactly the same screens for reading and writing as before', (_label, source) => {
    for (const screen of ADMIN_SCREENS) {
      for (const intent of ['read', 'write'] as const) {
        const before = previousCapability(screen.id, intent);
        expect(canAccessAdminScreen(source, screen, { intent }), `${screen.id}:${intent}`)
          .toBe(before !== null && canAccessAdminScreen(source, screen, { intent, capability: before }));
      }
    }
  });

  it.each(existing)('%s keeps the same capability judgements; dispatch follows sales.manage', (_label, source) => {
    const listed = source.operatorAccess.capabilities;
    expect(listed).not.toContain('sales.dispatch');
    for (const capability of ADMIN_CAPABILITIES) {
      expect(hasAdminCapability(source, capability), capability)
        .toBe(capability === 'sales.dispatch' ? listed.includes('sales.manage') : listed.includes(capability));
    }
  });

  it('only sales.manage implies another capability, and only sales.dispatch', () => {
    expect(IMPLIED_ADMIN_CAPABILITIES).toEqual({ 'sales.manage': ['sales.dispatch'] });
    const dispatchOnly = { ...configuredOperatorAccessFixture('primary'), capabilities: ['home', 'sales.dispatch'] as AdminCapability[] };
    for (const capability of ADMIN_CAPABILITIES) {
      expect(hasAdminCapability(dispatchOnly, capability), capability).toBe(capability === 'home' || capability === 'sales.dispatch');
    }
    expect(hasAdminCapability(NO_OPERATOR_ACCESS, 'sales.dispatch')).toBe(false);
    expect(hasAdminCapability({ ...configuredOperatorAccessFixture('owner'), mode: 'none', managerRole: null, capabilities: [] }, 'sales.dispatch')).toBe(false);
  });

  it('parses the logistics snapshot that includes the dispatch capability', () => {
    const snapshot = { mode: 'configured', managerRole: 'logistics', capabilities: ['home', 'catalog.announcements', 'sales.dispatch'], revision: 3, setupRequired: false };
    expect(parseOperatorAccess(snapshot)).toEqual(snapshot);
    expect(parseOperatorAccess({ ...snapshot, capabilities: ['home', 'sales.dispatch', 'sales.dispatch'] })).toBeNull();
  });
});
