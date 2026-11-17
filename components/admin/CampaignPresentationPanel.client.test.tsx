import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminCampaignRecord } from '@/lib/admin/campaigns';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, ids: 0, action: {} as Record<string, unknown> }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useId: () => `id${hooks.ids++}`,
  useActionState: () => [hooks.action, vi.fn(), false],
}));
vi.mock('@/app/admin/campaign-presentation-actions', () => ({ saveAdminCampaignPresentationAction: vi.fn() }));

import { CampaignPresentationPanel } from './CampaignPresentationPanel';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const campaign: AdminCampaignRecord = {
  id: 'autumn-popup', kind: 'event', title: '가을 팝업', subtitle: null, status: 'published',
  startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-30T00:00:00.000Z',
  heroImagePath: null, cardImagePath: null, bannerImagePath: null, featuredOrder: null, sections: [],
  presentation: { popupMode: null, popupLocation: null, cardLinkPath: null }, updatedAt: '2026-11-01T00:00:00.000Z',
};

/** 패널 바깥 컴포넌트가 그리는 안쪽 폼(PresentationForm)을 한 번 더 펼쳐 칸 요소를 모은다. */
function render() {
  hooks.index = 0; hooks.ids = 0;
  const outer = nodes(CampaignPresentationPanel({ campaign }));
  const inner = outer.find(node => typeof node.type === 'function' && node.type.name === 'PresentationForm')!;
  return nodes((inner.type as (props: typeof inner.props) => ReactNode)(inner.props));
}
const named = (tree: Element[], name: string) => tree.find(node => node.props.name === name)!;
const change = (name: string, value: string) => (named(render(), name).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });

beforeEach(() => { hooks.states = []; hooks.index = 0; hooks.ids = 0; hooks.action = {}; });

it('POP-UP 에 싣기를 고르면 장소가 열리고, 싣지 않음으로 돌리면 닫히며 비어 보인다', () => {
  expect(named(render(), 'popupLocation').props).toMatchObject({ disabled: true, value: '' });

  change('popupMode', 'offline');
  expect(named(render(), 'popupLocation').props).toMatchObject({ disabled: false, value: '' });

  change('popupLocation', '서울 마포구 월드컵로8길 69 1층');
  expect(named(render(), 'popupLocation').props).toMatchObject({ disabled: false, value: '서울 마포구 월드컵로8길 69 1층' });

  change('popupMode', '');
  expect(named(render(), 'popupLocation').props).toMatchObject({ disabled: true, value: '' });

  /* 다시 싣기로 돌리면 적어 둔 장소가 돌아온다 — 실수로 방식을 건드려도 입력이 사라지지 않는다. */
  change('popupMode', 'hybrid');
  expect(named(render(), 'popupLocation').props).toMatchObject({ disabled: false, value: '서울 마포구 월드컵로8길 69 1층' });
});

/* React 폼 액션은 끝나면 비제어 칸을 저장값으로 되돌린다. 제어 칸이라 검증 오류로 돌아와도 고친 입력이 남는다. */
it('세 칸은 제어 입력이라 고친 값을 폼 액션이 끝나도 지킨다', () => {
  change('popupMode', 'online');
  change('cardLinkPath', '//evil.com');

  const tree = render();
  expect(named(tree, 'popupMode').props.value).toBe('online');
  expect(named(tree, 'cardLinkPath').props.value).toBe('//evil.com');
  expect(named(tree, 'popupLocation').props.defaultValue).toBeUndefined();
});

it('저장 뒤 칸을 다시 고치면 지난 저장의 성공 문구를 감춘다', () => {
  hooks.action = { message: '노출 설정을 저장했습니다.' };
  const shown = (tree: Element[]) => tree.some(node => typeof node.type === 'function' && node.type.name === 'InlineNotice'
    && (node.props.state as { message?: string }).message === '노출 설정을 저장했습니다.');
  expect(shown(render())).toBe(true);

  (render().find(node => node.type === 'form')!.props.onChange as () => void)();
  expect(shown(render())).toBe(false);
});
