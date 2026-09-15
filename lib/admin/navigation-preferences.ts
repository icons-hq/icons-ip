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

const STORAGE_PREFIX = 'icons.admin.navigation.v2';

export function adminNavigationStorageKey(accountId: string) {
  const safeAccountId = accountId.trim() || 'anonymous';
  return `${STORAGE_PREFIX}:${encodeURIComponent(safeAccountId)}`;
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
