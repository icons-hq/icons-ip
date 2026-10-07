import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErpItemMatch } from '@/lib/admin/erp-items';

const hooks = vi.hoisted(() => ({
  enabled: false,
  state: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  search: vi.fn(),
}));

vi.mock('@/app/admin/erp-item-actions', () => ({ searchErpItemsAction: hooks.search }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useId: () => (hooks.enabled ? 'erp-list' : actual.useId()),
    useEffect: (...args: Parameters<typeof actual.useEffect>) => (hooks.enabled ? undefined : actual.useEffect(...args)),
    useRef: (initial: unknown) => {
      if (!hooks.enabled) return actual.useRef(initial);
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
    useState: (initial: unknown) => {
      if (!hooks.enabled) return actual.useState(initial);
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
  };
});

const { ErpItemNameInput } = await import('./ErpItemNameInput');

const items: ErpItemMatch[] = [
  { code: 'K-2', name: '키링 거치대', category: '문구 > 키링', salePrice: 8000, barcode: null, mappedCategoryId: 'leaf' },
  { code: '000123', name: '아크릴 키링', category: null, salePrice: 12000, barcode: '0088', mappedCategoryId: null },
];

function render(props: Partial<Parameters<typeof ErpItemNameInput>[0]> = {}) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return ErpItemNameInput({ value: '', onChange: vi.fn(), ariaLabel: '옵션 1 ERP 품명', ...props });
}

type Props = {
  children?: ReactNode;
  role?: string;
  onChange?: (event: unknown) => void;
  onKeyDown?: (event: unknown) => void;
  onBlur?: () => void;
  onMouseDown?: (event: unknown) => void;
  onClick?: () => void;
  'aria-expanded'?: boolean;
  'aria-activedescendant'?: string;
  'aria-selected'?: boolean;
};

function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const matches = predicate(node) ? [node] : [];
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) matches.push(...find(child, predicate));
  return matches;
}

const input = (tree: ReactNode) => find(tree, (element) => element.type === 'input')[0];
const options = (tree: ReactNode) => find(tree, (element) => element.props.role === 'option');
const key = (name: string) => ({ key: name, preventDefault: vi.fn(), nativeEvent: { isComposing: false } });

describe('ERP 품명 입력 마크업', () => {
  it('ARIA combobox 속성과 props를 그대로 렌더하고 닫힌 목록을 연결해 둔다', () => {
    const html = renderToStaticMarkup(<ErpItemNameInput value="000123" onChange={() => {}} ariaLabel="옵션 1 ERP 품명"
      ariaDescribedBy="goods-option-external-identity-guidance" maxLength={200} placeholder="미설정" disabled />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="옵션 1 ERP 품명"');
    expect(html).toContain('aria-describedby="goods-option-external-identity-guidance"');
    expect(html).toMatch(/maxLength="200"|maxlength="200"/);
    expect(html).toContain('placeholder="미설정"');
    expect(html).toContain('value="000123"');
    expect(html).toContain('disabled=""');
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}" role="listbox"`);
    expect(html).toContain('hidden=""');
    expect(html).not.toContain('aria-activedescendant');
  });
});

