import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * [저장하고 적용] 직후 화면이 시계를 어떻게 당기는지. 화면은 운영자 PC 시계로 '적용 중'·'예정'을 가리는데, '저장하면 바로'로 적용한 설정의 시작 시각은
 * 서버(DB) 시계가 정한다. PC 시계가 느리면 방금 적용한 설정이 '예정'으로, 출고지가 '새 주문이 막혀 있습니다'로 보이던 것을 막는다.
 * 훅은 순서대로 모의하고(함수형 갱신 포함) 화면을 함수로 불러 요소 트리를 읽는다.
 */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? (value as (current: unknown) => unknown)(hooks.values[index]) : value; }];
  },
}));
vi.mock('../useAdminLeaveGuard', () => ({ useAdminLeaveGuard: () => ({ formRef: undefined, dirty: false }) }));
vi.mock('@/app/admin/shipping-region-actions', () => ({ saveShippingRegionPolicyAction: vi.fn(), applyShippingRegionPolicyAction: vi.fn(), endShippingRegionPolicyAction: vi.fn(), changeShippingRegionFeesAction: vi.fn() }));
import { ShippingRegionEditor, ShippingRegionsScreen } from './ShippingRegionsScreen';
import { Button } from '../kit/ui/button';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap((value) =>
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map((value) =>
  isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');

const PC = Date.parse('2026-11-26T03:00:00Z');
const SERVER_START = '2026-11-26T03:01:30Z';
const origin = { id: '00000000-0000-4000-8000-000000000001', code: 'fixture', name: '합성 출고지', defaultCarrier: 'hanjin',
  baseFee: 3000, freeThreshold: null, returnAddress: '', cutoff: null, exportTemplate: 'standard' as const, active: true, updatedAt: '2026-09-10T00:00:00Z' };
const carriers = [{ code: 'hanjin', label: '한진', active: true }] as never;
const rule = { id: null, postalFrom: '10000', postalTo: '10000', addressPrefix: '', regionLabel: '합성 제주', disposition: 'surcharge', amount: 3000 };
const policy = (id: string, patch: Record<string, unknown> = {}) => ({ id, originId: origin.id, carrierCode: 'hanjin', name: `합성 ${id}`, version: 1, revision: 1, status: 'active',
  startsAt: '2026-09-10T00:00:00Z', endsAt: null, rules: [rule], ...patch }) as never;

const props = () => ({ policies: [policy('old')], adoptions: [{ originId: origin.id, managedFrom: '2026-09-10T00:00:00Z' }] as never, origins: [origin], carriers, canEdit: true, now: new Date(PC) });
const render = () => { hooks.index = 0; return nodes(ShippingRegionsScreen(props())); };
const noticeTitles = () => render().map((node) => node.props.title).filter((title) => typeof title === 'string');
const onApplied = () => render().find((node) => node.type === ShippingRegionEditor)!.props.onApplied as (policy: unknown, replaced: unknown[], message: string, startedNow: boolean) => void;

/** 적용 중인 설정이 하나 있는 출고지에서 [새로 만들기]를 눌러 입력칸을 연다. */
async function openEditor() {
  const open = render().find((node) => node.type === Button && text(node.props.children as ReactNode) === '새로 만들기')!;
  await (open.props.onClick as () => Promise<void>)();
}

beforeEach(() => {
  hooks.values = []; hooks.index = 0;
  vi.useFakeTimers(); vi.setSystemTime(PC);
  vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('적용 직후 화면 시계', () => {
  it('적용 중인 설정을 바꿔 적용한 직후: 처음에는 적용 중이다', async () => {
    expect(text(render())).toContain('적용 중');
    expect(noticeTitles()).not.toContain('새 주문이 막혀 있는 출고지가 있습니다');
    await openEditor();
    expect(render().some((node) => node.type === ShippingRegionEditor)).toBe(true);
  });

  it('저장하면 바로: PC 시계가 서버보다 90초 느려도 방금 적용한 설정은 적용 중이고 새 주문이 막혀 있다고 하지 않는다', async () => {
    await openEditor();
    const next = policy('new', { startsAt: SERVER_START, name: '합성 새 설정' });
    onApplied()(next, [policy('old', { status: 'retired', revision: 2 })], '적용했습니다.', true);
    const shown = text(render());
    expect(shown).toContain('합성 출고지 · 합성 새 설정');
    /* 목록의 새 설정은 '적용 중'이고 '예정'이 아니다. 이전 설정은 끝냄이다. */
    expect(shown).toContain('적용 중');
    expect(shown).not.toContain('예정');
    expect(shown).not.toContain('적용 중인 설정 없음');
    expect(shown).not.toContain('새 주문이 막혀 있습니다');
    expect(noticeTitles()).not.toContain('새 주문이 막혀 있는 출고지가 있습니다');
    expect(shown).toContain('적용했습니다.');
  });

  it('날짜를 정해 적용한 설정은 시계를 당기지 않아 예정으로 남는다', async () => {
    await openEditor();
    const later = '2026-11-26T03:30:00Z';
    onApplied()(policy('new', { startsAt: later, name: '합성 예약 설정' }), [], '저장했습니다.', false);
    const shown = text(render());
    expect(shown).toContain('합성 출고지 · 합성 예약 설정');
    expect(shown).toContain('예정');
  });
});
