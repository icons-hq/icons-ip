import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/* jsdom 없이 훅을 흉내 내 탭 전환을 돌린다(CategoryDisplayTree.client.test 와 같은 방식). 리뷰 l5-ui-1 — 카테고리 시트 탭은
 * 고른 패널만 DOM 에 둔다. 탭을 바꾸면 다른 패널이 그 자리에 서고, 로빙 탭인덱스·화살표 키는 공용 TabPanels 와 같다. */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
}));
import { CategorySheetTabs, type CategorySheetTab } from './CategorySheetTabs';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) => (isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((value) => (isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value))).join('');

const tabs: CategorySheetTab[] = [
  { id: 'categories', label: '카테고리', content: <span data-href="/shop?displayCategory=x">피규어</span> },
  { id: 'ips', label: '온라인 팝업', content: <span data-href="/ip/maple">MapleStory</span> },
];
const focused: string[] = [];

function render() {
  hooks.index = 0;
  const tree = nodes(CategorySheetTabs({ tabs }));
  /* ref 콜백을 붙여 포커스 이동을 기록한다. */
  for (const tab of tree.filter((node) => node.props.role === 'tab')) {
    (tab.props.ref as (node: unknown) => void)({ focus: () => focused.push(String(tab.props.id)) });
  }
  return tree;
}
const tab = (label: string) => render().find((node) => node.props.role === 'tab' && text(node) === label)!;
const panels = () => render().filter((node) => node.props.role === 'tabpanel');
function key(label: string, value: string) {
  const event = { key: value, preventDefault: vi.fn() };
  (tab(label).props.onKeyDown as (event: unknown) => void)(event);
  return event;
}

beforeEach(() => {
  hooks.values = [];
  focused.length = 0;
});

it('처음에는 카테고리 패널 하나만 있고, 온라인 팝업 패널과 그 링크는 DOM 에 없다', () => {
  expect(panels()).toHaveLength(1);
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-categories');
  expect(panels()[0].props.hidden).toBeUndefined();
  expect(render().some((node) => node.props['data-href'] === '/ip/maple')).toBe(false);
  expect(tab('카테고리').props).toMatchObject({ 'aria-selected': true, tabIndex: 0, 'aria-controls': 'wc-catsheet-panel-categories' });
  expect(tab('온라인 팝업').props).toMatchObject({ 'aria-selected': false, tabIndex: -1, 'aria-controls': undefined });
});

it('탭을 누르면 그 패널로 바뀌고 이전 패널은 DOM 에서 빠진다', () => {
  (tab('온라인 팝업').props.onClick as () => void)();
  expect(panels().map((panel) => panel.props.id)).toEqual(['wc-catsheet-panel-ips']);
  expect(panels()[0].props['aria-labelledby']).toBe('wc-catsheet-tab-ips');
  expect(render().some((node) => node.props['data-href'] === '/shop?displayCategory=x')).toBe(false);
  expect(tab('온라인 팝업').props).toMatchObject({ 'aria-selected': true, tabIndex: 0 });
  expect(tab('카테고리').props.tabIndex).toBe(-1);
});

it('←/→/Home/End 는 탭을 옮기며 포커스도 함께 옮기고, 다른 키는 건드리지 않는다', () => {
  expect(key('카테고리', 'ArrowRight').preventDefault).toHaveBeenCalled();
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-ips');
  expect(focused.at(-1)).toBe('wc-catsheet-tab-ips');
  key('온라인 팝업', 'ArrowRight');
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-categories');
  key('카테고리', 'End');
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-ips');
  key('온라인 팝업', 'Home');
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-categories');
  key('카테고리', 'ArrowLeft');
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-ips');
  expect(key('온라인 팝업', 'Tab').preventDefault).not.toHaveBeenCalled();
  expect(panels()[0].props.id).toBe('wc-catsheet-panel-ips');
});
