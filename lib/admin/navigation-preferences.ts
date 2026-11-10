/**
 * 어드민 탐색 개인화의 브라우저 저장 계약.
 *
 * 메뉴 설정은 팀 공용 설정이나 권한이 아니다. 계정 ID를 키에 포함하고,
 * 화면·그룹 ID만 저장해 계정을 바꿨을 때 이전 운영자의 설정이 섞이지 않게 한다.
 */
export interface AdminNavigationPreferences {
  favoriteScreenIds: string[];
  collapsedGroupIds: string[];
}

export const DEFAULT_ADMIN_NAVIGATION_PREFERENCES: AdminNavigationPreferences = {
  favoriteScreenIds: [],
  collapsedGroupIds: [],
};

/*
 * v3(2026-11-05 IA 재정의): 메뉴 그룹 구성이 바뀌었다. 접힘 목록은 그룹 ID로 저장되므로 v2 목록을 그대로 쓰면
 * 새 그룹(취소·반품·교환·고객관리)이 저장 목록에 없어 펼쳐진 채로 보인다. v2는 즐겨찾기만 옮기고 접힘은 기본값으로 다시 시작한다.
 */
const STORAGE_PREFIX = 'icons.admin.navigation.v3';
const LEGACY_STORAGE_PREFIX = 'icons.admin.navigation.v2';

function storageKeyFor(prefix: string, accountId: string) {
  const safeAccountId = accountId.trim() || 'anonymous';
  return `${prefix}:${encodeURIComponent(safeAccountId)}`;
}

export function adminNavigationStorageKey(accountId: string) {
  return storageKeyFor(STORAGE_PREFIX, accountId);
}

export function legacyAdminNavigationStorageKey(accountId: string) {
  return storageKeyFor(LEGACY_STORAGE_PREFIX, accountId);
}

/** v2 저장값에서 즐겨찾기(화면 ID)만 옮긴다. 옮길 것이 없으면 null — 호출부는 기본값을 쓴다. */
export function migrateLegacyAdminNavigationPreferences(
  legacy: string | null,
  defaults: AdminNavigationPreferences,
): AdminNavigationPreferences | null {
  if (!legacy) return null;
  const { favoriteScreenIds } = parseAdminNavigationPreferences(legacy);
  if (favoriteScreenIds.length === 0) return null;
  return { favoriteScreenIds, collapsedGroupIds: [...defaults.collapsedGroupIds] };
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

export function parseAdminNavigationPreferences(value: string | null): AdminNavigationPreferences {
  if (!value) return { ...DEFAULT_ADMIN_NAVIGATION_PREFERENCES };

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_ADMIN_NAVIGATION_PREFERENCES };
    const candidate = parsed as { favoriteScreenIds?: unknown; collapsedGroupIds?: unknown };
    return {
      favoriteScreenIds: stringList(candidate.favoriteScreenIds),
      collapsedGroupIds: stringList(candidate.collapsedGroupIds),
    };
  } catch {
    return { ...DEFAULT_ADMIN_NAVIGATION_PREFERENCES };
  }
}

export function serializeAdminNavigationPreferences(preferences: AdminNavigationPreferences) {
  return JSON.stringify({
    favoriteScreenIds: [...new Set(preferences.favoriteScreenIds)],
    collapsedGroupIds: [...new Set(preferences.collapsedGroupIds)],
  });
}
