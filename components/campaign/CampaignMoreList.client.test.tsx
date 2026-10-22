import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 더보기의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부르고 effect 를
   손으로 돌린다(선례: components/home/HomeAnnouncementPopup.client.test.tsx). */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => (() => void) | void)[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
      };
      return [hooks.states[index], set];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useEffect: (effect: () => (() => void) | void) => {
      hooks.effects.push(effect);
    },
  };
});

import { ViewMore } from '@/components/wc/ViewMore';
import { CampaignMoreList } from './CampaignMoreList';

/* useRef 호출 순서: listRef → focusFrom */
const LIST = 0;

const focused: number[] = [];
const fakeList = {
  children: Array.from({ length: 30 }, (_, index) => ({
    querySelector: () => ({ focus: () => focused.push(index) }),
  })),
};

function items(count: number) {
  return Array.from({ length: count }, (_, index) => <li key={`c-${index}`}><a href={`/events/c-${index}`}>{index}</a></li>);
}

function render(count: number) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  const tree = CampaignMoreList({ className: 'grid', items: items(count) });
  hooks.refs[LIST]!.current = fakeList;
  hooks.effects.forEach((effect) => effect());
  return tree;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function shownCount(tree: ReactNode) {
  const list = elements(tree).find((element) => element.type === 'ul');
  return (list?.props.children as unknown[]).length;
}

function moreButton(tree: ReactNode) {
  return elements(tree).find((element) => element.type === ViewMore);
}

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  focused.length = 0;
});

describe('CampaignMoreList 더보기 (11 §6 B21)', () => {
  it('누를 때마다 10건씩 이어 붙이고 라벨의 보이는 건수를 올린다', () => {
    let tree = render(23);
    expect(shownCount(tree)).toBe(10);
    expect(moreButton(tree)?.props.label).toBe('더보기 (10/23)');

    (moreButton(tree)!.props.onClick as () => void)();
    tree = render(23);
    expect(shownCount(tree)).toBe(20);
    expect(moreButton(tree)?.props.label).toBe('더보기 (20/23)');

    (moreButton(tree)!.props.onClick as () => void)();
    tree = render(23);
    expect(shownCount(tree)).toBe(23);
    expect(moreButton(tree)).toBeUndefined();
  });

  /* 버튼에 포커스를 남기면 새 카드가 위에 붙은 줄 모르고, 마지막 묶음에서는 버튼이 사라져 포커스가 튄다. */
  it('새로 붙은 첫 카드로 포커스를 옮긴다', () => {
    let tree = render(23);
    expect(focused).toEqual([]);

    (moreButton(tree)!.props.onClick as () => void)();
    tree = render(23);
    expect(focused).toEqual([10]);

    (moreButton(tree)!.props.onClick as () => void)();
    render(23);
    expect(focused).toEqual([10, 20]);
  });

  it('처음 그릴 때는 포커스를 건드리지 않는다', () => {
    render(23);
    render(23);

    expect(focused).toEqual([]);
  });
});
