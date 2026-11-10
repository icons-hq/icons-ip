import { ADMIN_CAPABILITIES, type ManagerRole, type OperatorAccess } from './access';

/** Explicit authorization fixtures; production never infers access from a raw role. */
export function legacyOperatorAccessFixture(role: 'staff' | 'admin' = 'admin'): OperatorAccess {
  return { mode: 'legacy', managerRole: null, capabilities: ADMIN_CAPABILITIES.filter(cap => cap !== 'operators.transfer' && (role === 'admin' || cap !== 'operators.manage')),
    revision: 0, setupRequired: true };
}

export function configuredOperatorAccessFixture(managerRole: ManagerRole): OperatorAccess {
  const regular: OperatorAccess['capabilities'] = ['home', 'catalog.read', 'catalog.manage', 'catalog.announcements', 'cs.manage', 'store.manage', 'seller.read', 'promotion.manage'];
  const capabilities = managerRole === 'owner' ? [...ADMIN_CAPABILITIES]
    : managerRole === 'primary' ? ADMIN_CAPABILITIES.filter(cap => cap !== 'operators.transfer')
      : managerRole === 'logistics' ? ['home', 'catalog.announcements'] as OperatorAccess['capabilities']
        : managerRole === 'influencer' ? [...regular, 'sales.read', 'sales.restrictions', 'stats.read'] as OperatorAccess['capabilities']
          : managerRole === 'agency' ? [...regular, 'stats.read'] as OperatorAccess['capabilities'] : regular;
  return { mode: 'configured', managerRole, capabilities, revision: 1, setupRequired: false };
}
