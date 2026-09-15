import { describe, expect, it } from 'vitest';
import {
  adminNavigationStorageKey,
  parseAdminNavigationPreferences,
  serializeAdminNavigationPreferences,
} from './navigation-preferences';

describe('어드민 메뉴 개인화 저장 계약', () => {
  it('계정별 저장 키를 분리하고 안전하게 인코딩한다', () => {
    expect(adminNavigationStorageKey('user/a@example.com')).toBe(
      'icons.admin.navigation.v2:user%2Fa%40example.com',
    );
    expect(adminNavigationStorageKey('')).toBe('icons.admin.navigation.v2:anonymous');
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
