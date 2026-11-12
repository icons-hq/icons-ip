import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 버튼 흐름을 보려고 훅을 대체해 컴포넌트를 함수로 부른다(Checkout.client.test 와 같은 방식). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], si: 0, effects: [] as (() => void | (() => void))[] }));
const actions = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('@/app/cart/actions', () => ({ loadPendingCheckoutOrderAction: actions.load, releaseUnpaidCheckoutOrdersAction: actions.release }));

import { CheckoutPendingOrderRelease } from './CheckoutPendingOrderRelease';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const ORDER = '00000000-0000-4000-8000-0000000000e1';
const onReleased = vi.fn();
const render = () => { hooks.si = 0; hooks.effects = []; return CheckoutPendingOrderRelease({ onReleased }); };
const button = () => all(render()).find((node) => node.type === 'button')!;
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

beforeEach(() => {
  hooks.states = [];
  actions.load.mockReset();
  actions.load.mockResolvedValue({ orderId: ORDER });
  actions.release.mockReset();
  onReleased.mockReset();
});

/* 견적이 결제 대기 주문 때문에 막히면 그 주문을 알리고, 고객이 누를 때만 닫는다(ADR-0030). */
describe('CheckoutPendingOrderRelease', () => {
  it('처음에는 진행 중인 주문 목록과 취소 버튼을 보이고, 원인일 수 있는 결제 대기 주문을 읽어 링크한다', async () => {
    const html = renderToStaticMarkup(<CheckoutPendingOrderRelease onReleased={onReleased} />);
    expect(html).toContain('href="/orders?pending=1"');
    expect(html).toContain('진행 중인 미결제 주문 취소하고 계속');
    render();
    for (const effect of hooks.effects) effect();
    await flush();
    expect(all(render()).some((node) => node.props.href === `/orders/${ORDER}`)).toBe(true);
    /* 화면을 여는 것만으로는 아무것도 닫지 않는다. */
    expect(actions.release).not.toHaveBeenCalled();
  });

  it('누르면 미결제 주문을 닫고 견적을 다시 받게 한다', async () => {
    actions.release.mockResolvedValue({ ok: true, released: 1, confirming: false, pendingOrderId: null });
    await (button().props.onClick as () => Promise<void>)();
    await flush();
    expect(actions.release).toHaveBeenCalledTimes(1);
    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(<>{render()}</>)).toContain('결제하지 않은 주문을 취소했어요');
  });

  it('결제 승인을 확인 중이면 닫지 않았다고 알리고 견적을 다시 받지 않는다', async () => {
    actions.release.mockResolvedValue({ ok: true, released: 0, confirming: true, pendingOrderId: ORDER });
    await (button().props.onClick as () => Promise<void>)();
    await flush();
    expect(onReleased).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<>{render()}</>);
    expect(html).toContain('승인 결과를 확인하고 있어요');
    expect(html).toContain(`href="/orders/${ORDER}"`);
  });

  it('닫을 주문이 없거나 실패하면 사실대로 알린다', async () => {
    actions.release.mockResolvedValueOnce({ ok: true, released: 0, confirming: false, pendingOrderId: ORDER });
    await (button().props.onClick as () => Promise<void>)();
    await flush();
    expect(renderToStaticMarkup(<>{render()}</>)).toContain('취소할 수 있는 미결제 주문이 없어요');
    actions.release.mockResolvedValueOnce({ ok: false });
    await (button().props.onClick as () => Promise<void>)();
    await flush();
    expect(renderToStaticMarkup(<>{render()}</>)).toContain('주문을 취소하지 못했어요');
    expect(onReleased).not.toHaveBeenCalled();
  });
});
