import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, publish: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useTransition: () => [false, (job: () => unknown) => { void job(); }],
}));
vi.mock('@/app/admin/goods-publish-actions', () => ({ setAdminGoodPublishedAction: hooks.publish }));

import { AlertDialogAction } from '@/components/admin/kit/ui/alert-dialog';
import { Button } from '@/components/admin/kit/ui/button';
import { GoodDraftSwitch } from './GoodPublishControls';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const render = (props: Parameters<typeof GoodDraftSwitch>[0]) => { hooks.index = 0; return nodes(GoodDraftSwitch(props)); };

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.publish.mockReset(); hooks.publish.mockResolvedValue({}); });

/* 스펙 C §2.9 — 카테고리 오류 아래의 버튼은 같은 부품에 이름만 바꾼 것이다. 잠금 안내의 버튼은 기본 이름을 그대로 쓴다. */
it('버튼 이름은 기본이 초안으로 전환 후 수정이고, 카테고리 변경 자리에서는 label 로 바꾼다', () => {
  expect(text(render({ id: 'g1' }).find(node => node.type === Button)!.props.children as ReactNode)).toBe('초안으로 전환 후 수정');
  expect(text(render({ id: 'g1', label: '초안으로 전환하고 카테고리 바꾸기' }).find(node => node.type === Button)!.props.children as ReactNode)).toBe('초안으로 전환하고 카테고리 바꾸기');
});

it('이름이 달라도 확인창을 거쳐 같은 서버 계약(초안 전환 + 영향 확인)으로 전환한다', async () => {
  /* 버튼을 누르면 확인창이 열린다. */
  (render({ id: 'g1', label: '초안으로 전환하고 카테고리 바꾸기' }).find(node => node.type === Button)!.props.onClick as () => void)();
  expect(hooks.states[0]).toBe(true);
  expect(hooks.publish).not.toHaveBeenCalled();

  /* 확인창의 '초안으로 전환'이 기존 핸들러를 부른다. */
  await (render({ id: 'g1', label: '초안으로 전환하고 카테고리 바꾸기' }).find(node => node.type === AlertDialogAction)!.props.onClick as () => Promise<void> | void)();
  expect(hooks.publish).toHaveBeenCalledOnce();
  const [, data] = hooks.publish.mock.calls[0] as [unknown, FormData];
  expect(Object.fromEntries(data.entries())).toEqual({ id: 'g1', published: 'false', confirmUnpublish: 'yes' });
});
