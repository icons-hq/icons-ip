import { describe, expect, it } from 'vitest';
import { gridPreferencesStorageKey, moveGridColumn, normalizeGridPreferences, parseGridPreferences } from './grid-preferences';

const columns = [{ key: 'id' }, { key: 'name' }, { key: 'total', required: true }, { key: 'memo', defaultVisible: false }];

describe('계정별 조회항목 설정', () => {
  it('이전 스키마의 삭제된 열과 중복을 제거하고 새 열과 필수 열을 보존한다', () => {
    expect(normalizeGridPreferences({ version: 1, order: ['old', 'name', 'name', 'id'], hidden: ['id', 'total', 'old', 'memo'], frozenCount: 9 }, columns)).toEqual({
      version: 1, order: ['name', 'id', 'total', 'memo'], hidden: ['memo'], frozenCount: 3,
    });
  });
  it('손상된 설정과 미지원 버전은 기본 표시를 복원한다', () => {
    const expected = { version: 1, order: ['id', 'name', 'total', 'memo'], hidden: ['memo'], frozenCount: 0 };
    expect(parseGridPreferences('{broken', columns)).toEqual(expected);
    expect(normalizeGridPreferences({ version: 99, order: ['memo'], hidden: ['name'] }, columns)).toEqual(expected);
  });
  it('열 이동이 셀의 식별 키를 보존하고 양끝에서 벗어나지 않는다', () => {
    const initial = normalizeGridPreferences(null, columns);
    expect(moveGridColumn(initial, 'name', 1).order).toEqual(['id', 'total', 'name', 'memo']);
    expect(moveGridColumn(initial, 'id', -1)).toBe(initial);
    expect(moveGridColumn(initial, 'missing', 1)).toBe(initial);
  });
  it('계정·화면 키가 서로 섞이지 않는다', () => {
    expect(gridPreferencesStorageKey('a', 'orders')).not.toBe(gridPreferencesStorageKey('b', 'orders'));
    expect(gridPreferencesStorageKey('a:b', 'c')).not.toBe(gridPreferencesStorageKey('a', 'b:c'));
  });
});
