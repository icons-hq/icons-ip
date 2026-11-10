import { describe, expect, it } from 'vitest';
import { gridPreferencesStorageKey, moveGridColumn, normalizeGridPreferences, parseGridPreferences } from './grid-preferences';

const columns = [{ key: 'id' }, { key: 'name' }, { key: 'total', required: true }, { key: 'memo', defaultVisible: false }];

describe('계정별 조회항목 설정', () => {
  it('이전 스키마의 삭제된 열과 중복을 제거하고 새 열과 필수 열을 보존한다', () => {
    expect(normalizeGridPreferences({ version: 1, order: ['old', 'name', 'name', 'id'], hidden: ['id', 'total', 'old', 'memo'], frozenCount: 9 }, columns)).toEqual({
      version: 1, order: ['name', 'total', 'memo', 'id'], hidden: ['memo'], frozenCount: 3,
    });
  });
  it('저장한 뒤 새로 생긴 열은 맨 뒤가 아니라 정의 순서의 바로 앞 열 뒤에 끼우고, 기본 숨김 열은 숨긴 채로 둔다', () => {
    const next = [{ key: 'name' }, { key: 'goodId' }, { key: 'edit' }, { key: 'price' }, { key: 'note', defaultVisible: false }];
    // 운영자가 옮겨 둔 순서(price를 앞으로)와 숨김은 그대로 둔다.
    expect(normalizeGridPreferences({ version: 1, order: ['name', 'price', 'edit'], hidden: ['edit'], frozenCount: 1 }, next)).toEqual({
      version: 1, order: ['name', 'goodId', 'price', 'note', 'edit'], hidden: ['edit', 'note'], frozenCount: 1,
    });
    // 첫 열이 새로 생기면 맨 앞이다.
    expect(normalizeGridPreferences({ version: 1, order: ['edit', 'price'], hidden: [] }, next).order).toEqual(['name', 'goodId', 'edit', 'price', 'note']);
    // 저장이 없으면 정의 순서 그대로다.
    expect(normalizeGridPreferences(null, next).order).toEqual(next.map(column => column.key));
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
