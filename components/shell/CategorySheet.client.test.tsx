import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/* jsdom 없이 훅을 흉내 내 스크롤 상태를 돌린다(CategorySheetTabs.client.test 와 같은 방식). QA l5-qa-5 — 닫기 버튼은 시트 기준으로
 * 떠 있고 스크롤은 안쪽 상자가 해서, 내리면 기획전 이미지·제목이 투명한 X 아래로 지나갔다. 안쪽 상자가 맨 위에서 벗어난 동안에만
 * 대화상자에 data-scrolled 를 달아 머리줄 배경(wc-chrome.css .wc-catsheet::before)을 켠다. */
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
vi.mock('./useOverlayA11y', () => ({ useOverlayA11y: vi.fn() }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
import { CategorySheet } from './CategorySheet';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) => (isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []));

function render() {
  hooks.index = 0;
  return nodes(CategorySheet({
    campaigns: [{ id: 'c1', title: '가을 기획전', imageUrl: null }],
    featuredIps: [],
    nodes: [{ id: '94932000-0000-4000-8000-000000000002', parentId: null, name: '피규어', depth: 1, imageUrl: null, navigable: true }],
    onClose: vi.fn(),
    shortcuts: [{ id: 'new', label: 'NEW' }],
  }));
}
const dialog = () => render().find((node) => node.props.role === 'dialog')!;
function scrollInnerTo(scrollTop: number) {
  const inner = render().find((node) => node.props.className === 'wc-sheet__inner')!;
  (inner.props.onScroll as (event: { currentTarget: { scrollTop: number } }) => void)({ currentTarget: { scrollTop } });
}

beforeEach(() => {
  hooks.values = [];
});

it('안쪽 상자가 맨 위에서 벗어난 동안에만 대화상자가 data-scrolled 를 단다', () => {
  expect(dialog().props['data-scrolled']).toBeUndefined();

  scrollInnerTo(1);
  expect(dialog().props['data-scrolled']).toBe('true');
  scrollInnerTo(420);
  expect(dialog().props['data-scrolled']).toBe('true');

  /* 맨 위로 돌아오면 머리줄은 다시 투명하다 — 첫 섹션 제목 자리가 레퍼런스와 같다. */
  scrollInnerTo(0);
  expect(dialog().props['data-scrolled']).toBeUndefined();
});
