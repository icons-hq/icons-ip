import { COMMUNITY_ENABLED } from './community-visibility';
import { MENU_SHEET_GROUPS, STOREFRONT_MENU_ITEMS, type NavGroup, type NavItem } from './routes';

export const STORE_MENU_LABEL_LIMIT = 20;
export type StoreMenuId = typeof STOREFRONT_MENU_ITEMS[number]['id'];
export type StoreNavigationEntry = { id: StoreMenuId; label: string; visible: boolean };
export type StoreNavigation = StoreNavigationEntry[];
export type StorefrontNavigation = Array<Pick<StoreNavigationEntry, 'id' | 'label'>>;
export const DEFAULT_STORE_NAVIGATION: StoreNavigation = STOREFRONT_MENU_ITEMS.map(item => ({ ...item, visible: true }));
export const DEFAULT_STOREFRONT_NAVIGATION: StorefrontNavigation = STOREFRONT_MENU_ITEMS.map(item => ({ ...item }));
const menuIds = new Set<string>(STOREFRONT_MENU_ITEMS.map(item => item.id));

function validEntry(value: unknown, privateSettings: boolean): value is StoreNavigationEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = privateSettings ? ['id', 'label', 'visible'] : ['id', 'label'];
  return Object.keys(entry).length === keys.length && keys.every(key => Object.hasOwn(entry, key))
    && typeof entry.id === 'string' && menuIds.has(entry.id)
    && typeof entry.label === 'string' && entry.label === entry.label.trim()
    && [...entry.label].length >= 1 && [...entry.label].length <= STORE_MENU_LABEL_LIMIT
    && !/[\u0000-\u001f\u007f]/.test(entry.label)
    && (!privateSettings || typeof entry.visible === 'boolean');
}

/** Every stable id is stored once. A label never supplies a URL or a capability. */
export function parseStoreNavigation(value: unknown): StoreNavigation | null {
  if (!Array.isArray(value) || value.length !== menuIds.size || !value.every(entry => validEntry(entry, true))) return null;
  if (new Set(value.map(entry => entry.id)).size !== menuIds.size || !value.some(entry => entry.id === 'shop' && entry.visible)) return null;
  return value.map(entry => ({ id: entry.id, label: entry.label, visible: entry.visible }));
}

export function storefrontNavigation(settings: StoreNavigation): StorefrontNavigation {
  return settings.filter(entry => entry.visible).map(({ id, label }) => ({ id, label }));
}

export function parseStorefrontNavigation(value: unknown): StorefrontNavigation | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > menuIds.size || !value.every(entry => validEntry(entry, false))) return null;
  if (new Set(value.map(entry => entry.id)).size !== value.length || !value.some(entry => entry.id === 'shop')) return null;
  return value.map(({ id, label }) => ({ id, label }));
}

/** Deployment/domain gates always take precedence over an operator's visibility choice. */
export function resolveStorefrontNavigation(navigation: StorefrontNavigation, cardRewardsEnabled: boolean, communityEnabled = COMMUNITY_ENABLED): NavItem[] {
  return navigation.filter(item => (cardRewardsEnabled || item.id !== 'packs') && (communityEnabled || item.id !== 'community'));
}

/** Related catalog links use the same labels and hide choices, preserving their own groups. */
export function configuredNavigationGroups(groups: NavGroup[], navigation: NavItem[]): NavGroup[] {
  const visible = new Map(navigation.map((item, index) => [item.id, { ...item, index }]));
  return groups.map(group => ({ ...group, items: group.items
    .filter(item => !menuIds.has(item.id) || visible.has(item.id))
    .map(item => visible.has(item.id) ? { id: item.id, label: visible.get(item.id)!.label } : item)
    .sort((a, b) => (visible.get(a.id)?.index ?? navigation.length) - (visible.get(b.id)?.index ?? navigation.length)),
  })).filter(group => group.items.length > 0);
}

/** A single store group keeps cross-category ordering identical to desktop/mobile GNB. */
export function storeMenuSheetGroups(navigation: NavItem[]): NavGroup[] {
  return [{ heading: '스토어', items: navigation }, ...MENU_SHEET_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => !menuIds.has(item.id)) }))
    .filter(group => group.items.length > 0)];
}
