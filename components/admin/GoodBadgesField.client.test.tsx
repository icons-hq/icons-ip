import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 상품 표시문구 여러 개(2026-11-24): 고른 순서가 숨은 칸 'badge'의 순서이고, 바꾸면 편집기가 새 값을 읽도록 input 이벤트를 낸다. */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useId: () => 'badges',
}));

import { GoodBadgesField } from './GoodBadgesField';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

function render(defaultValue: string, error?: string) {
  hooks.index = 0; hooks.refIndex = 0; hooks.effects = [];
  const tree = GoodBadgesField({ defaultValue, error });
  const all = nodes(tree);
  const hidden = all.find(node => node.type === 'input' && node.props.name === 'badge')!;
  const labels = all.filter(node => node.type === 'label');
  const checkbox = (badge: string) => {
    const label = labels.find(node => nodes(node.props.children as ReactNode).some(child => child.type === 'span' && text(child.props.children as ReactNode) === badge))!;
    return nodes(label.props.children as ReactNode).find(child => child.type === 'input')!;
  };
  return { all, hidden, checkbox, hint: text(all.find(node => node.type === 'p' && node.props.id === 'badges-hint')?.props.children as ReactNode) };
}

beforeEach(() => { hooks.states = []; hooks.refs = []; });

describe('GoodBadgesField', () => {
  it('저장된 순서대로 숨은 칸·체크·번호를 그리고, 처음 그릴 때는 input 이벤트를 내지 않는다', () => {
    const view = render('EXCLUSIVE, NEW');
    expect(view.hidden.props.value).toBe('EXCLUSIVE, NEW');
    expect(view.checkbox('NEW').props.checked).toBe(true);
    expect(view.checkbox('EXCLUSIVE').props.checked).toBe(true);
    expect(view.all.filter(node => node.props['data-good-badge-order'] !== undefined).map(node => text(node.props.children as ReactNode))).toEqual(['2번째', '1번째']);
    expect(view.hint).toContain('상품 카드와 상세에 EXCLUSIVE → NEW 순서로 보입니다.');
    const dispatchEvent = vi.fn();
    hooks.refs[0].current = { dispatchEvent };
    hooks.effects.forEach(effect => effect());
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('체크한 순서대로 뒤에 붙이고, 끄면 빼며, 바꿀 때마다 숨은 칸에서 input 이벤트를 낸다', () => {
    const dispatchEvent = vi.fn();
    let view = render('');
    expect(view.hidden.props.value).toBe('');
    expect(view.hint).toContain('고르지 않으면 상품 카드와 상세에 표시문구가 없습니다.');
    (view.checkbox('EXCLUSIVE').props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    (view.checkbox('NEW').props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    view = render('');
    expect(view.hidden.props.value).toBe('EXCLUSIVE, NEW');
    hooks.refs[0].current = { dispatchEvent };
    hooks.effects.forEach(effect => effect());
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as Event;
    expect(event.type).toBe('input');
    expect(event.bubbles).toBe(true);

    (view.checkbox('EXCLUSIVE').props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    view = render('');
    expect(view.hidden.props.value).toBe('NEW');
    (view.checkbox('EXCLUSIVE').props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    expect(render('').hidden.props.value).toBe('NEW, EXCLUSIVE');
  });

  it('오류를 칸 아래에 알리고 설명과 함께 읽히게 한다', () => {
    const view = render('NEW', '상품 표시문구는 NEW, EXCLUSIVE 중에서만 고를 수 있습니다.');
    const fieldset = view.all.find(node => node.type === 'fieldset')!;
    expect(fieldset.props['aria-describedby']).toBe('badges-hint badges-error');
    expect(fieldset.props['aria-invalid']).toBe(true);
    expect(text(view.all.find(node => node.props.role === 'alert')?.props.children as ReactNode)).toContain('NEW, EXCLUSIVE 중에서만');
  });
});
