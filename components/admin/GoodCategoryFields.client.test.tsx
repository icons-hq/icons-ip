import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, layout: [] as { deps: unknown[] }[], layoutIndex: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => {},
  useLayoutEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.layoutIndex++, previous = hooks.layout[index];
    if (previous && !deps.some((dep, position) => dep !== previous.deps[position])) return;
    hooks.layout[index] = { deps };
    effect();
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));
vi.mock('./CategoryTemplatesAvailability', () => ({ useCategoryTemplatesAvailable: () => false }));

import { GoodCategoryField, keepOptionInView, moveCategoryActive } from './GoodCategoryFields';

type Props = {
  id?: string; role?: string; className?: string; children?: ReactNode; value?: string; 'aria-activedescendant'?: string; 'aria-expanded'?: boolean; 'aria-selected'?: boolean; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void; onFocus?: () => void;
  onKeyDown?: (event: unknown) => void; onBlur?: (event: unknown) => void; onMouseDown?: (event: { preventDefault: () => void }) => void; onMouseMove?: () => void; ref?: unknown;
};
function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
const leaf = (id: string, name: string): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId: 'root', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0 });
const root: AdminCategoryNode = { id: 'root', code: 'root', name: '문구', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 3, assignedGoodCount: 0 };
const categories = [root, leaf('a', '가방'), leaf('b', '노트'), leaf('c', '다이어리')];
const onPrimaryChange = vi.fn();
let primary = '';
let categoryList: Parameters<typeof GoodCategoryField>[0]['categories'] = categories;

function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.layoutIndex = 0; return all(GoodCategoryField({ categories: categoryList, primary, onPrimaryChange })); }
const input = () => render().find((item) => item.props.id === 'good-category-search')!;
const options = () => render().filter((item) => item.props.role === 'option');
const listbox = () => render().find((item) => item.props.role === 'listbox');
const key = (name: string, extra: Record<string, unknown> = {}) => { const preventDefault = vi.fn(); input().props.onKeyDown!({ key: name, preventDefault, keyCode: 0, nativeEvent: { isComposing: false }, ...extra }); return preventDefault; };
const activeOption = () => options().find((item) => item.props['aria-selected'])?.props.id;

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.layout = []; onPrimaryChange.mockReset(); primary = ''; categoryList = categories; });

