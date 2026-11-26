import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import type { GoodsAttributeCategoryRow } from '@/lib/admin/goods-attributes';
import type { GoodsAttributeField, GoodsAttributeSchema } from '@/lib/goods-attributes';

/* 화면 시험은 컴포넌트를 함수로 불러 요소 트리를 걷는다. 훅은 호출 순서(인덱스)로 모킹해, 상태를 바꾼 뒤 다시 그려 본다. */
const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, guard: vi.fn() }));
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('../useAdminLeaveGuard', () => ({ useAdminLeaveGuard: hooks.guard }));
vi.mock('@/app/admin/goods-attribute-actions', () => ({ readGoodsAttributesAction: mocks.read, saveGoodsAttributeSchemaAction: mocks.save }));

import { AdminPageHeader } from '../console/AdminKit';
import { AdminPickerDialog, type AdminPickerPanelProps } from '../console/AdminPickerDialog';
import { AdminSelect } from '../console/AdminSelect';
import { Button } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { GoodsAttributeSchemaScreen } from './GoodsAttributeSchemaScreen';

type Fn = (...args: unknown[]) => unknown;
type Props = {
  id?: string; children?: ReactNode; value?: string; checked?: boolean; readOnly?: boolean; disabled?: boolean; placeholder?: string; role?: string;
  'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-haspopup'?: string; 'aria-describedby'?: string;
  onClick?: Fn; onChange?: Fn; onKeyDown?: Fn;
};
type DialogProps = Pick<AdminPickerPanelProps<GoodsAttributeCategoryRow>, 'load' | 'rowKey' | 'rowView' | 'onSelect' | 'onClose' | 'excludedNote' | 'description' | 'footer' | 'selectedKeys' | 'searchPlaceholder' | 'emptyText'> & { title: string };

function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
  : typeof node === 'string' || typeof node === 'number' ? [String(node)]
    : isValidElement<Props>(node) ? texts(node.props.children) : [];
/** 화면에 보이는 글을 요소마다 한 줄로. 한 요소 안의 글(`항목 {n}/{m}개`)은 이어 붙여 그대로 읽힌다. */
function lines(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(lines);
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!isValidElement<Props>(node)) return [];
  const children = node.props.children;
  const list = Array.isArray(children) ? children : [children];
  if (list.every((child) => child == null || typeof child === 'boolean' || typeof child === 'string' || typeof child === 'number')) return [list.filter((child) => typeof child === 'string' || typeof child === 'number').join('')];
  return lines(children);
}

const node = (id: string, name: string, patch: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...patch });
const categories: AdminCategoryNode[] = [
  node('goods', '굿즈', { childCount: 2 }),
  node('doll', '인형', { parentId: 'goods', depth: 2, sortOrder: 1 }),
  node('keyring', '키링', { parentId: 'goods', depth: 2, sortOrder: 2 }),
  node('old', '단종', { parentId: 'goods', depth: 2, sortOrder: 3, archivedAt: '2026-11-01' }),
];
const option = (id: string, label: string) => ({ id: `option-${id}`, label });
const field = (id: string, patch: Partial<GoodsAttributeField> = {}): GoodsAttributeField => ({ id: `field-${id}`, name: `항목${id}`, kind: 'text', required: false, unit: '', options: [], ...patch });
const color = field('color', { name: '색상', kind: 'single', required: true, options: [option('red', '빨강'), option('blue', '파랑'), option('green', '초록')] });
const material = field('material', { name: '재질' });
const length = field('length', { name: '길이', kind: 'number', unit: 'cm' });
const saved: GoodsAttributeSchema = { categoryId: 'doll', revision: 3, fields: [color, material, length] };
const loaded = (schema: GoodsAttributeSchema) => ({ data: { schema, document: { revision: 0, entries: [] } } });

const reset = () => { hooks.stateIndex = 0; hooks.refIndex = 0; };
beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.guard.mockReset(); mocks.read.mockReset(); mocks.save.mockReset(); reset(); });
afterEach(() => { setAdminConfirmHandler(null); vi.unstubAllGlobals(); });

