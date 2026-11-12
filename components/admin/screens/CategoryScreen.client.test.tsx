import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useActionState: () => [{}, vi.fn(), false],
}));
vi.mock('@/app/admin/category-actions', () => ({
  assignAdminGoodCategoryAction: vi.fn(), archiveAdminCategoryAction: vi.fn(), saveAdminCategoryAction: vi.fn(), saveAdminCategoryErpMappingAction: vi.fn(),
  saveAdminCategoryTypeMigrationAction: vi.fn(), setAdminCategoryActivationAction: vi.fn(), unarchiveAdminCategoryAction: vi.fn(),
}));
vi.mock('../marketing/MarketingLinkIssuer', () => ({ MarketingLinkIssuer: () => null }));
vi.mock('../CategoryBulkCreatePanel', () => ({ CategoryBulkCreatePanel: () => null }));

import { CategoryTree } from '../CategoryTree';
import { CategoryScreen, categoryFormChanged } from './CategoryScreen';
import type { AdminCategoryNode } from '@/lib/admin/category';

const node = (id: string, name: string, sortOrder: number): AdminCategoryNode => ({
  id, code: `code-${sortOrder}`, name, parentId: null, depth: 1, sortOrder, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 0, assignedGoodCount: 0,
});
const first = node('00000000-0000-4000-8000-000000047401', '생활', 1);
const second = node('00000000-0000-4000-8000-000000047402', '문구', 2);
const form = (values: Record<string, string>) => ({ elements: { namedItem: (name: string) => (name in values ? { value: values[name] } : null) } }) as unknown as HTMLFormElement;
const saved = { name: first.name, code: first.code, parentId: '', sortOrder: '1' };

type Element = ReactElement<{ children?: ReactNode; onSelect?: (category: AdminCategoryNode) => void }>;
function all(value: ReactNode): Element[] {
  return Array.isArray(value) ? value.flatMap(all) : isValidElement(value) ? [value as Element, ...all((value.props as { children?: ReactNode }).children)] : [];
}
function selectThrough(category: AdminCategoryNode) {
  hooks.index = 0; hooks.refIndex = 0;
  const tree = all(CategoryScreen({ data: { categories: [first, second], mappings: [], migrations: [], activation: { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null } }, canManagePlatform: false }))
    .find(item => item.type === CategoryTree)!;
  tree.props.onSelect?.(category);
}

beforeEach(() => { hooks.state = []; hooks.refs = []; vi.stubGlobal('window', { confirm: vi.fn(() => false) }); });

it('수정 칸 값이 저장된 값과 같으면 변경 없음이고, 하나라도 다르면 변경 있음이다', () => {
  const categories = [first, second];
  expect(categoryFormChanged(form(saved), first, categories)).toBe(false);
  for (const change of [{ name: '생활잡화' }, { code: 'living' }, { parentId: second.id }, { sortOrder: '5' }, { goodType: '피규어' }] as Record<string, string>[]) expect(categoryFormChanged(form({ ...saved, ...change }), first, categories)).toBe(true);
  /* SHEET-003: 상품 유형 연결도 저장된 값과 비교한다. */
  expect(categoryFormChanged(form({ ...saved, goodType: '피규어' }), { ...first, goodType: '피규어' }, categories)).toBe(false);
  expect(categoryFormChanged(null, first, categories)).toBe(false);
});

it('보관된 상위는 선택지에 없어 최상위로 보이는 것이라 바꾼 것으로 치지 않는다', () => {
  const archivedParent = { ...second, archivedAt: '2026-10-01T00:00:00Z' };
  const child = { ...first, parentId: archivedParent.id };
  expect(categoryFormChanged(form({ ...saved, parentId: '' }), child, [child, archivedParent])).toBe(false);
});

it('수정 중인 입력이 있으면 다른 카테고리를 고를 때 묻고, 취소하면 고치던 항목에 머문다', () => {
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  selectThrough(second);
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(hooks.state[0]).toBeNull();
});

it('이동을 허락하면 다른 카테고리로 옮긴다', () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  selectThrough(second);
  expect(hooks.state[0]).toBe(second.id);
});

it('바꾼 값이 없거나 고치던 항목을 다시 누르면 묻지 않는다', () => {
  hooks.refs[0] = { current: form(saved) };
  selectThrough(second);
  expect(window.confirm).not.toHaveBeenCalled();
  expect(hooks.state[0]).toBe(second.id);
  hooks.state = [];
  hooks.refs[0] = { current: form({ ...saved, name: '입력 중' }) };
  selectThrough(first);
  expect(window.confirm).not.toHaveBeenCalled();
});
