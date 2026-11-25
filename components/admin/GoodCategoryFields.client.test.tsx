import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[], templates: false }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('./CategoryTemplatesAvailability', () => ({ useCategoryTemplatesAvailable: () => hooks.templates }));

import { AdminLabelWithHelp } from './console/AdminHelpTip';
import { AdminPickerDialog, type AdminPickerPanelProps } from './console/AdminPickerDialog';
import { CategoryTemplatePicker } from './screens/CategoryTemplatesScreen';
import { searchAssignableCategories, type CategorySearchNode } from './CategoryAssignmentField';
import { GoodAdditionalCategoryField, GoodCategoryField, categoryPickerLoader, type CategoryPickerRow } from './GoodCategoryFields';

type Fn = (...args: unknown[]) => unknown;
type Props = {
  id?: string; className?: string; children?: ReactNode; value?: string; type?: string; name?: string; hidden?: boolean; readOnly?: boolean; disabled?: boolean;
  placeholder?: string; htmlFor?: string; role?: string; href?: string; ref?: { current: unknown }; help?: unknown; label?: string;
  'aria-label'?: string; 'aria-describedby'?: string; 'aria-invalid'?: string; 'aria-haspopup'?: string; 'data-good-category'?: string; 'data-good-category-additional'?: string;
  onClick?: Fn; onKeyDown?: Fn; onChange?: Fn; onSelect?: Fn; onClose?: Fn;
};
type DialogProps = Pick<AdminPickerPanelProps<CategoryPickerRow>, 'load' | 'rowKey' | 'rowView' | 'onSelect' | 'onClose' | 'onDeselect' | 'selectedKeys' | 'excludedNote' | 'multiple' | 'searchPlaceholder' | 'emptyText'> & { title: string };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];

const node = (id: string, name: string, patch: Partial<CategorySearchNode> = {}): CategorySearchNode => ({ id, code: `code-${id}`, name, parentId: 'root', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...patch });
const root: AdminCategoryNode = { id: 'root', code: 'root', name: '문구', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 3, assignedGoodCount: 0 };
const categories: CategorySearchNode[] = [root, node('a', '가방'), node('b', '노트'), node('c', '다이어리')];
const ids = (rows: readonly CategoryPickerRow[]) => rows.map((row) => row.category.id);

const onPrimaryChange = vi.fn();
let primary = '';
let categoryList: CategorySearchNode[] = categories;
let error: string | undefined;

const reset = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = []; };
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; hooks.templates = false; onPrimaryChange.mockReset(); primary = ''; categoryList = categories; error = undefined; });

/* ───────── 대표 카테고리 ───────── */
function render() { reset(); return all(GoodCategoryField({ categories: categoryList, primary, onPrimaryChange, error })); }
const display = () => render().find((item) => item.props.id === 'good-category-display')!;
const buttons = () => render().filter((item) => item.type === 'button');
const buttonLabels = () => buttons().map((item) => texts(item).join(''));
const button = (label: string) => buttons().find((item) => texts(item).join('') === label)!;
const dialog = () => render().find((item) => item.type === AdminPickerDialog) as ReactElement<DialogProps> | undefined;
const dialogProps = () => dialog()!.props;
const hiddenSelect = () => render().find((item) => item.props.id === 'good-category-primary')!;
const flushEffects = () => { for (const effect of hooks.effects) effect(); };
const key = (name: string) => { const preventDefault = vi.fn(); display().props.onKeyDown!({ key: name, preventDefault }); return preventDefault; };
const firstPage = (rows: Promise<unknown>) => rows as Promise<{ rows: CategoryPickerRow[]; total: number; page: number; pageSize: number }>;
const request = (query = '', page = 1) => ({ query, field: '', filter: '', page });

