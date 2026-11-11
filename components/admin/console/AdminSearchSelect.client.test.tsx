import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Effect = { deps: unknown[]; cleanup?: void | (() => void) };
const hooks = vi.hoisted(() => ({
  state: [] as unknown[], stateIndex: 0,
  refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as Effect[], effectIndex: 0,
}));
function runEffect(effect: () => void | (() => void), deps: unknown[]) {
  const index = hooks.effectIndex++;
  const previous = hooks.effects[index];
  if (previous && !deps.some((dep, position) => dep !== previous.deps[position])) return;
  previous?.cleanup?.();
  hooks.effects[index] = { deps, cleanup: effect() };
}
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: runEffect,
  useLayoutEffect: runEffect,
}));

import { AdminSearchSelect, AdminSearchSelectPanel, searchSelectFieldMoved } from './AdminSearchSelect';

type Props = { children?: ReactNode; onValueChange?: (value: string) => void; onOpenChange?: (open: boolean) => void; open?: boolean };
function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}
function restart() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0; }
const options = [{ value: 'a', label: '문구 > 키링' }, { value: 'b', label: '문구 > 포토카드' }];
const noop = vi.fn();

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; restart(); });

describe('검색하면 목록이 맨 위로 돌아간다', () => {
  /* 사람 눈 시험(2026-11-10): 강조는 첫 결과로 옮겨 갔는데 스크롤은 그대로라 Enter가 보이지 않는 항목을 골랐다. */
  const render = () => { restart(); return AdminSearchSelectPanel({ label: '분류', onChoose: noop, options, value: 'b' }); };
  const type = (tree: ReactNode, value: string) => all(tree).find((item) => item.props.onValueChange)!.props.onValueChange!(value);
  const list = () => hooks.refs[0] as { current: { scrollTop: number } };

  it('처음 열 때는 고른 값까지 내려간 자리를 건드리지 않는다', () => {
    hooks.refs[0] = { current: { scrollTop: 480 } };
    render();
    expect(list().current.scrollTop).toBe(480);
    render();
    expect(list().current.scrollTop).toBe(480);
  });

  it('검색어가 바뀌면 스크롤을 맨 위로 올리고, 지워도 맨 위로 올린다', () => {
    hooks.refs[0] = { current: { scrollTop: 480 } };
    type(render(), '키링');
    render();
    expect(list().current.scrollTop).toBe(0);
    list().current.scrollTop = 120;
    type(render(), '');
    render();
    expect(list().current.scrollTop).toBe(0);
  });
});

describe('모달 dialog 안에서는 검색칸이 먼저 포커스를 받는다', () => {
  /* 2차 사람 눈 시험(2026-11-10): 등록 창을 열면 커서가 X 버튼에 있어 바로 입력이 안 됐다. 네이티브 dialog는 autofocus 속성을 따른다. */
  type InputProps = Props & { ref?: (node: { setAttribute: (name: string, value: string) => void } | null) => void };
  const searchInput = (dialogAutoFocus?: boolean) => {
    restart();
    return all(AdminSearchSelectPanel({ dialogAutoFocus, label: '분류', onChoose: noop, options, value: '' })).find((item) => item.props.onValueChange) as ReactElement<InputProps>;
  };

  it('dialogAutoFocus면 검색칸에 autofocus 속성을 단다', () => {
    const setAttribute = vi.fn();
    searchInput(true).props.ref!({ setAttribute });
    expect(setAttribute).toHaveBeenCalledExactlyOnceWith('autofocus', '');
    expect(() => searchInput(true).props.ref!(null)).not.toThrow();
  });

  it('팝업으로 쓸 때는 속성을 달지 않는다', () => {
    expect(searchInput().props.ref).toBeUndefined();
  });
});

describe('연 채로 칸이 밀리면 닫는다', () => {
  /* 사람 눈 시험(2026-11-10): 연 채로 표를 스크롤하면 팝오버가 표 밖에 떠다니고, 고르면 보이지 않는 행에 값이 들어갔다. */
  const listeners = new Set<() => void>();
  const rect = { top: 100, left: 40 };
  const field = { getBoundingClientRect: () => ({ ...rect }) } as unknown as Node;
  const scroll = () => { for (const listener of [...listeners]) listener(); };
  const render = () => { restart(); return AdminSearchSelect({ 'aria-label': '분류', onValueChange: noop, options, value: 'a' }); };
  const open = (tree: ReactNode) => all(tree).find((item) => item.props.onOpenChange)!.props.onOpenChange!(true);
  const isOpen = () => hooks.state[0] as boolean;
  const addEventListener = vi.fn((_: string, listener: () => void) => { listeners.add(listener); });
  const removeEventListener = vi.fn((_: string, listener: () => void) => { listeners.delete(listener); });

  beforeEach(() => {
    listeners.clear(); addEventListener.mockClear(); removeEventListener.mockClear();
    rect.top = 100; rect.left = 40;
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    hooks.refs[0] = { current: field };
  });

  it('닫혀 있으면 스크롤을 듣지 않는다', () => {
    render();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('칸이 움직이면 닫고 리스너를 뗀다', () => {
    open(render());
    render();
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true, passive: true });
    rect.top = 60;
    scroll();
    expect(isOpen()).toBe(false);
    render();
    expect(listeners.size).toBe(0);
  });

  it('표를 옆으로 밀어도 닫는다', () => {
    open(render());
    render();
    rect.left = 10;
    scroll();
    expect(isOpen()).toBe(false);
  });

  it('칸이 그대로면(팝업 안 목록 스크롤, 연 직전 스크롤의 늦은 이벤트) 닫히지 않는다', () => {
    open(render());
    render();
    scroll();
    expect(isOpen()).toBe(true);
  });

  it('판정: 1px 미만의 흔들림은 움직인 것이 아니다', () => {
    const at = { top: 100, left: 40 };
    expect(searchSelectFieldMoved(at, { top: 100.5, left: 40.5 })).toBe(false);
    expect(searchSelectFieldMoved(at, { top: 101, left: 40 })).toBe(true);
    expect(searchSelectFieldMoved(at, { top: 100, left: 39 })).toBe(true);
  });
});
