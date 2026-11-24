import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellNoticeBar, ShellNotices as ShellNoticeData } from '@/lib/shell-notices';

/* 렌더러 없이 컴포넌트 함수를 돌린다 — state·ref·effect 를 인덱스 대역으로 바꾼다(Nav.search-toggle.client.test 와 같은 방식).
   서버 렌더 마크업은 ShellNotices.test, 선택 규칙은 lib/shell-notices.test 몫이고 여기서는 클라이언트 렌더 사이의 상태(고정한 공지·활성 신호)를 본다. */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useEffect: () => undefined,
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { ShellNotices } from './ShellNotices';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) => (isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []));

const bar = (id: string, href: string): ShellNoticeBar => ({
  id, key: `${id}:abc123abc123`, message: `공지 ${id}`, cta: { label: '자세히 보기', href },
  pageTypes: ['home', 'collection', 'product', 'content', 'other'], endsAt: null,
});

/* 훅 대역 저장소를 유지한 채 렌더한다 — 렌더 중 상태 보정(setState)은 다음 렌더에 반영되므로 한 번 더 그려 안정시킨다. */
function render(props: { notices: ShellNoticeData; pathname?: string; onActivate?: () => void }) {
  let tree: Element[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    hooks.index = 0;
    tree = nodes(ShellNotices({ pathname: '/', ...props }) as ReactNode);
  }
  return tree;
}
const visibleBars = (tree: Element[]) => tree.filter((node) => node.type === 'aside' && !node.props.hidden).map((node) => node.props['data-notice-id']);

beforeEach(() => {
  hooks.values = [];
  /* 첫 페인트 전 스크립트가 남기는 하드 로드 시드 — 0.7 이면 후보 둘일 때 두 번째를 고른다. 저장소는 비어 있다. */
  vi.stubGlobal('window', { __iconsShellNoticeBarSeed: 0.7, sessionStorage: { getItem: () => null, setItem: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe('롤링 띠배너 — 후보가 늘어도 보이던 공지를 유지한다 (review-b m4)', () => {
  /* a·b 둘 다 일반 목적지다. 후보 목록을 렌더 사이에 바꿔 "처음 고른 공지 고정"만 본다. */
  const one: ShellNoticeData = { bars: [bar('a', '/legal/terms')], strips: [] };
  const both: ShellNoticeData = { bars: [bar('a', '/legal/terms'), bar('b', '/events')], strips: [] };

  it('처음 고른 공지는 후보가 늘어도 바뀌지 않는다', () => {
    expect(visibleBars(render({ notices: one }))).toEqual(['a']);
    /* 고정이 없었다면 시드 0.7 은 후보 [a, b] 의 두 번째(b)를 골라 문구가 바뀌고 노출이 한 번 더 집계된다. */
    expect(visibleBars(render({ notices: both }))).toEqual(['a']);
  });

  it('고른 공지가 후보에서 빠질 때만 다시 고르고, 그 뒤에는 새로 고른 공지를 유지한다', () => {
    expect(visibleBars(render({ notices: both }))).toEqual(['b']);
    expect(visibleBars(render({ notices: one }))).toEqual(['a']);
    expect(visibleBars(render({ notices: both }))).toEqual(['a']);
  });

  it('고정은 화면 유형별이다 — 다른 유형의 첫 화면은 그때의 후보로 새로 고른다', () => {
    expect(visibleBars(render({ notices: one }))).toEqual(['a']);
    expect(visibleBars(render({ notices: both, pathname: '/cart' }))).toEqual(['b']);
    expect(visibleBars(render({ notices: both, pathname: '/' }))).toEqual(['a']);
  });
});

/* review-b M1 (MD-0034) — 검색 패널이 열린 동안 밝게 남는 공지 띠의 링크·닫기를 누르면 패널을 닫는다는 신호를 Nav 로 올린다. */
describe('공지 띠 안의 링크·버튼 클릭 신호', () => {
  const notices: ShellNoticeData = { bars: [bar('a', '/legal/terms')], strips: [] };
  const root = (tree: Element[]) => tree.find((node) => node.props.id === 'wc-shell-notices') as Element;
  const linkTarget = { closest: (selectors: string) => (selectors.includes('button') ? {} : null) };
  const blankTarget = { closest: () => null };

  it('링크·버튼에서 일어난 클릭만 onActivate 로 알린다', () => {
    const onActivate = vi.fn();
    const tree = render({ notices, onActivate });
    const onClick = root(tree).props.onClick as (event: { target: unknown }) => void;

    onClick({ target: blankTarget });
    expect(onActivate).not.toHaveBeenCalled();
    onClick({ target: linkTarget });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('신호를 받지 않는 호출부(미리보기 등)에는 클릭 처리기를 달지 않는다', () => {
    expect(root(render({ notices })).props.onClick).toBeUndefined();
  });
});