/* 사람 눈 시험(2026-11-10): 칸을 누르기만 해도 목록이 폼 사이에 펼쳐져 아래 폼이 316px 밀렸고, ↓/Enter로 고를 수 없었다. */
describe('대표 카테고리 찾기(combobox)', () => {
  it('칸을 눌러야 열리고, 포커스만으로는 열리지 않는다', () => {
    expect(input().props.onFocus).toBeUndefined();
    expect(input().props.role).toBe('combobox');
    expect(input().props['aria-expanded']).toBe(false);
    expect(listbox()).toBeUndefined();
    input().props.onClick!();
    expect(input().props['aria-expanded']).toBe(true);
    expect(options().map((item) => item.props.id)).toEqual(['good-category-option-0', 'good-category-option-1', 'good-category-option-2']);
  });

  it('타이핑하면 열리고 결과의 첫 줄을 강조한다', () => {
    input().props.onChange!({ target: { value: '노트' } });
    expect(input().props['aria-expanded']).toBe(true);
    expect(input().props.value).toBe('노트');
    expect(options()).toHaveLength(1);
    expect(input().props['aria-activedescendant']).toBe('good-category-option-0');
  });

  it('목록은 입력칸 묶음 안에 겹쳐 떠 아래 폼을 밀지 않는다', () => {
    input().props.onClick!();
    const tree = render();
    const wrapper = tree.find((item) => item.props.onBlur)!;
    expect(wrapper.props.className).toContain('relative');
    const panel = all(wrapper).find((item) => item.type === 'div' && item.props.className?.includes('absolute'))!;
    expect(panel.props.className).toContain('top-full');
    expect(all(panel).some((item) => item.props.role === 'listbox')).toBe(true);
  });

  it('↑↓로 강조를 옮기고 끝에서 멈추며, 화면에 강조 위치를 알린다', () => {
    expect(key('ArrowDown')).toHaveBeenCalled();
    expect(input().props['aria-expanded']).toBe(true);
    expect(input().props['aria-activedescendant']).toBe('good-category-option-0');
    key('ArrowDown');
    expect(input().props['aria-activedescendant']).toBe('good-category-option-1');
    expect(activeOption()).toBe('good-category-option-1');
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(input().props['aria-activedescendant']).toBe('good-category-option-2');
    key('ArrowUp');
    expect(input().props['aria-activedescendant']).toBe('good-category-option-1');
  });

  it('Enter로 강조한 항목을 고르고 목록을 닫으며 저장으로 번지지 않는다', () => {
    key('ArrowDown'); key('ArrowDown');
    const prevented = key('Enter');
    expect(prevented).toHaveBeenCalled();
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('b');
    expect(input().props['aria-expanded']).toBe(false);
    expect(input().props.value).toBe('');
  });

  it('닫혀 있을 때 Enter는 아무것도 고르지 않지만 폼을 제출하지도 않는다', () => {
    expect(key('Enter')).toHaveBeenCalled();
    expect(onPrimaryChange).not.toHaveBeenCalled();
  });

  it('한글 조합 중의 Enter는 고르지 않는다', () => {
    input().props.onClick!();
    key('Enter', { nativeEvent: { isComposing: true } });
    expect(onPrimaryChange).not.toHaveBeenCalled();
    key('Enter', { keyCode: 229 });
    expect(onPrimaryChange).not.toHaveBeenCalled();
  });

  it('Esc는 검색어를 지우고 닫는다', () => {
    input().props.onChange!({ target: { value: '노' } });
    key('Escape');
    expect(input().props['aria-expanded']).toBe(false);
    expect(input().props.value).toBe('');
  });

  it('Tab·바깥으로 나가면 닫고, 안에서 움직이면 그대로 둔다', () => {
    input().props.onClick!();
    key('Tab');
    expect(input().props['aria-expanded']).toBe(false);
    input().props.onClick!();
    const wrapper = () => render().find((item) => item.props.onBlur)!;
    wrapper().props.onBlur!({ currentTarget: { contains: () => true }, relatedTarget: {} });
    expect(input().props['aria-expanded']).toBe(true);
    wrapper().props.onBlur!({ currentTarget: { contains: () => false }, relatedTarget: {} });
    expect(input().props['aria-expanded']).toBe(false);
  });

  it('마우스로 골라도 입력칸의 포커스를 뺏지 않는다', () => {
    input().props.onClick!();
    const panel = render().find((item) => item.props.onMouseDown)!;
    const preventDefault = vi.fn();
    panel.props.onMouseDown!({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    options()[2].props.onClick!();
    expect(onPrimaryChange).toHaveBeenCalledExactlyOnceWith('c');
    expect(input().props['aria-expanded']).toBe(false);
  });

  it('마우스를 올린 줄이 강조되고, 지금 대표 카테고리 줄을 강조해서 연다', () => {
    primary = 'c';
    input().props.onClick!();
    expect(input().props['aria-activedescendant']).toBe('good-category-option-2');
    options()[0].props.onMouseMove!();
    expect(input().props['aria-activedescendant']).toBe('good-category-option-0');
  });

  it('결과가 없으면 강조 대상을 가리키지 않는다', () => {
    input().props.onChange!({ target: { value: '없는말' } });
    expect(input().props['aria-activedescendant']).toBeUndefined();
    expect(listbox()).toBeUndefined();
    key('Enter');
    expect(onPrimaryChange).not.toHaveBeenCalled();
  });
});

/* 1027T-016(T18): 상품 등록의 카테고리 찾기도 연결된 ERP 분류명으로 찾고, 그렇게 찾은 줄에 근거를 붙인다(CategoryAssignmentField와 같다). */
describe('대표 카테고리 찾기의 ERP 분류명', () => {
  const texts = (node: ReactNode): string[] => Array.isArray(node) ? node.flatMap(texts)
    : typeof node === 'string' || typeof node === 'number' ? [String(node)]
      : isValidElement<Props>(node) ? texts(node.props.children) : [];
  const optionText = (index: number) => texts(options()[index]).join('');

  it('연결된 ERP 분류가 있으면 ERP 분류명으로도 찾는다고 알리고, 없으면 예전 안내를 둔다', () => {
    expect(input().props).toMatchObject({ placeholder: '카테고리명 또는 코드로 찾기' });
    categoryList = [root, { ...leaf('a', '가방'), erpNames: ['문구>키링'] }, leaf('b', '노트')];
    expect(input().props).toMatchObject({ placeholder: '카테고리명·코드·ERP 분류명으로 찾기' });
  });

  it('ERP 분류명으로 찾은 줄에만 근거를 붙인다', () => {
    categoryList = [root, { ...leaf('a', '가방'), erpNames: ['문구>키링'] }, leaf('b', '노트')];
    input().props.onChange!({ target: { value: '문구>키링' } });
    expect(options()).toHaveLength(1);
    expect(optionText(0)).toContain('code-a · ERP 분류 문구>키링');
    input().props.onChange!({ target: { value: '가방' } });
    expect(options()).toHaveLength(1);
    expect(optionText(0)).not.toContain('ERP 분류');
    input().props.onChange!({ target: { value: '' } });
    input().props.onClick!();
    expect(options().map((_, index) => optionText(index)).join('|')).not.toContain('ERP 분류');
  });
});

describe('강조 위치 계산', () => {
  it('끝에서 멈춘다', () => {
    expect(moveCategoryActive('ArrowDown', 0, 3)).toBe(1);
    expect(moveCategoryActive('ArrowDown', 2, 3)).toBe(2);
    expect(moveCategoryActive('ArrowUp', 1, 3)).toBe(0);
    expect(moveCategoryActive('ArrowUp', 0, 3)).toBe(0);
  });

  it('강조한 줄이 보이게 목록만 스크롤한다', () => {
    const list = { scrollTop: 100, clientHeight: 200 };
    keepOptionInView(list, { offsetTop: 150, offsetHeight: 44 });
    expect(list.scrollTop).toBe(100);
    keepOptionInView(list, { offsetTop: 300, offsetHeight: 44 });
    expect(list.scrollTop).toBe(144);
    keepOptionInView(list, { offsetTop: 44, offsetHeight: 44 });
    expect(list.scrollTop).toBe(44);
  });
});
