import { describe, expect, it } from 'vitest';
import { ADMIN_CAPABILITIES, canAccessAdminScreen, hasAdminCapability, MANAGER_ROLES, NO_OPERATOR_ACCESS, parseOperatorAccess } from './access';
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
    expect(ADMIN_CAPABILITIES).toHaveLength(17);
  });
  it.each(MANAGER_ROLES)('%s sidebar grants exactly the same screens as direct access', managerRole => {
    const operatorAccess = configuredOperatorAccessFixture(managerRole);
    const visible = new Set(visibleAdminNavGroups('staff', operatorAccess).flatMap(group => group.screens.map(screen => screen.id)));
    // 사이드바에서만 숨긴 화면(R21 그룹상품)은 메뉴에 없지만 직접 경로 권한은 그대로다.
    for (const screen of ADMIN_SCREENS) expect(visible.has(screen.id), screen.id).toBe(!screen.navHidden && canAccessAdminScreen(operatorAccess, screen));
  });
  it('사이드바에서 숨긴 그룹상품 화면도 같은 권한으로 직접 열고 쓸 수 있다', () => {
    const owner = configuredOperatorAccessFixture('owner');
    for (const path of ['/admin/catalog/groups', '/admin/catalog/groups/new?mode=assemble']) {
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
  it('logistics is limited to product announcements plus home and guide', () => {
    const screens = visibleAdminNavGroups('staff', configuredOperatorAccessFixture('logistics')).flatMap(group => group.screens.map(screen => screen.id));
    expect(screens).toEqual(['overview', 'announcements', 'guide']);
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
