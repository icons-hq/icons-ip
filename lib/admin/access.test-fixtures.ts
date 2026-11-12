import { ADMIN_CAPABILITIES, type ManagerRole, type OperatorAccess } from './access';

/**
 * DB `private.operator_role_capabilities`가 통합 매니저에게 주는 목록. 출고 전용 `sales.dispatch`는
 * 물류출고관리만 목록으로 받고 `sales.manage`가 판정에서 포함하므로 여기에는 없다(1014-084).
 */
const OWNER_CAPABILITIES = ADMIN_CAPABILITIES.filter(cap => cap !== 'sales.dispatch');

/** Explicit authorization fixtures; production never infers access from a raw role. */
export function legacyOperatorAccessFixture(role: 'staff' | 'admin' = 'admin'): OperatorAccess {
  return { mode: 'legacy', managerRole: null, capabilities: OWNER_CAPABILITIES.filter(cap => cap !== 'operators.transfer' && (role === 'admin' || cap !== 'operators.manage')),
    revision: 0, setupRequired: true };
}

export function configuredOperatorAccessFixture(managerRole: ManagerRole): OperatorAccess {
  const regular: OperatorAccess['capabilities'] = ['home', 'catalog.read', 'catalog.manage', 'catalog.announcements', 'cs.manage', 'store.manage', 'seller.read', 'promotion.manage'];
  const capabilities = managerRole === 'owner' ? [...OWNER_CAPABILITIES]
    : managerRole === 'primary' ? OWNER_CAPABILITIES.filter(cap => cap !== 'operators.transfer')
      : managerRole === 'logistics' ? ['home', 'catalog.announcements', 'sales.dispatch'] as OperatorAccess['capabilities']
        : managerRole === 'influencer' ? [...regular, 'sales.read', 'sales.restrictions', 'stats.read'] as OperatorAccess['capabilities']
          : managerRole === 'agency' ? [...regular, 'stats.read'] as OperatorAccess['capabilities'] : regular;
  return { mode: 'configured', managerRole, capabilities, revision: 1, setupRequired: false };
}