describe('대표 카테고리 칸의 모양', () => {
  it('이름 옆에 "?"가 있고, 이름은 읽기 전용 상자에 이어진다', () => {
    const tree = render();
    const withHelp = tree.find((item) => item.type === AdminLabelWithHelp)!;
    expect(withHelp.props.label).toBe('대표 카테고리');
    expect(withHelp.props.help).toBe(GOOD_EDITOR_HELP.primaryCategory);
    const label = all(withHelp).find((item) => item.type === 'label')!;
    expect(label.props.htmlFor).toBe('good-category-display');
    expect(texts(label)).toEqual(['대표 카테고리']);
  });

  it('고르기 전에는 빈 상자와 [카테고리 선택]만 보인다', () => {
    expect(display().props).toMatchObject({ value: '', placeholder: '아직 고르지 않았습니다', readOnly: true });
    expect(buttonLabels()).toEqual(['카테고리 선택']);
  });

  it('고르면 상자에 경로가 보이고 [바꾸기]·[선택 해제]가 된다', () => {
    primary = 'b';
    expect(display().props.value).toBe('문구 > 노트');
    expect(buttonLabels()).toEqual(['바꾸기', '선택 해제']);
    expect(button('바꾸기').props['aria-label']).toBe('대표 카테고리 바꾸기');
    expect(button('선택 해제').props['aria-label']).toBe('대표 카테고리 선택 해제');
  });

  it('자주 쓰는 카테고리 버튼은 등록해 둔 것이 있을 때만 보인다', () => {
    expect(buttonLabels()).not.toContain('자주 쓰는 카테고리');
    hooks.templates = true;
    expect(buttonLabels()).toEqual(['카테고리 선택', '자주 쓰는 카테고리']);
  });

  it('늘 보이는 회색 안내 글이 없다 — 설명은 "?" 한 곳에 있다', () => {
    primary = 'b';
    const shown = texts(render()).join('|');
    expect(shown).not.toContain('마지막 단계 카테고리를 하나 고릅니다');
    expect(shown).not.toContain('공개할 수 있습니다');
    expect(render().some((item) => item.props.id === 'good-category-hint')).toBe(false);
  });

  it('목록에 없는 번호는 내부 번호를 보이지 않고 이름 없음으로 보인다', () => {
    primary = 'ghost-id';
    expect(display().props.value).toBe('알 수 없는 카테고리');
  });

  it('옛 입력칸·펼침 목록(combobox)을 쓰지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'components/admin/GoodCategoryFields.tsx'), 'utf8');
    expect(source).not.toMatch(/role="(?:combobox|listbox)"|aria-activedescendant|type="search"/);
    expect(texts(render()).join('|')).not.toContain('카테고리명 또는 코드로 찾기');
  });
});

