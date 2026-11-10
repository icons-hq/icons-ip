/** Menu and action authorization share the current database capability snapshot. */
export const ADMIN_CAPABILITIES = [
  'home', 'catalog.read', 'catalog.manage', 'catalog.announcements',
  'sales.read', 'sales.manage', 'sales.restrictions', 'cs.manage', 'store.manage',
  'seller.read', 'seller.manage', 'marketing.manage', 'stats.read', 'promotion.manage',
  'operators.manage', 'operators.transfer', 'platform.manage',
] as const;
export type AdminCapability = typeof ADMIN_CAPABILITIES[number];
export const MANAGER_ROLES = ['owner', 'primary', 'deputy', 'influencer', 'agency', 'logistics'] as const;
export type ManagerRole = typeof MANAGER_ROLES[number];
export const MANAGER_ROLE_LABELS: Record<ManagerRole, string> = {
  owner: '통합 매니저', primary: '계정 주매니저', deputy: '계정 부매니저',
  influencer: '인플루언서', agency: '대행사', logistics: '물류출고관리',
};
export interface OperatorAccess {
  mode: 'legacy' | 'configured' | 'none';
  managerRole: ManagerRole | null;
  capabilities: AdminCapability[];
  revision: number;
  setupRequired: boolean;
}
export const NO_OPERATOR_ACCESS: OperatorAccess = {
  mode: 'none', managerRole: null, capabilities: [], revision: 0, setupRequired: false,
};
export type AdminAccessSource = OperatorAccess | {
  operatorAccess?: OperatorAccess; role?: string | null; isStaff?: boolean;
} | null | undefined;

export function parseOperatorAccess(value: unknown): OperatorAccess | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!['legacy', 'configured', 'none'].includes(String(row.mode))
    || (row.managerRole !== null && !MANAGER_ROLES.includes(row.managerRole as ManagerRole))
    || !Array.isArray(row.capabilities) || row.capabilities.some(cap => !ADMIN_CAPABILITIES.includes(cap))
    || new Set(row.capabilities).size !== row.capabilities.length
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
    || typeof row.setupRequired !== 'boolean'
    || (row.mode === 'configured' && row.managerRole === null)
    || (row.mode !== 'configured' && row.managerRole !== null)
    || (row.mode === 'none' && row.capabilities.length !== 0)) return null;
  return { mode: row.mode as OperatorAccess['mode'], managerRole: row.managerRole as ManagerRole | null,
    capabilities: row.capabilities as AdminCapability[], revision: Number(row.revision), setupRequired: row.setupRequired };
}

export function operatorAccessOf(source: AdminAccessSource): OperatorAccess {
  if (!source || ('isStaff' in source && source.isStaff === false)) return NO_OPERATOR_ACCESS;
  return 'mode' in source ? source : source.operatorAccess ?? NO_OPERATOR_ACCESS;
}

export function hasAdminCapability(source: AdminAccessSource, capability: AdminCapability): boolean {
  const access = operatorAccessOf(source);
  return access.mode !== 'none' && access.capabilities.includes(capability);
}

const SCREEN_CAPABILITIES: Record<string, AdminCapability> = {
  overview: 'home', guide: 'home', goods: 'catalog.read', 'goods-create': 'catalog.manage', 'goods-groups': 'catalog.manage', 'goods-groups-create': 'catalog.manage', 'goods-import': 'catalog.manage',
  'fulfillment-origins': 'catalog.manage', 'shipping-settings-templates': 'catalog.manage',
  'shipping-notice-templates': 'catalog.manage', 'notice-presets': 'catalog.manage', categories: 'catalog.manage',
  'erp-items': 'platform.manage', announcements: 'catalog.announcements', 'goods-photos': 'catalog.manage', 'goods-event-templates': 'catalog.manage', 'category-templates': 'catalog.manage', 'goods-after-sales-templates': 'catalog.manage', 'size-templates': 'catalog.manage',
  'related-goods': 'catalog.manage', 'goods-attributes': 'platform.manage', 'shipping-regions': 'catalog.manage',
  'shipping-carriers': 'catalog.manage', orders: 'sales.read', gifts: 'sales.read', subscriptions: 'sales.read', unpaid: 'sales.manage', dispatch: 'sales.manage',
  shipping: 'sales.manage', 'purchase-restrictions': 'sales.restrictions', settled: 'sales.manage',
  'claims-cancels': 'sales.manage', 'claims-returns': 'sales.manage', 'claims-exchanges': 'sales.manage', 'pg-settlements': 'sales.manage',
  'refund-transfers': 'sales.manage',
  qna: 'cs.manage', inquiries: 'cs.manage', 'inquiry-chat': 'cs.manage', reviews: 'cs.manage', 'review-insights': 'cs.manage', 'review-events': 'cs.manage', faq: 'cs.manage',
  members: 'platform.manage', curations: 'store.manage', 'coupon-register': 'marketing.manage', coupons: 'marketing.manage',
  'shopping-stories': 'store.manage',
  'store-presentation': 'store.manage',
  'category-display': 'store.manage',
  'product-detail-presentation': 'store.manage',
  'marketing-messages': 'marketing.manage',
  'marketing-links': 'marketing.manage',
  'customer-segments': 'marketing.manage',
  'benefit-report': 'marketing.manage', 'customer-grades': 'marketing.manage', campaigns: 'promotion.manage',
  'store-credit-console': 'marketing.manage', 'store-credits': 'marketing.manage', notifications: 'marketing.manage',
  emails: 'marketing.manage', 'stats-traffic': 'stats.read', 'stats-marketing': 'stats.read', 'stats-sales': 'stats.read', 'stats-claims': 'stats.read', 'stats-customers': 'stats.read',
  'store-settings': 'seller.read', roles: 'operators.manage', 'operations-settings': 'platform.manage',
  ips: 'platform.manage', cards: 'platform.manage', pools: 'platform.manage', policies: 'platform.manage',
  grants: 'platform.manage', games: 'platform.manage', events: 'platform.manage', 'ticket-types': 'platform.manage',
  moderation: 'platform.manage', 'check-in': 'platform.manage',
};

/** Unknown screens never inherit the home grant. */
export function adminScreenCapability(screenId: string, intent: 'read' | 'write' = 'read'): AdminCapability | null {
  const capability = SCREEN_CAPABILITIES[screenId];
  if (!capability) return null;
  if (intent === 'write') {
    if (capability === 'catalog.read') return 'catalog.manage';
    if (capability === 'sales.read') return 'sales.manage';
    if (capability === 'seller.read') return 'seller.manage';
    // Generic legacy actions must explicitly choose their business capability.
    if (screenId === 'overview') return 'platform.manage';
  }
  return capability;
}

export function canAccessAdminScreen(
  source: AdminAccessSource, screen: { id: string; adminOnly?: boolean } | null,
  options: { adminOnly?: boolean; capability?: AdminCapability; intent?: 'read' | 'write' } = {},
): boolean {
  const access = operatorAccessOf(source);
  const capability = options.capability ?? (screen ? adminScreenCapability(screen.id, options.intent) : null);
  if (!capability || !hasAdminCapability(source, capability)) return false;
  if (access.mode === 'legacy' && (options.adminOnly || screen?.adminOnly)) {
    return Boolean(source && 'role' in source && source.role === 'admin');
  }
  return true;
}
