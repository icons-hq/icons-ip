/* eslint-disable react-hooks/rules-of-hooks -- This test harness owns hook slots and drives one hook root per render. */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ state: [] as unknown[], stateIndex: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
}));

import { AdminPickedBox, useAdminPickedValue } from './AdminPickedValue';

type Fn = (...args: unknown[]) => unknown;
type Props = {
  children?: ReactNode; id?: string; name?: string; type?: string; value?: string; placeholder?: string; readOnly?: boolean; className?: string; ref?: unknown;
  'aria-haspopup'?: string; 'aria-invalid'?: string; 'aria-describedby'?: string; 'data-admin-picked'?: string; 'data-marker'?: string; onClick?: Fn; onKeyDown?: Fn;
};
function all(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(all);
  return isValidElement<Props>(node) ? [node, ...all(node.props.children)] : [];
}

beforeEach(() => { hooks.state = []; hooks.refs = []; hooks.effects = []; hooks.stateIndex = 0; hooks.refIndex = 0; });

describe('선택창에서 고른 값의 상태(useAdminPickedValue)', () => {
  /** 한 번 그리고 그 뒤의 effect까지 돌린다(커밋 뒤). */
  function render(initial = 'first') {
    hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
    const result = useAdminPickedValue(initial);
    for (const effect of hooks.effects) effect();
    return result;
  }

  it('값이 바뀌어 화면에 반영된 뒤에만 숨은 칸에서 input 이벤트를 보낸다', () => {
    const dispatchEvent = vi.fn();
    const first = render();
    first.inputRef.current = { dispatchEvent } as unknown as HTMLInputElement;
    expect(first.value).toBe('first');
    /* 처음 그릴 때와 값이 그대로일 때는 보내지 않는다(편집기가 수정으로 세지 않게). */
    render(); render();
    expect(dispatchEvent).not.toHaveBeenCalled();
    first.setValue('second');
    /* 상태를 바꾼 직후(다시 그리기 전)에는 아직 보내지 않는다 — 숨은 칸 값이 옛 값이다. */
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(render().value).toBe('second');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as Event;
    expect([event.type, event.bubbles]).toEqual(['input', true]);
    render();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('같은 값을 다시 고르면 보내지 않고, 비우는 것도 바뀐 값으로 알린다', () => {
    const dispatchEvent = vi.fn();
    const first = render('ip-a');
    first.inputRef.current = { dispatchEvent } as unknown as HTMLInputElement;
    first.setValue('ip-a'); render('ip-a');
    expect(dispatchEvent).not.toHaveBeenCalled();
    first.setValue(''); render('ip-a');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    first.setValue('ip-a'); render('ip-a');
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('숨은 칸이 아직 없어도 멈추지 않는다', () => {
    const first = render();
    first.setValue('second');
    expect(() => render()).not.toThrow();
  });
});

describe('고른 것을 보이는 상자(AdminPickedBox)', () => {
  const onOpen = vi.fn();
  const inputRef = { current: null };
  const box = (extra: Partial<Parameters<typeof AdminPickedBox>[0]> = {}) => all(AdminPickedBox({
    inputId: 'pick-box', name: 'ipId', value: 'ip-a', inputRef, text: '화산강림', placeholder: '아직 고르지 않았습니다', pickLabel: 'IP 고르기', onOpen, ...extra,
  }));
  const display = (tree: ReactElement<Props>[]) => tree.find((item) => item.type === 'input' && item.props.type === 'text')!;
  const hidden = (tree: ReactElement<Props>[]) => tree.find((item) => item.type === 'input' && item.props.type === 'hidden')!;
  const key = (tree: ReactElement<Props>[], name: string) => { const preventDefault = vi.fn(); display(tree).props.onKeyDown!({ key: name, preventDefault }); return preventDefault; };
  beforeEach(() => onOpen.mockReset());

  it('이름은 읽기 전용 상자에, 값은 숨은 칸에 둔다', () => {
    const tree = box();
    expect(display(tree).props).toMatchObject({ id: 'pick-box', value: '화산강림', placeholder: '아직 고르지 않았습니다', readOnly: true, 'aria-haspopup': 'dialog' });
    expect(display(tree).props.name).toBeUndefined();
    expect(hidden(tree).props).toMatchObject({ name: 'ipId', value: 'ip-a', ref: inputRef });
    /* 숨은 칸에 defaultValue를 쓰면 다시 그릴 때 처음 값으로 돌아간다. */
    expect('defaultValue' in hidden(tree).props).toBe(false);
    expect(tree[0].props['data-admin-picked']).toBe('ipId');
  });

  it('[고르기] 버튼·상자 누르기·Enter·Space·↓가 모두 선택창을 연다', () => {
    const tree = box();
    const button = tree.find((item) => item.type === 'button')!;
    expect(button.props).toMatchObject({ type: 'button', 'aria-haspopup': 'dialog', children: 'IP 고르기' });
    button.props.onClick!(); display(tree).props.onClick!();
    expect(onOpen).toHaveBeenCalledTimes(2);
    for (const name of ['Enter', ' ', 'ArrowDown']) expect(key(tree, name)).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledTimes(5);
    /* 다른 글쇠는 그대로 둔다(Tab으로 다음 칸에 간다). */
    expect(key(tree, 'Tab')).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(5);
  });

  /* 오류 난 칸으로 포커스를 옮기는 쪽은 칸 이름(name)으로 포커스할 곳을 찾는다. 숨은 칸은 포커스를 못 받아 버튼이 같은 이름을 갖는다. */
  it('[고르기] 버튼은 칸 이름을 갖되 제출 값이 되지 않는 type="button"이다', () => {
    const button = box().find((item) => item.type === 'button')!;
    expect(button.props).toMatchObject({ name: 'ipId', type: 'button' });
    expect(button.props.value).toBeUndefined();
  });

  it('잠긴 칸은 점선 상자만 보이고 열 수 없지만 값은 그대로 제출한다', () => {
    const tree = box({ locked: true });
    expect(tree.some((item) => item.type === 'button')).toBe(false);
    expect(display(tree).props.onClick).toBeUndefined();
    expect(display(tree).props['aria-haspopup']).toBeUndefined();
    expect(display(tree).props.className).toContain('border-dashed');
    /* Enter는 잠긴 칸에서도 폼 저장으로 번지지 않게 막는다. */
    expect(key(tree, 'Enter')).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(hidden(tree).props).toMatchObject({ name: 'ipId', value: 'ip-a' });
  });

  it('오류가 있으면 상자가 오류 글을 가리키고, 같은 줄에 더 놓은 동작도 그린다', () => {
    const tree = box({ invalid: true, children: <a data-marker="extra" href="/x">더 보기</a> });
    expect(display(tree).props).toMatchObject({ 'aria-invalid': 'true', 'aria-describedby': 'pick-box-error' });
    expect(tree.some((item) => item.props['data-marker'] === 'extra')).toBe(true);
    expect(display(box()).props['aria-invalid']).toBeUndefined();
    expect(display(box()).props['aria-describedby']).toBeUndefined();
  });
});