describe('ERP 품명 입력 상호작용', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.enabled = true;
    hooks.state = [];
    hooks.refs = [];
    hooks.search.mockReset().mockResolvedValue({ ok: true, items });
  });
  afterEach(() => {
    hooks.enabled = false;
    vi.useRealTimers();
  });

  it('입력은 바로 반영하고, 멈춘 뒤 검색한 제안을 열어 키보드로 고른다', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    input(render({ onChange, onSelect })).props.onChange?.({ target: { value: '키링' } });
    expect(onChange).toHaveBeenCalledWith('키링');
    expect(hooks.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(hooks.search).toHaveBeenCalledWith('키링');

    let tree = render({ value: '키링', onChange, onSelect });
    expect(input(tree).props['aria-expanded']).toBe(true);
    expect(options(tree).map((option) => option.key)).toEqual(['K-2', '000123']);

    const down = key('ArrowDown');
    input(tree).props.onKeyDown?.(down);
    expect(down.preventDefault).toHaveBeenCalled();
    tree = render({ value: '키링', onChange, onSelect });
    expect(input(tree).props['aria-activedescendant']).toBe('erp-list-option-0');
    expect(options(tree)[0].props['aria-selected']).toBe(true);

    input(tree).props.onKeyDown?.(key('ArrowUp'));
    tree = render({ value: '키링', onChange, onSelect });
    expect(input(tree).props['aria-activedescendant']).toBe('erp-list-option-1');

    const enter = key('Enter');
    input(tree).props.onKeyDown?.(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('아크릴 키링');
    expect(onSelect).toHaveBeenCalledWith(items[1]);
    tree = render({ value: '아크릴 키링', onChange, onSelect });
    expect(input(tree).props['aria-expanded']).toBe(false);
  });

  it('마우스·터치로 고르면 입력 포커스를 잃지 않고 품목을 넘긴다', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    input(render({ onChange, onSelect })).props.onChange?.({ target: { value: '키링' } });
    await vi.advanceTimersByTimeAsync(250);
    const option = options(render({ value: '키링', onChange, onSelect }))[0];
    const mouseDown = { preventDefault: vi.fn() };
    option.props.onMouseDown?.(mouseDown);
    expect(mouseDown.preventDefault).toHaveBeenCalled();
    option.props.onClick?.();
    expect(onChange).toHaveBeenLastCalledWith('키링 거치대');
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('Esc·포커스 이탈은 목록만 닫고 직접 입력한 값은 그대로 둔다', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    input(render({ onChange, onSelect })).props.onChange?.({ target: { value: '키링' } });
    await vi.advanceTimersByTimeAsync(250);
    const escape = key('Escape');
    input(render({ value: '키링', onChange, onSelect })).props.onKeyDown?.(escape);
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(input(render({ value: '키링', onChange, onSelect })).props['aria-expanded']).toBe(false);

    const enter = key('Enter');
    input(render({ value: '키링', onChange, onSelect })).props.onKeyDown?.(enter);
    expect(enter.preventDefault).not.toHaveBeenCalled();

    input(render({ value: '키링', onChange, onSelect })).props.onChange?.({ target: { value: '키링 직접' } });
    input(render({ value: '키링 직접', onChange, onSelect })).props.onBlur?.();
    await vi.runAllTimersAsync();
    expect(hooks.search).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('키링 직접');
  });

  it('검색이 실패하거나 결과가 없으면 목록을 열지 않는다', async () => {
    hooks.search.mockResolvedValueOnce({ ok: false, error: 'x' }).mockResolvedValueOnce({ ok: true, items: [] });
    input(render()).props.onChange?.({ target: { value: '키링' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(input(render({ value: '키링' })).props['aria-expanded']).toBe(false);
    input(render({ value: '키링' })).props.onChange?.({ target: { value: '키링2' } });
    await vi.advanceTimersByTimeAsync(250);
    const tree = render({ value: '키링2' });
    expect(input(tree).props['aria-expanded']).toBe(false);
    const down = key('ArrowDown');
    input(tree).props.onKeyDown?.(down);
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it('강조한 제안이 있어도 이어서 입력하면 강조를 풀어 Enter가 이전 제안을 고르지 않는다', async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    input(render({ onChange, onSelect })).props.onChange?.({ target: { value: '키링' } });
    await vi.advanceTimersByTimeAsync(250);
    input(render({ value: '키링', onChange, onSelect })).props.onKeyDown?.(key('ArrowDown'));
    expect(input(render({ value: '키링', onChange, onSelect })).props['aria-activedescendant']).toBe('erp-list-option-0');

    /* 새 검색 결과가 오기 전(디바운스 + 서버 왕복)에 Enter를 누른다. */
    input(render({ value: '키링', onChange, onSelect })).props.onChange?.({ target: { value: '키링 세트 B' } });
    const tree = render({ value: '키링 세트 B', onChange, onSelect });
    expect(input(tree).props['aria-activedescendant']).toBeUndefined();
    expect(options(tree).every((option) => option.props['aria-selected'] === false)).toBe(true);
    const enter = key('Enter');
    input(tree).props.onKeyDown?.(enter);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('키링 세트 B');
  });

  it('한글 조합 중 Enter는 제안 선택으로 가로채지 않는다', async () => {
    const onSelect = vi.fn();
    input(render({ onSelect })).props.onChange?.({ target: { value: '키링' } });
    await vi.advanceTimersByTimeAsync(250);
    input(render({ value: '키링', onSelect })).props.onKeyDown?.(key('ArrowDown'));
    const composing = { ...key('Enter'), nativeEvent: { isComposing: true } };
    input(render({ value: '키링', onSelect })).props.onKeyDown?.(composing);
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