/** 확인창 요청을 모두 받아 적고 같은 답을 한다. */
function answer(value: boolean) {
  const asked: AdminConfirmRequest[] = [];
  setAdminConfirmHandler(async (request) => { asked.push(request); return value; });
  return asked;
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const request = (query = '') => ({ query, field: '', filter: '', page: 1 });

function render() { reset(); return all(GoodsAttributeSchemaScreen({ categories })); }
const buttons = () => render().filter((item) => item.type === Button);
const labelOf = (item: ReactElement<Props>) => texts(item).join('');
const button = (name: string, nth = 0) => {
  const found = buttons().filter((item) => labelOf(item) === name)[nth];
  if (!found) throw new Error(`버튼 없음: ${name} (있는 버튼: ${buttons().map(labelOf).join(', ')})`);
  return found;
};
const buttonLabels = () => buttons().map(labelOf);
const input = (label: string) => render().find((item) => item.type === Input && item.props['aria-label'] === label)!;
const select = (label: string) => render().find((item) => item.type === AdminSelect && item.props['aria-label'] === label)!;
const dialog = () => render().find((item) => item.type === AdminPickerDialog) as ReactElement<DialogProps> | undefined;
const box = () => render().find((item) => item.props.id === 'attribute-category-display')!;
const shown = () => lines(render()).join('\n');
const alerts = () => render().filter((item) => item.props.role === 'alert').map(labelOf);
const names = () => render().filter((item) => item.type === Input && /^항목 \d+ 이름$/.test(item.props['aria-label'] ?? '')).map((item) => item.props.value);

/** 카테고리 선택창에서 카테고리를 골라 항목을 연다(선택창이 닫는 일까지). */
async function openCategory(id: 'doll' | 'keyring', schema: GoodsAttributeSchema = { ...saved, categoryId: id }) {
  mocks.read.mockResolvedValueOnce(loaded(schema));
  await button(buttonLabels().includes('바꾸기') ? '바꾸기' : '카테고리 고르기').props.onClick!();
  const props = dialog()!.props;
  const page = await props.load(request());
  if ('error' in page) throw new Error(page.error);
  const closes = await props.onSelect(page.rows.find((row) => row.id === id)!);
  if (closes !== false) props.onClose();
  return closes;
}
const rename = (index: number, value: string) => input(`항목 ${index} 이름`).props.onChange!({ target: { value } });

describe('처음 화면', () => {
  it('카테고리 상자와 [카테고리 고르기]만 보인다 — 조회 버튼·순서 표시·드롭다운은 없다', () => {
    expect(buttonLabels()).toEqual(['카테고리 고르기']);
    expect(box().props).toMatchObject({ value: '', placeholder: '아직 고르지 않았습니다', readOnly: true });
    expect(render().some((item) => item.type === AdminSelect)).toBe(false);
    expect(shown()).not.toMatch(/상품속성 조회|맨 아래 단계|진행 순서|항목 추가/);
    const source = readFileSync(join(process.cwd(), 'components/admin/screens/GoodsAttributeSchemaScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/GoodsFlowSteps|attribute-copy-category|id="attribute-category"|상품속성 조회/);
  });

  it('카테고리 선택창은 고를 수 있는 맨 아래 카테고리만 상위 아래 순서로 보이고, 뺀 것을 한 줄로 알린다', async () => {
    button('카테고리 고르기').props.onClick!();
    const props = dialog()!.props;
    expect(props).toMatchObject({ title: '카테고리 고르기', excludedNote: '하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.', emptyText: '일치하는 카테고리가 없습니다.' });
    const page = await props.load(request());
    if ('error' in page) throw new Error(page.error);
    expect(page.rows.map((row) => row.id)).toEqual(['doll', 'keyring']);
    expect(props.rowView(page.rows[0])).toEqual({ title: '굿즈 > 인형', meta: '카테고리 코드 code-doll' });
    const found = await props.load(request('굿즈 키링'));
    if ('error' in found) throw new Error(found.error);
    expect(found.rows.map((row) => row.id)).toEqual(['keyring']);
  });

  it('상자를 누르거나 Enter·↓를 눌러도 같은 선택창이 열린다', () => {
    const preventDefault = vi.fn();
    box().props.onKeyDown!({ key: 'ArrowDown', preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(dialog()?.props.title).toBe('카테고리 고르기');
    dialog()!.props.onClose();
    expect(dialog()).toBeUndefined();
    box().props.onClick!();
    expect(dialog()?.props.title).toBe('카테고리 고르기');
  });
});

describe('카테고리를 고르면 바로 불러온다', () => {
  it('고른 카테고리의 항목을 읽어 보이고, 묻지 않으며, 선택창을 닫게 한다', async () => {
    const asked = answer(true);
    expect(await openCategory('doll')).toBe(true);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('doll');
    expect(asked).toEqual([]);
    expect(box().props.value).toBe('굿즈 > 인형');
    expect(buttonLabels()).toEqual(expect.arrayContaining(['바꾸기', '항목 추가', '가져올 카테고리 고르기', '저장', '최신 항목 보기']));
    expect(buttonLabels()).not.toContain('카테고리 고르기');
    expect(buttonLabels()).not.toContain('변경 취소');
    expect(button('저장').props.disabled).toBe(true);
    expect(names()).toEqual(['색상', '재질', '길이']);
    expect(shown()).toContain('항목 3/30개');
    expect(dialog()).toBeUndefined();
  });

  it('고른 카테고리는 선택창에서 선택됨으로 보인다', async () => {
    answer(true);
    await openCategory('doll');
    button('바꾸기').props.onClick!();
    expect(dialog()!.props.selectedKeys).toEqual(['doll']);
  });

  it('읽지 못하면 선택창을 열어 둔 채 그 안에 이유를 보이고, 화면은 그대로다', async () => {
    mocks.read.mockResolvedValueOnce({ error: '상품속성을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.' });
    button('카테고리 고르기').props.onClick!();
    const props = dialog()!.props;
    const page = await props.load(request());
    if ('error' in page) throw new Error(page.error);
    expect(await props.onSelect(page.rows[0])).toBe(false);
    expect(texts(dialog()!.props.footer).join('')).toBe('상품속성을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.');
    expect(box().props.value).toBe('');
    expect(buttonLabels()).toEqual(['카테고리 고르기']);
  });

  it('항목에 내부 번호(ID)를 보이지 않는다', async () => {
    answer(true);
    await openCategory('doll');
    const text = shown();
    expect(text).not.toMatch(/field-|option-|\bID\b|항목 번호/);
    expect(render().some((item) => item.props['aria-label'] === 'ID')).toBe(false);
  });

  it('저장하지 않은 변경이 있어도 카테고리 칸이 잠기지 않고, 다른 카테고리를 열 때 사라지는 변경을 묻는다', async () => {
    const asked = answer(false);
    await openCategory('doll');
    rename(1, '색깔');
    expect(button('바꾸기').props.disabled).toBeFalsy();
    mocks.read.mockResolvedValueOnce(loaded({ categoryId: 'keyring', revision: 1, fields: [material] }));
    button('바꾸기').props.onClick!();
    const props = dialog()!.props;
    const page = await props.load(request());
    if ('error' in page) throw new Error(page.error);
    const keyring = page.rows.find((row) => row.id === 'keyring')!;
    expect(await props.onSelect(keyring)).toBe(false);
    expect(asked).toEqual([{ title: '다른 카테고리를 열까요?', message: '‘굿즈 > 키링’의 상품속성 항목을 열면 저장하지 않은 변경이 사라집니다.\n수정 1개', confirmLabel: '열기', cancelLabel: '계속 고치기', destructive: true }]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(box().props.value).toBe('굿즈 > 인형');
    expect(names()[0]).toBe('색깔');
    setAdminConfirmHandler(async () => true);
    expect(await props.onSelect(keyring)).toBe(true);
    expect(mocks.read).toHaveBeenLastCalledWith('keyring');
    expect(box().props.value).toBe('굿즈 > 키링');
    expect(names()).toEqual(['재질']);
  });
});

describe('지우기 전에 사라지는 것을 묻는다', () => {
  beforeEach(async () => { answer(true); await openCategory('doll'); });

  it('[항목 삭제]: 이름과 선택값 수를 말하고, 취소하면 그대로 둔다', async () => {
    const asked = answer(false);
    button('항목 삭제', 0).props.onClick!();
    await flush();
    expect(asked).toEqual([{ title: '항목을 지울까요?', message: '‘색상’ 항목을 지웁니다. 선택값 3개도 함께 지워집니다.', confirmLabel: '지우기', destructive: true }]);
    expect(names()).toEqual(['색상', '재질', '길이']);
    setAdminConfirmHandler(async (asking) => { asked.push(asking); return true; });
    button('항목 삭제', 0).props.onClick!();
    await flush();
    expect(names()).toEqual(['재질', '길이']);
    expect(button('저장').props.disabled).toBe(false);
  });

  it('선택값이 없는 항목은 이름만 말한다', async () => {
    const asked = answer(true);
    button('항목 삭제', 1).props.onClick!();
    await flush();
    expect(asked[0].message).toBe('‘재질’ 항목을 지웁니다.');
  });

  it('이름도 선택값도 없는 새 항목은 묻지 않고 지운다', async () => {
    const asked = answer(false);
    button('항목 추가').props.onClick!();
    expect(names()).toEqual(['색상', '재질', '길이', '']);
    button('항목 삭제', 3).props.onClick!();
    await flush();
    expect(asked).toEqual([]);
    expect(names()).toEqual(['색상', '재질', '길이']);
    expect(button('저장').props.disabled).toBe(true);
  });

  it('이름이 없어도 선택값을 적었으면 몇 번째 항목인지 말하고 묻는다', async () => {
    const asked = answer(false);
    button('항목 추가').props.onClick!();
    select('항목 4 유형').props.onChange!({ target: { value: 'multi' } });
    await flush();
    button('선택값 추가', 1).props.onClick!();
    input('항목 4 선택값 1').props.onChange!({ target: { value: '빨강' } });
    button('항목 삭제', 3).props.onClick!();
    await flush();
    expect(asked[0].message).toBe('4번째 항목을 지웁니다. 선택값 1개도 함께 지워집니다.');
  });

  it('[변경 취소]: 바뀐 개수를 말하고, 확인하면 마지막으로 저장한 상태로 돌아간다', async () => {
    expect(buttonLabels()).not.toContain('변경 취소');
    rename(1, '색깔');
    button('항목 추가').props.onClick!();
    expect(shown()).toContain('저장하지 않은 변경 · 추가 1개 · 수정 1개');
    const asked = answer(false);
    await button('변경 취소').props.onClick!();
    expect(asked).toEqual([{ title: '변경을 취소할까요?', message: '저장하지 않은 변경을 모두 버리고 마지막으로 저장한 상태로 되돌립니다.\n추가 1개 · 수정 1개', confirmLabel: '변경 취소', cancelLabel: '계속 고치기', destructive: true }]);
    expect(names()).toEqual(['색깔', '재질', '길이', '']);
    setAdminConfirmHandler(async () => true);
    await button('변경 취소').props.onClick!();
    expect(names()).toEqual(['색상', '재질', '길이']);
    expect(buttonLabels()).not.toContain('변경 취소');
    expect(shown()).toContain('저장하지 않은 변경을 취소했습니다.');
  });
});

describe('유형을 바꾸면 지워지는 것을 묻는다', () => {
  beforeEach(async () => { answer(true); await openCategory('doll'); });

  it('선택값이 있는 항목을 선택이 아닌 유형으로 바꿀 때 선택값 수를 말하고, 취소하면 유형도 선택값도 그대로다', async () => {
    const asked = answer(false);
    select('항목 1 유형').props.onChange!({ target: { value: 'text' } });
    await flush();
    expect(asked).toEqual([{ title: '유형을 바꿀까요?', message: '‘색상’ 항목의 유형을 바꾸면 입력해 둔 내용이 지워집니다.\n유형: 단일 선택 → 텍스트\n지워지는 것: 선택값 3개', confirmLabel: '유형 바꾸기', destructive: true }]);
    expect(select('항목 1 유형').props.value).toBe('single');
    expect(input('항목 1 선택값 3').props.value).toBe('초록');
    setAdminConfirmHandler(async () => true);
    select('항목 1 유형').props.onChange!({ target: { value: 'text' } });
    await flush();
    expect(select('항목 1 유형').props.value).toBe('text');
    expect(render().some((item) => item.props['aria-label'] === '항목 1 선택값 1')).toBe(false);
  });

  it('숫자 항목의 단위가 지워질 때 단위를 말한다', async () => {
    const asked = answer(true);
    select('항목 3 유형').props.onChange!({ target: { value: 'single' } });
    await flush();
    expect(asked[0].message).toBe('‘길이’ 항목의 유형을 바꾸면 입력해 둔 내용이 지워집니다.\n유형: 숫자 → 단일 선택\n지워지는 것: 단위 ‘cm’');
    expect(select('항목 3 유형').props.value).toBe('single');
    expect(render().some((item) => item.props['aria-label'] === '항목 3 단위')).toBe(false);
  });

  it('지워지는 것이 없으면 묻지 않는다 — 단일↔복수 선택, 텍스트→숫자', async () => {
    const asked = answer(false);
    select('항목 1 유형').props.onChange!({ target: { value: 'multi' } });
    select('항목 2 유형').props.onChange!({ target: { value: 'number' } });
    await flush();
    expect(asked).toEqual([]);
    expect(select('항목 1 유형').props.value).toBe('multi');
    expect(input('항목 1 선택값 2').props.value).toBe('파랑');
    expect(select('항목 2 유형').props.value).toBe('number');
  });
});

describe('다른 카테고리의 항목 가져오기', () => {
  beforeEach(async () => { answer(true); await openCategory('doll'); });
  const keyring = (schema: GoodsAttributeSchema) => {
    mocks.read.mockResolvedValueOnce(loaded(schema));
    button('가져올 카테고리 고르기').props.onClick!();
    const props = dialog()!.props;
    return { props, row: { id: 'keyring', code: 'code-keyring', path: '굿즈 > 키링' } satisfies GoodsAttributeCategoryRow };
  };

  it('[가져올 카테고리 고르기]는 지금 고른 카테고리를 빼고 보이며, 고르면 무엇이 바뀌는지 말한다', async () => {
    button('가져올 카테고리 고르기').props.onClick!();
    const props = dialog()!.props;
    expect(props.title).toBe('가져올 카테고리 고르기');
    expect(props.description).toBe('고르면 지금 항목이 그 카테고리의 항목으로 바뀝니다. 저장하기 전에는 [변경 취소]로 되돌릴 수 있습니다.');
    expect(props.excludedNote).toBe('지금 고른 카테고리와, 하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.');
    const page = await props.load(request());
    if ('error' in page) throw new Error(page.error);
    expect(page.rows.map((row) => row.id)).toEqual(['keyring']);
  });

  it('지금 항목 수와 가져올 항목 수를 말하고 묻는다. 취소하면 그대로, 확인하면 바꾸고 결과를 알린다', async () => {
    const asked = answer(false);
    const { props, row } = keyring({ categoryId: 'keyring', revision: 2, fields: [field('a', { name: '색상' }), field('b', { name: '크기' })] });
    expect(await props.onSelect(row)).toBe(false);
    expect(asked).toEqual([{ title: '지금 항목을 바꿀까요?', message: '지금 항목 3개를 지우고 ‘굿즈 > 키링’의 항목 2개로 바꿉니다.', confirmLabel: '바꾸기', destructive: true }]);
    expect(names()).toEqual(['색상', '재질', '길이']);
    mocks.read.mockResolvedValueOnce(loaded({ categoryId: 'keyring', revision: 2, fields: [field('a', { name: '색상' }), field('b', { name: '크기' })] }));
    setAdminConfirmHandler(async () => true);
    expect(await dialog()!.props.onSelect(row)).toBe(true);
    expect(names()).toEqual(['색상', '크기']);
    expect(shown()).toContain('‘굿즈 > 키링’의 항목 2개를 가져왔습니다. 저장하기 전에 이 카테고리에 맞는지 확인해주세요.');
    expect(shown()).not.toMatch(/항목 번호/);
    expect(button('저장').props.disabled).toBe(false);
  });

  it('저장하지 않고 고친 내용이 있으면 그것도 사라진다고 말한다', async () => {
    rename(2, '소재');
    const asked = answer(true);
    const { props, row } = keyring({ categoryId: 'keyring', revision: 2, fields: [field('a', { name: '색상' })] });
    expect(await props.onSelect(row)).toBe(true);
    expect(asked[0].message).toBe('지금 항목 3개를 지우고 ‘굿즈 > 키링’의 항목 1개로 바꿉니다.\n저장하지 않고 고친 내용도 함께 사라집니다.');
  });

  it('항목이 없는 카테고리는 가져오지 않고, 선택창 안에서 다른 카테고리를 고르라고 한다', async () => {
    const asked = answer(true);
    const { props, row } = keyring({ categoryId: 'keyring', revision: 1, fields: [] });
    expect(await props.onSelect(row)).toBe(false);
    expect(asked).toEqual([]);
    expect(texts(dialog()!.props.footer).join('')).toBe('‘굿즈 > 키링’에는 상품속성 항목이 없습니다. 다른 카테고리를 골라주세요.');
    expect(names()).toEqual(['색상', '재질', '길이']);
    expect(button('저장').props.disabled).toBe(true);
  });

  it('읽지 못하면 이유를 선택창 안에 보이고 항목은 그대로다', async () => {
    mocks.read.mockResolvedValueOnce({ error: '상품속성 조회 권한이 없습니다.' });
    button('가져올 카테고리 고르기').props.onClick!();
    expect(await dialog()!.props.onSelect({ id: 'keyring', code: 'code-keyring', path: '굿즈 > 키링' })).toBe(false);
    expect(texts(dialog()!.props.footer).join('')).toBe('상품속성 조회 권한이 없습니다.');
    expect(names()).toEqual(['색상', '재질', '길이']);
  });

  it('지금 항목이 없으면 묻지 않고 바로 가져온다', async () => {
    for (let n = 0; n < 3; n += 1) { button('항목 삭제', 0).props.onClick!(); await flush(); }
    expect(names()).toEqual([]);
    const asked = answer(false);
    const { props, row } = keyring({ categoryId: 'keyring', revision: 2, fields: [field('a', { name: '색상' })] });
    expect(await props.onSelect(row)).toBe(true);
    expect(asked).toEqual([]);
    expect(names()).toEqual(['색상']);
  });
});

describe('다른 사람이 먼저 바꾼 저장본과 맞추기', () => {
  const latestSchema: GoodsAttributeSchema = { categoryId: 'doll', revision: 5, fields: [field('x', { name: '새 항목', required: true }), color] };
  beforeEach(async () => { answer(true); await openCategory('doll'); rename(1, '색깔'); });

  async function showLatest() {
    mocks.read.mockResolvedValueOnce(loaded(latestSchema));
    await button('최신 항목 보기').props.onClick!();
  }

  it('[최신 항목 보기]는 지금 저장돼 있는 항목을 이름·유형·필수로 보이고, 고를 일을 두 가지로 알린다', async () => {
    await showLatest();
    expect(mocks.read).toHaveBeenLastCalledWith('doll');
    const text = shown();
    expect(text).toContain('지금 저장돼 있는 항목');
    expect(text).toContain('새 항목 · 텍스트 · 필수');
    expect(text).toContain('색상 · 단일 선택 · 필수');
    expect(text).toContain('[내 입력 유지]를 누른 뒤 저장하면 위 항목이 내 입력으로 바뀝니다.');
    expect(buttonLabels()).toEqual(expect.arrayContaining(['내 입력 유지', '최신 항목으로 바꾸기']));
    expect(text).not.toMatch(/최신 버전|정의/);
  });

  it('[내 입력 유지]는 입력은 그대로 두고 다음 저장이 최신 저장본을 기준으로 하게 한다', async () => {
    await showLatest();
    button('내 입력 유지').props.onClick!();
    expect(names()[0]).toBe('색깔');
    expect(shown()).toContain('내 입력을 그대로 두었습니다. 저장하면 지금 저장돼 있는 항목이 내 입력으로 바뀝니다.');
    expect(shown()).not.toContain('지금 저장돼 있는 항목 ·');
    mocks.save.mockResolvedValueOnce({ data: { ...latestSchema, revision: 6 } });
    await button('저장').props.onClick!();
    expect(mocks.save.mock.calls[0][2]).toBe(5);
  });

  it('[최신 항목으로 바꾸기]는 내 변경이 있으면 개수를 말하고 묻는다. 취소하면 내 입력이 남는다', async () => {
    await showLatest();
    const asked = answer(false);
    button('최신 항목으로 바꾸기').props.onClick!();
    await flush();
    expect(asked).toEqual([{ title: '내 입력을 버릴까요?', message: '저장하지 않은 변경을 버리고 지금 저장돼 있는 항목 2개로 바꿉니다.\n수정 1개', confirmLabel: '바꾸기', cancelLabel: '계속 고치기', destructive: true }]);
    expect(names()).toEqual(['색깔', '재질', '길이']);
    setAdminConfirmHandler(async () => true);
    button('최신 항목으로 바꾸기').props.onClick!();
    await flush();
    expect(names()).toEqual(['새 항목', '색상']);
    expect(shown()).toContain('지금 저장돼 있는 항목으로 바꿨습니다.');
    expect(button('저장').props.disabled).toBe(true);
  });

  it('내 변경이 없으면 묻지 않고 바꾼다', async () => {
    rename(1, '색상');
    const asked = answer(false);
    await showLatest();
    button('최신 항목으로 바꾸기').props.onClick!();
    await flush();
    expect(asked).toEqual([]);
    expect(names()).toEqual(['새 항목', '색상']);
  });

  it('읽지 못하면 저장 줄에 이유를 보인다', async () => {
    mocks.read.mockResolvedValueOnce({ error: '상품속성을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.' });
    await button('최신 항목 보기').props.onClick!();
    expect(alerts()).toEqual(['상품속성을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.']);
    expect(names()[0]).toBe('색깔');
  });
});

describe('저장하지 않은 변경을 두고 떠날 때', () => {
  const guard = () => hooks.guard.mock.calls.at(-1)![0] as { dirty: boolean; blocked: boolean; message?: string };
  beforeEach(async () => { answer(true); await openCategory('doll'); });

  it('고친 것이 있을 때만 떠나기 경고가 켜지고, 고쳤다가 되돌리면 꺼진다', () => {
    render();
    expect(guard()).toMatchObject({ dirty: false, blocked: false });
    rename(1, '색깔');
    render();
    expect(guard()).toMatchObject({ dirty: true, blocked: false });
    rename(1, '색상');
    render();
    expect(guard()).toMatchObject({ dirty: false });
  });

  it('저장하는 중에는 떠나지 못하게 막는다', async () => {
    rename(1, '색깔');
    let finish: (value: unknown) => void = () => undefined;
    mocks.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const saving = button('저장').props.onClick!();
    render();
    expect(guard()).toMatchObject({ dirty: true, blocked: true });
    expect(button('저장하는 중').props.disabled).toBe(true);
    finish({ data: { ...saved, fields: [{ ...color, name: '색깔' }, material, length] } });
    await saving;
    render();
    expect(guard()).toMatchObject({ dirty: false, blocked: false });
  });
});

describe('저장', () => {
  beforeEach(async () => { answer(true); await openCategory('doll'); });

  it('이름이 빈 항목은 보내지 않고, 그 칸 아래와 위쪽 안내에 어느 항목인지 말하고, 그 칸으로 포커스를 옮긴다', async () => {
    const focus = vi.fn(); const requested: string[] = [];
    vi.stubGlobal('document', { getElementById: (id: string) => { requested.push(id); return { focus }; } });
    rename(2, '  ');
    await button('저장').props.onClick!();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(requested).toEqual(['attribute-field-material-name']);
    expect(focus).toHaveBeenCalledOnce();
    expect(alerts()).toEqual(['이름을 입력해주세요.', '항목 2의 이름을 입력해주세요.']);
    expect(input('항목 2 이름').props['aria-invalid']).toBe(true);
    expect(input('항목 2 이름').props['aria-describedby']).toBe('attribute-field-material-name-error');
    /* 고치는 대로 바로 사라진다. */
    rename(2, '소재');
    expect(alerts()).toEqual([]);
    expect(input('항목 2 이름').props['aria-invalid']).toBeUndefined();
  });

  it('같은 이름과 선택값이 없는 선택 유형은 그 항목 칸에서 말하고, 위쪽에는 첫 곳과 나머지 수를 말한다', async () => {
    rename(2, '색상');
    select('항목 3 유형').props.onChange!({ target: { value: 'multi' } });
    await flush();
    await button('저장').props.onClick!();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(alerts()).toEqual([
      '이미 항목 1에 같은 이름이 있습니다. 다르게 적어주세요.',
      '선택값을 하나 이상 추가해주세요.',
      '항목 1·2의 이름이 같습니다. 서로 다르게 적어주세요. 이 밖에 1곳이 더 있습니다.',
    ]);
  });

  it('이름이 빈 선택값과 같은 이름의 선택값은 그 줄 아래에서 말한다', async () => {
    button('선택값 추가', 0).props.onClick!();
    await button('저장').props.onClick!();
    expect(alerts()).toEqual(['선택값 이름을 입력해주세요.', '항목 1의 선택값 4 이름을 입력해주세요.']);
    input('항목 1 선택값 4').props.onChange!({ target: { value: '빨강' } });
    expect(alerts()).toEqual(['이미 선택값 1에 같은 이름이 있습니다. 다르게 적어주세요.', '항목 1의 선택값 1·4의 이름이 같습니다. 서로 다르게 적어주세요.']);
    expect(input('항목 1 선택값 4').props['aria-invalid']).toBe(true);
    input('항목 1 선택값 4').props.onChange!({ target: { value: '노랑' } });
    expect(alerts()).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('이름 앞뒤 공백을 걷어 내고 저장 번호와 기준 번호를 함께 보낸다. 저장되면 저장하지 않은 변경이 없는 상태가 된다', async () => {
    rename(1, ' 색깔 ');
    const result: GoodsAttributeSchema = { categoryId: 'doll', revision: 4, fields: [{ ...color, name: '색깔' }, material, length] };
    mocks.save.mockResolvedValueOnce({ data: result });
    await button('저장').props.onClick!();
    const [categoryId, sent, revision, operationId] = mocks.save.mock.calls[0];
    expect(categoryId).toBe('doll');
    expect((sent as GoodsAttributeField[]).map((item) => item.name)).toEqual(['색깔', '재질', '길이']);
    expect(revision).toBe(3);
    expect(typeof operationId).toBe('string');
    expect(render().find((item) => item.props.role === 'status' && labelOf(item).startsWith('상품속성 항목을 저장했습니다'))).toBeDefined();
    expect(shown()).toContain('상품속성 항목을 저장했습니다. 상품에 이미 넣은 값은 그대로 남아 있습니다.');
    expect(button('저장').props.disabled).toBe(true);
    expect(names()).toEqual(['색깔', '재질', '길이']);
    expect(buttonLabels()).not.toContain('변경 취소');
    /* 다음 저장의 기준은 방금 저장된 번호다. */
    rename(1, '색');
    mocks.save.mockResolvedValueOnce({ data: { ...result, revision: 5 } });
    await button('저장').props.onClick!();
    expect(mocks.save.mock.calls[1][2]).toBe(4);
    expect(mocks.save.mock.calls[1][3]).not.toBe(operationId);
  });

  it('다른 사람이 먼저 바꿨다는 안내는 저장 줄에 남고, 입력은 그대로다', async () => {
    rename(1, '색깔');
    mocks.save.mockResolvedValueOnce({ error: '다른 사람이 먼저 바꿨습니다. [최신 항목 보기]를 눌러 바뀐 내용을 확인해주세요. 입력한 내용은 그대로 있습니다.', conflict: true });
    await button('저장').props.onClick!();
    expect(alerts()).toEqual(['다른 사람이 먼저 바꿨습니다. [최신 항목 보기]를 눌러 바뀐 내용을 확인해주세요. 입력한 내용은 그대로 있습니다.']);
    expect(buttonLabels()).toContain('최신 항목 보기');
    expect(buttonLabels()).toContain('저장');
    expect(names()[0]).toBe('색깔');
    /* 고쳐도 이 안내는 남는다 — 아직 최신 항목을 확인하지 않았다. */
    rename(1, '색깔 2');
    expect(alerts()).toHaveLength(1);
  });

  it('저장됐는지 모르면 버튼이 [저장됐는지 확인]이 되고, 같은 저장 번호로 다시 보낸다. 고치면 새 저장 번호를 쓴다', async () => {
    rename(1, '색깔');
    const unknown = { error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다. 입력한 내용은 그대로 있습니다.', uncertain: true };
    mocks.save.mockResolvedValueOnce(unknown);
    await button('저장').props.onClick!();
    expect(alerts()).toEqual([unknown.error]);
    expect(buttonLabels()).toContain('저장됐는지 확인');
    expect(buttonLabels()).not.toContain('저장');
    render();
    expect(hooks.guard.mock.calls.at(-1)![0]).toMatchObject({ dirty: true, message: '저장됐는지 아직 확인하지 못했습니다. 이 화면을 떠나면 입력이 사라집니다. 이동할까요?' });
    mocks.save.mockResolvedValueOnce(unknown);
    await button('저장됐는지 확인').props.onClick!();
    expect(mocks.save.mock.calls[1][3]).toBe(mocks.save.mock.calls[0][3]);
    expect(mocks.save.mock.calls[1][1]).toEqual(mocks.save.mock.calls[0][1]);
    rename(1, '색깔 2');
    expect(alerts()).toEqual([]);
    expect(buttonLabels()).toContain('저장');
    mocks.save.mockResolvedValueOnce({ data: { ...saved, revision: 4, fields: [{ ...color, name: '색깔 2' }, material, length] } });
    await button('저장').props.onClick!();
    expect(mocks.save.mock.calls[2][3]).not.toBe(mocks.save.mock.calls[0][3]);
    render();
    expect(hooks.guard.mock.calls.at(-1)![0].message).toBeUndefined();
  });

  it('저장에 실패한 이유가 분명하면 그 말을 그대로 보이고, 저장 번호를 새로 만들지 않는다', async () => {
    rename(1, '색깔');
    mocks.save.mockResolvedValue({ error: '상품속성 항목을 저장하지 못했습니다. 카테고리와 입력을 확인한 뒤 다시 저장해주세요.' });
    await button('저장').props.onClick!();
    await button('저장').props.onClick!();
    expect(alerts()).toEqual(['상품속성 항목을 저장하지 못했습니다. 카테고리와 입력을 확인한 뒤 다시 저장해주세요.']);
    expect(mocks.save.mock.calls[1][3]).toBe(mocks.save.mock.calls[0][3]);
  });
});

describe('항목 고치기', () => {
  beforeEach(async () => { answer(true); await openCategory('doll'); });

  it('위로·아래로는 순서를 바꾸고, 맨 위·맨 아래에서는 눌리지 않는다', () => {
    expect(button('위로', 0).props.disabled).toBe(true);
    expect(button('아래로', 2).props.disabled).toBe(true);
    button('아래로', 0).props.onClick!();
    expect(names()).toEqual(['재질', '색상', '길이']);
    expect(shown()).toContain('저장하지 않은 변경 · 순서 바꿈');
    button('위로', 2).props.onClick!();
    expect(names()).toEqual(['재질', '길이', '색상']);
  });

  it('항목은 30개까지, 선택값은 항목당 100개까지만 늘린다', () => {
    for (let n = 0; n < 27; n += 1) button('항목 추가').props.onClick!();
    expect(shown()).toContain('항목 30/30개');
    expect(button('항목 추가').props.disabled).toBe(true);
    for (let n = 0; n < 97; n += 1) button('선택값 추가', 0).props.onClick!();
    expect(shown()).toContain('선택값 100/100');
    expect(button('선택값 추가', 0).props.disabled).toBe(true);
  });

  it('선택값은 그 줄만 지운다', () => {
    button('선택값 삭제', 1).props.onClick!();
    expect(render().filter((item) => item.type === Input && /^항목 1 선택값 \d+$/.test(item.props['aria-label'] ?? '')).map((item) => item.props.value)).toEqual(['빨강', '초록']);
  });

  it('같은 이름의 버튼이 여럿이라 읽어 주는 이름에 몇 번째 항목인지 붙이고, 보이는 글자로 시작한다', () => {
    const named = render().filter((item) => item.type === Button && item.props['aria-label'] && labelOf(item) !== '바꾸기');
    expect(named.map((item) => item.props['aria-label'])).toEqual(expect.arrayContaining(['위로 (항목 1)', '아래로 (항목 2)', '항목 삭제 (항목 3)', '선택값 삭제 (항목 1 선택값 2)']));
    for (const item of named) expect(item.props['aria-label']!.startsWith(labelOf(item)), item.props['aria-label']).toBe(true);
  });
});

describe('말투', () => {
  it('화면 코드(주석 제외)에 옛 이름·내부 값 이름이 없다', () => {
    const source = readFileSync(join(process.cwd(), 'components/admin/screens/GoodsAttributeSchemaScreen.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(source).not.toMatch(/속성 정의|속성 사전|정의를|정의가|최신 정의|최신 버전|항목 번호|\bID\b|저장 버전|window\.confirm|\bconfirm\(|alert\(/);
  });

  it('화면에 보이는 글이 상품속성 항목 하나로 말하고 번역투·옛 이름이 없다', async () => {
    answer(true);
    await openCategory('doll');
    rename(1, '색깔');
    mocks.read.mockResolvedValueOnce(loaded({ categoryId: 'doll', revision: 5, fields: [color] }));
    await button('최신 항목 보기').props.onClick!();
    const header = render().find((item) => item.type === AdminPageHeader)!.props as unknown as { title: string; description: string };
    expect(header.title).toBe('상품속성 관리');
    const text = [header.description, shown()].join('\n');
    expect(text).toContain('상품속성 항목');
    expect(text).not.toMatch(/정의|속성 사전|에 대한|을 통해|에 의해|해당|활성화|매핑|프리셋|최신 버전|항목 번호/);
  });
});
