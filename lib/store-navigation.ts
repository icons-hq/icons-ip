import { COMMUNITY_ENABLED } from './community-visibility';
import { MENU_SHEET_GROUPS, RETIRED_STORE_MENU_IDS, STOREFRONT_MENU_ITEMS, type NavGroup, type NavItem } from './routes';

export { RETIRED_STORE_MENU_IDS };

export const STORE_MENU_LABEL_LIMIT = 20;
export type StoreMenuId = typeof STOREFRONT_MENU_ITEMS[number]['id'];
export type StoreNavigationEntry = { id: StoreMenuId; label: string; visible: boolean };
export type StoreNavigation = StoreNavigationEntry[];
export type StorefrontNavigation = Array<Pick<StoreNavigationEntry, 'id' | 'label'>>;
/* 새 기본 메뉴(X SQUARE, ADR-0043): 노출은 STOREFRONT_MENU_ITEMS 의 defaultVisible — NEW·BEST·카테고리·POP-UP·EVENT.
   공개 기본(DEFAULT_STOREFRONT_NAVIGATION)은 그 중 보이는 항목만이다. DB 기본값·이행(20261117120000)과 같은 내용이다. */
export const DEFAULT_STORE_NAVIGATION: StoreNavigation = STOREFRONT_MENU_ITEMS.map(({ id, label, defaultVisible }) => ({ id, label, visible: defaultVisible }));
export const DEFAULT_STOREFRONT_NAVIGATION: StorefrontNavigation = DEFAULT_STORE_NAVIGATION.filter(entry => entry.visible).map(({ id, label }) => ({ id, label }));
const menuIds = new Set<string>(STOREFRONT_MENU_ITEMS.map(item => item.id));
/* popups 가 생기기 전(2026-11-17 이전)에 저장된 메뉴 — 고정 8개 ID. 관용 파싱이 이 모양을 9개로 올려 읽는다. */
const LEGACY_MENU_IDS = new Set<string>([...menuIds].filter(id => id !== 'popups'));
const POPUPS_ENTRY: StoreNavigationEntry = { id: 'popups', label: STOREFRONT_MENU_ITEMS.find(item => item.id === 'popups')!.label, visible: true };

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

/* 옛 8개 저장값(popups 없음, 나머지 8 id가 정확히 한 번씩)이면 popups(POP-UP, 노출)를 카테고리 바로 뒤에 끼워 9개로 돌려준다.
   배포 틈(앱이 먼저 뜨고 DB 이행이 뒤따르는 짧은 사이)과 이행 전에 열어 둔 어드민 화면이 저장 설정을 통째로 잃지 않게 한다 —
   DB 이행(upgrade_store_navigation_popups)과 같은 규칙이다. 개수·중복·미지 id가 어긋난 값은 그대로 두어 아래 검증이 거절한다. */
function withLegacyPopups(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== LEGACY_MENU_IDS.size || !value.every(entry => validEntry(entry, true))) return value;
  const ids = value.map(entry => entry.id);
  if (new Set(ids).size !== ids.length || !ids.every(id => LEGACY_MENU_IDS.has(id))) return value;
  const shopIndex = ids.indexOf('shop');
  return [...value.slice(0, shopIndex + 1), POPUPS_ENTRY, ...value.slice(shopIndex + 1)];
}

/** Every stable id is stored once. A label never supplies a URL or a capability. */
export function parseStoreNavigation(stored: unknown): StoreNavigation | null {
  const value = withLegacyPopups(stored);
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
export function resolveStorefrontNavigation(navigation: StorefrontNavigation, communityEnabled = COMMUNITY_ENABLED): NavItem[] {
  return navigation.filter(item => !RETIRED_STORE_MENU_IDS.has(item.id) && (communityEnabled || item.id !== 'community'));
}

/* 카테고리 메가메뉴를 여는 GNB 항목. 이 항목의 GNB 이름('카테고리' 또는 운영 이름)은 메뉴의 이름이지
   메뉴 안 같은 목적지 링크(/shop = '전체 굿즈')의 이름이 아니다(CH-06). */
const MEGA_TRIGGER_ID: StoreMenuId = 'shop';

/** Related catalog links use the same labels and hide choices, preserving their own groups.
 *  The trigger's own destination keeps its group label — the GNB name of the trigger names the menu. */
export function configuredNavigationGroups(groups: NavGroup[], navigation: NavItem[]): NavGroup[] {
  const visible = new Map(navigation.map((item, index) => [item.id, { ...item, index }]));
  return groups.map(group => ({ ...group, items: group.items
    .filter(item => !menuIds.has(item.id) || visible.has(item.id))
    .map(item => visible.has(item.id) && item.id !== MEGA_TRIGGER_ID ? { id: item.id, label: visible.get(item.id)!.label } : item)
    .sort((a, b) => (visible.get(a.id)?.index ?? navigation.length) - (visible.get(b.id)?.index ?? navigation.length)),
  })).filter(group => group.items.length > 0);
}

/** A single store group keeps cross-category ordering identical to desktop/mobile GNB. */
export function storeMenuSheetGroups(navigation: NavItem[]): NavGroup[] {
  return [{ heading: '스토어', items: navigation }, ...MENU_SHEET_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => !menuIds.has(item.id)) }))
    .filter(group => group.items.length > 0)];
}