describe('제출 계약', () => {
  it('숨긴 select가 name="categoryId"로 대표 카테고리 값을 제출한다', () => {
    primary = 'b';
    const select = hiddenSelect();
    expect(select.props).toMatchObject({ name: 'categoryId', id: 'good-category-primary', value: 'b', hidden: true, 'aria-hidden': 'true', tabIndex: -1 });
    const options = all(select).filter((item) => item.type === 'option').map((item) => [item.props.value, texts(item).join('')]);
    expect(options).toEqual([['', '미분류'], ['a', '문구 > 가방 (code-a)'], ['b', '문구 > 노트 (code-b)'], ['c', '문구 > 다이어리 (code-c)']]);
    expect(render().find((item) => item.props['data-good-category'] !== undefined)).toBeDefined();
  });

  it('보관된 대표 카테고리도 그대로 제출 목록에 남는다', () => {
    categoryList = [root, node('a', '가방', { archivedAt: '2026-11-01' }), node('b', '노트')];
    primary = 'a';
    const values = all(hiddenSelect()).filter((item) => item.type === 'option').map((item) => item.props.value);
    expect(values).toEqual(['', 'a', 'b']);
  });

  it('오류가 있으면 상자와 숨긴 select에 오류 표시를 하고 문구를 알린다', () => {
    error = '대표 카테고리를 골라주세요.';
    expect(display().props['aria-invalid']).toBe('true');
    expect(hiddenSelect().props['aria-invalid']).toBe('true');
    const alert = render().find((item) => item.props.role === 'alert')!;
    expect(texts(alert)).toEqual(['대표 카테고리를 골라주세요.']);
    expect(display().props['aria-describedby']).toBe(alert.props.id);
    error = undefined;
    expect(display().props['aria-invalid']).toBeUndefined();
    expect(display().props['aria-describedby']).toBeUndefined();
  });

  it('상위가 대표 카테고리를 바꾸면(ERP 품목 선택) 숨긴 select가 bubbling change를 보낸다', () => {
    const select = { dispatchEvent: vi.fn() };
    hiddenSelect().props.ref!.current = select;
    render(); flushEffects();
    expect(select.dispatchEvent).not.toHaveBeenCalled();
    primary = 'b';
    render(); flushEffects();
    expect(select.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = select.dispatchEvent.mock.calls[0][0] as Event;
    expect(event.type).toBe('change'); expect(event.bubbles).toBe(true);
    render(); flushEffects();
    expect(select.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('select에서 직접 바뀐 값은 이미 change가 났으므로 다시 보내지 않는다', () => {
    const select = { dispatchEvent: vi.fn() };
    hiddenSelect().props.ref!.current = select;
    hiddenSelect().props.onChange!({ target: { value: 'c' } });
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('c');
    primary = 'c';
    render(); flushEffects();
    expect(select.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('오류 포커스 자리', () => {
  /* 저장 오류·ERP 분류 확인이 focusGoodWorkspaceTarget('good-section-category','categoryId')를 부르면, 이름이 categoryId인 숨긴 select는 건너뛰고
     섹션 안에서 처음 보이는 input·select·textarea에 포커스가 간다. 선택창을 여는 읽기 전용 상자가 그 첫 칸이어야 한다. */
  it('섹션에서 처음 보이는 입력칸은 선택창을 여는 상자이고, 포커스를 받을 수 있다', () => {
    const controls = render().filter((item) => (item.type === 'input' || item.type === 'textarea' || item.props.name === 'categoryId') && item.props.type !== 'hidden' && !item.props.hidden);
    expect(controls).toHaveLength(1);
    expect(controls[0].props).toMatchObject({ id: 'good-category-display', readOnly: true });
    expect(controls[0].props.disabled).toBeUndefined();
    expect(controls[0].props.name).toBeUndefined();
  });

  it('제출되는 이름이 없는 입력칸이라 폼 값에 끼지 않는다', () => {
    expect(display().props.name).toBeUndefined();
    expect(render().filter((item) => item.props.name === 'categoryId')).toHaveLength(1);
  });
});

describe('대표 카테고리 선택창', () => {
  it('[카테고리 선택]을 누르면 선택창이 열리고 닫으면 닫힌다', () => {
    expect(dialog()).toBeUndefined();
    button('카테고리 선택').props.onClick!();
    const props = dialogProps();
    expect(props.title).toBe('대표 카테고리 선택');
    expect(props.excludedNote).toBe('하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.');
    expect(props.multiple).toBeUndefined();
    props.onClose();
    expect(dialog()).toBeUndefined();
  });

  it('상자를 누르거나 Enter·Space·↓를 눌러도 같은 창이 열리고, Enter는 폼 저장으로 번지지 않는다', () => {
    display().props.onClick!();
    expect(dialog()).toBeDefined();
    dialogProps().onClose();
    for (const name of ['Enter', ' ', 'ArrowDown']) {
      expect(key(name)).toHaveBeenCalled();
      expect(dialog(), name).toBeDefined();
      dialogProps().onClose();
    }
    expect(key('Tab')).not.toHaveBeenCalled();
    expect(key('a')).not.toHaveBeenCalled();
    expect(dialog()).toBeUndefined();
  });

  it('고른 카테고리는 목록에서 선택됨으로 보이고, 고르면 대표 카테고리가 바뀐 채 창이 닫힌다', async () => {
    primary = 'b';
    button('바꾸기').props.onClick!();
    expect(dialogProps().selectedKeys).toEqual(['b']);
    const { rows } = await firstPage(dialogProps().load(request()));
    await dialogProps().onSelect(rows.find((row) => row.category.id === 'c')!);
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('아직 고르지 않았다면 선택됨 표시가 없다', () => {
    button('카테고리 선택').props.onClick!();
    expect(dialogProps().selectedKeys).toBeUndefined();
  });

  it('찾기 칸 안내는 ERP 분류가 연결돼 있을 때만 ERP 분류명을 말한다', () => {
    button('카테고리 선택').props.onClick!();
    expect(dialogProps().searchPlaceholder).toBe('카테고리명 또는 코드로 찾기');
    dialogProps().onClose();
    categoryList = [root, node('a', '가방', { erpNames: ['문구>키링'] }), node('b', '노트')];
    button('카테고리 선택').props.onClick!();
    expect(dialogProps().searchPlaceholder).toBe('카테고리명·코드·ERP 분류명으로 찾기');
  });

  it('고를 수 있는 카테고리가 하나도 없으면 창을 열지 못하고 등록할 곳을 알린다', () => {
    categoryList = [root, node('a', '가방', { archivedAt: '2026-11-01' })];
    expect(button('카테고리 선택').props.disabled).toBe(true);
    display().props.onClick!(); key('Enter');
    expect(dialog()).toBeUndefined();
    const notice = render().find((item) => item.props.role === 'status')!;
    expect(texts(notice).join('')).toContain('등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요.');
    const link = all(notice).find((item) => item.props.href)!;
    expect(link.props).toMatchObject({ href: '/admin/catalog/categories', target: '_blank', rel: 'noreferrer' });
    categoryList = categories;
    expect(render().some((item) => item.props.role === 'status')).toBe(false);
  });
});

describe('선택 해제', () => {
  it('대표 카테고리를 비우고 [카테고리 선택] 버튼으로 포커스를 돌려준다', () => {
    primary = 'b';
    const focus = vi.fn();
    button('바꾸기').props.ref!.current = { focus };
    button('선택 해제').props.onClick!();
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('');
    expect(focus).toHaveBeenCalledTimes(1);
  });
});

describe('보관된 대표 카테고리', () => {
  it('고른 카테고리가 보관됐으면 상자에 보관됨을 붙이고 바꾸라고 알린다', () => {
    categoryList = [root, node('a', '가방', { archivedAt: '2026-11-01' }), node('b', '노트')];
    primary = 'a';
    expect(display().props.value).toBe('보관됨 · 문구 > 가방');
    const note = render().find((item) => item.props.id === 'good-category-archived')!;
    expect(texts(note)).toEqual(['보관된 카테고리입니다. 다른 카테고리로 바꿔주세요.']);
    expect(display().props['aria-describedby']).toBe('good-category-archived');
    primary = 'b';
    expect(render().some((item) => item.props.id === 'good-category-archived')).toBe(false);
    expect(display().props.value).toBe('문구 > 노트');
  });
});

describe('자주 쓰는 카테고리', () => {
  beforeEach(() => { hooks.templates = true; });
  const template = (categoryId: string, usable = true) => ({ categoryId, usable });

  it('고를 수 있는 바로가기를 고르면 대표 카테고리가 바뀐다', () => {
    button('자주 쓰는 카테고리').props.onClick!();
    const picker = render().find((item) => item.type === CategoryTemplatePicker)!;
    picker.props.onSelect!(template('c'));
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('c');
    expect(render().some((item) => item.type === CategoryTemplatePicker)).toBe(false);
  });

  it('지금 쓸 수 없게 된 카테고리면 바꾸지 않고 알린다', () => {
    button('자주 쓰는 카테고리').props.onClick!();
    render().find((item) => item.type === CategoryTemplatePicker)!.props.onSelect!(template('root'));
    expect(onPrimaryChange).not.toHaveBeenCalled();
    const alert = render().find((item) => item.props.role === 'alert')!;
    expect(texts(alert)).toEqual(['현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 확인해주세요.']);
    expect(render().some((item) => item.type === CategoryTemplatePicker)).toBe(false);
  });
});

/* ───────── 선택창 조회 ───────── */
describe('카테고리 선택창 조회(categoryPickerLoader)', () => {
  const many = Array.from({ length: 45 }, (_, index) => node(`n${String(index).padStart(2, '0')}`, `분류${index}`));
  const big = [root, ...many];

  it('고를 수 있는 마지막 단계 카테고리만 낸다 — 하위가 있거나 보관된 것은 목록에 넣지 않는다', async () => {
    const list = [root, node('a', '가방'), node('arch', '보관', { archivedAt: '2026-11-01' }), node('b', '노트', { childCount: 2 }), node('c', '다이어리', { parentId: 'arch-parent' }),
      { ...root, id: 'arch-parent', code: 'arch-parent', name: '옛 분류', archivedAt: '2026-10-01' }];
    const page = await firstPage(categoryPickerLoader(list)(request()));
    expect(ids(page.rows)).toEqual(['a']);
    expect(page.total).toBe(1);
  });

  it('줄은 "상위 > 하위" 경로와 코드를 보인다', async () => {
    const [row] = (await firstPage(categoryPickerLoader(categories)(request()))).rows;
    const view = dialogView(row);
    expect(view).toEqual({ title: '문구 > 가방', meta: 'code-a' });
  });

  it('20개씩 나누고 전체 개수를 센다', async () => {
    const load = categoryPickerLoader(big);
    const [first, second, third] = [await firstPage(load(request('', 1))), await firstPage(load(request('', 2))), await firstPage(load(request('', 3)))];
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([20, 20, 5]);
    expect([first.total, first.page, first.pageSize]).toEqual([45, 1, 20]);
    expect(first.rows[0].category.id).toBe('n00'); expect(third.rows.at(-1)!.category.id).toBe('n44');
    expect((await firstPage(load(request('', 99)))).page).toBe(3);
  });

  it('이름·경로·코드로 찾고 낱말이 모두 들어 있어야 한다', async () => {
    const load = categoryPickerLoader(categories);
    expect(ids((await firstPage(load(request('노트')))).rows)).toEqual(['b']);
    expect(ids((await firstPage(load(request('code-c')))).rows)).toEqual(['c']);
    expect(ids((await firstPage(load(request('문구 다이어리')))).rows)).toEqual(['c']);
    expect(ids((await firstPage(load(request('문구 > 가방')))).rows)).toEqual(['a']);
    expect((await firstPage(load(request('없는말')))).total).toBe(0);
    expect(ids((await firstPage(load(request('  노트  ')))).rows)).toEqual(['b']);
  });

  it('검색 범위가 CategoryAssignmentField와 같다', async () => {
    const list = [root, node('a', '가방', { erpNames: ['문구>키링'] }), node('b', '노트'), node('x', '보관 노트', { archivedAt: '2026-11-01' })];
    for (const query of ['노트', 'code', '문구>키링', '문구 키링', 'ERP', '>', '문구 > 노트', 'CODE-B']) {
      const page = await firstPage(categoryPickerLoader(list)(request(query)));
      expect(ids(page.rows), query).toEqual(searchAssignableCategories(list, query).map((category) => category.id));
    }
  });

  it('ERP 분류명으로 찾은 줄에만 근거를 붙인다', async () => {
    const list = [root, node('a', '가방', { erpNames: ['문구>키링'] }), node('b', '노트')];
    const load = categoryPickerLoader(list);
    const [byErp] = (await firstPage(load(request('문구>키링')))).rows;
    expect(byErp.erp).toBe('문구>키링');
    expect(dialogView(byErp).meta).toBe('code-a · ERP 분류 문구>키링');
    const [byName] = (await firstPage(load(request('가방')))).rows;
    expect(byName.erp).toBeNull();
    expect(dialogView(byName).meta).toBe('code-a');
    expect((await firstPage(load(request()))).rows.every((row) => row.erp === null)).toBe(true);
  });

  it('더 뺄 카테고리(대표 카테고리)는 목록과 개수에서 빠진다', async () => {
    const load = categoryPickerLoader(categories, new Set(['a']));
    const page = await firstPage(load(request()));
    expect(ids(page.rows)).toEqual(['b', 'c']); expect(page.total).toBe(2);
    expect(ids((await firstPage(load(request('가방')))).rows)).toEqual([]);
  });

  it('고른 줄의 키는 카테고리 번호다', async () => {
    const [row] = (await firstPage(categoryPickerLoader(categories)(request()))).rows;
    button('카테고리 선택').props.onClick!();
    expect(dialogProps().rowKey(row)).toBe('a');
  });

  it('받은 카테고리 순서를 바꾸지 않는다', async () => {
    const page = await firstPage(categoryPickerLoader([root, node('z', '하'), node('a', '가')])(request()));
    expect(ids(page.rows)).toEqual(['z', 'a']);
  });
});

function dialogView(row: CategoryPickerRow) {
  button('카테고리 선택').props.onClick!();
  const view = dialogProps().rowView(row);
  dialogProps().onClose();
  return view;
}

/* ───────── 추가 카테고리 ───────── */
function renderAdditional(value = '[]') { reset(); return all(GoodAdditionalCategoryField({ categories: categoryList, primary, value, error })); }
const hiddenValue = (value?: string) => JSON.parse(renderAdditional(value).find((item) => item.props.name === 'additionalCategoryIds')!.props.value as string) as string[];
const addButton = (value?: string) => renderAdditional(value).find((item) => item.props.id === 'good-additional-category')!;
const chosenLabels = (tree: ReactElement<Props>[]) => tree.filter((item) => item.type === 'div' && item.props.className?.includes('flex-wrap items-center gap-2 text-sm'))
  .map((row) => texts(all(row).find((item) => item.type === 'span')!).join(''));
const releaseButtons = () => renderAdditional().filter((item) => item.type === 'button' && texts(item).join('') === '빼기');
const additionalDialog = () => renderAdditional().find((item) => item.type === AdminPickerDialog) as ReactElement<DialogProps> | undefined;

describe('추가 카테고리 칸', () => {
  it('이름 옆에 "?"가 있고 [카테고리 추가] 버튼 하나로 시작한다', () => {
    const tree = renderAdditional();
    const withHelp = tree.find((item) => item.type === AdminLabelWithHelp)!;
    expect(withHelp.props.label).toBe('추가 카테고리');
    expect(withHelp.props.help).toBe(GOOD_EDITOR_HELP.additionalCategory);
    expect(texts(withHelp)).toEqual(['추가 카테고리 (선택)']);
    expect(tree.find((item) => item.props['data-good-category-additional'] !== undefined)).toBeDefined();
    expect(addButton().props['aria-haspopup']).toBe('dialog');
    expect(texts(addButton())).toEqual(['카테고리 추가']);
    expect(hiddenValue()).toEqual([]);
  });

  it('늘 보이는 회색 안내 글이 없다 — 옛 select도 없다', () => {
    const tree = renderAdditional('["a"]');
    expect(texts(tree).join('|')).not.toContain('상품 목록에서 대표·추가 카테고리로 찾을 수 있습니다');
    expect(tree.some((item) => item.type === 'select' || item.props.id === 'good-additional-category-hint')).toBe(false);
  });

  it('고른 카테고리는 줄로 보이고 [빼기]로 뺀다', () => {
    expect(chosenLabels(renderAdditional('["a","c"]'))).toEqual(['문구 > 가방', '문구 > 다이어리']);
    expect(releaseButtons().map((item) => item.props['aria-label'])).toEqual(['가방 추가 카테고리에서 빼기', '다이어리 추가 카테고리에서 빼기']);
    expect(hiddenValue('["a","c"]')).toEqual(['a', 'c']);
    releaseButtons()[0].props.onClick!();
    expect(hiddenValue()).toEqual(['c']);
  });

  it('값이 깨져 있거나 배열이 아니면 빈 목록으로 시작한다', () => {
    expect(hiddenValue('not json')).toEqual([]);
    hooks.state = [];
    expect(hiddenValue('{"a":1}')).toEqual([]);
    hooks.state = [];
    expect(hiddenValue('["a", 7, null, "b"]')).toEqual(['a', 'b']);
  });

  it('대표 카테고리와 같은 분류는 제출하지 않고, 한 번 빠지면 대표를 다시 바꿔도 되살아나지 않는다', () => {
    primary = '';
    expect(hiddenValue('["a","b"]')).toEqual(['a', 'b']);
    primary = 'a';
    expect(hiddenValue()).toEqual(['b']);
    primary = '';
    expect(hiddenValue()).toEqual(['b']);
  });

  it('보관된 카테고리와 목록에 없는 번호는 이름으로 알아볼 수 있게 보인다', () => {
    categoryList = [root, node('a', '가방', { archivedAt: '2026-11-01' })];
    expect(chosenLabels(renderAdditional('["a","ghost"]'))).toEqual(['보관됨 · 문구 > 가방', '알 수 없는 카테고리']);
    expect(releaseButtons().map((item) => item.props['aria-label'])).toEqual(['가방 추가 카테고리에서 빼기', '알 수 없는 카테고리 추가 카테고리에서 빼기']);
  });

  it('오류가 있으면 알린다', () => {
    error = '추가 카테고리를 다시 선택해주세요.';
    const alert = renderAdditional().find((item) => item.props.role === 'alert')!;
    expect(texts(alert)).toEqual(['추가 카테고리를 다시 선택해주세요.']);
  });
});

describe('추가 카테고리 선택창', () => {
  it('[카테고리 추가]가 같은 선택창을 여러 개 고르기로 연다', async () => {
    expect(additionalDialog()).toBeUndefined();
    addButton().props.onClick!();
    const props = additionalDialog()!.props;
    expect(props).toMatchObject({ title: '추가 카테고리 선택', multiple: true, selectedKeys: [] });
    expect(props.onDeselect).toBeTypeOf('function');
    expect(props.excludedNote).toBe('하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.');
    props.onClose();
    expect(additionalDialog()).toBeUndefined();
  });

  it('대표 카테고리는 목록에서 빼고 그 사실을 알린다', async () => {
    primary = 'a';
    addButton().props.onClick!();
    const props = additionalDialog()!.props;
    expect(props.excludedNote).toBe('대표 카테고리와, 하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.');
    const page = await firstPage(props.load(request()));
    expect(ids(page.rows)).toEqual(['b', 'c']); expect(page.total).toBe(2);
  });

  it('고르면 줄이 쌓이고 창은 그대로 두며, 이미 고른 줄은 선택됨으로 보인 채 빼기로 뺀다', async () => {
    addButton().props.onClick!();
    const rows = (await firstPage(additionalDialog()!.props.load(request()))).rows;
    await additionalDialog()!.props.onSelect(rows[1]);
    await additionalDialog()!.props.onSelect(rows[2]);
    await additionalDialog()!.props.onSelect(rows[1]);
    expect(hiddenValue()).toEqual(['b', 'c']);
    expect(additionalDialog()!.props.selectedKeys).toEqual(['b', 'c']);
    additionalDialog()!.props.onDeselect!(rows[1]);
    expect(hiddenValue()).toEqual(['c']);
    expect(additionalDialog()).toBeDefined();
  });

  it('대표를 바꿔 이미 고른 분류가 대표가 되면 선택됨 표시에서도 빠진다', () => {
    addButton('["a","b"]').props.onClick!();
    expect(additionalDialog()!.props.selectedKeys).toEqual(['a', 'b']);
    primary = 'a';
    expect(additionalDialog()!.props.selectedKeys).toEqual(['b']);
  });

  it('찾기 칸 안내는 대표 카테고리 칸과 같은 기준이다', () => {
    addButton().props.onClick!();
    expect(additionalDialog()!.props.searchPlaceholder).toBe('카테고리명 또는 코드로 찾기');
    additionalDialog()!.props.onClose();
    categoryList = [root, node('a', '가방', { erpNames: ['문구>키링'] })];
    addButton().props.onClick!();
    expect(additionalDialog()!.props.searchPlaceholder).toBe('카테고리명·코드·ERP 분류명으로 찾기');
  });
});
