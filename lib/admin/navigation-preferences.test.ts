import { describe, expect, it } from 'vitest';
import {
  adminNavigationStorageKey,
  legacyAdminNavigationStorageKey,
  migrateLegacyAdminNavigationPreferences,
  parseAdminNavigationPreferences,
  serializeAdminNavigationPreferences,
} from './navigation-preferences';

describe('어드민 메뉴 개인화 저장 계약', () => {
  it('계정별 저장 키를 분리하고 안전하게 인코딩한다', () => {
    expect(adminNavigationStorageKey('user/a@example.com')).toBe(
      'icons.admin.navigation.v3:user%2Fa%40example.com',
    );
    expect(adminNavigationStorageKey('')).toBe('icons.admin.navigation.v3:anonymous');
    expect(legacyAdminNavigationStorageKey('user/a@example.com')).toBe('icons.admin.navigation.v2:user%2Fa%40example.com');
  });

  /* 2026-11-05 IA 재정의로 그룹 구성이 바뀌었다. v2 접힘 목록에는 새 그룹이 없어 펼쳐진 채로 보이므로 즐겨찾기만 옮긴다. */
  it('v2 저장값은 즐겨찾기만 옮기고 접힘은 기본값으로 다시 시작한다', () => {
    const defaults = { favoriteScreenIds: [], collapsedGroupIds: ['sales', 'claims', 'customers'] };
    const legacy = JSON.stringify({ favoriteScreenIds: ['orders', 'dispatch'], collapsedGroupIds: ['catalog'] });
    expect(migrateLegacyAdminNavigationPreferences(legacy, defaults)).toEqual({
      favoriteScreenIds: ['orders', 'dispatch'],
      collapsedGroupIds: ['sales', 'claims', 'customers'],
    });
    expect(migrateLegacyAdminNavigationPreferences(JSON.stringify({ collapsedGroupIds: ['catalog'] }), defaults)).toBeNull();
    expect(migrateLegacyAdminNavigationPreferences(null, defaults)).toBeNull();
    expect(migrateLegacyAdminNavigationPreferences('{bad', defaults)).toBeNull();
  });

  it('잘못된 저장값은 빈 설정으로 닫고 중복 ID를 정리한다', () => {
    expect(parseAdminNavigationPreferences('{bad')).toEqual({ favoriteScreenIds: [], collapsedGroupIds: [] });
    expect(parseAdminNavigationPreferences(JSON.stringify({
      favoriteScreenIds: ['orders', 'orders', 3, ''],
      collapsedGroupIds: ['sales', null, 'sales'],
    }))).toEqual({ favoriteScreenIds: ['orders'], collapsedGroupIds: ['sales'] });
  });

  it('저장·복구 가능한 JSON만 만든다', () => {
    const serialized = serializeAdminNavigationPreferences({
      favoriteScreenIds: ['orders', 'orders'],
      collapsedGroupIds: ['sales'],
    });
    expect(JSON.parse(serialized)).toEqual({ favoriteScreenIds: ['orders'], collapsedGroupIds: ['sales'] });
  });
});
