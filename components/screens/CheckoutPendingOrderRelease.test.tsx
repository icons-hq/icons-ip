import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutPendingOrderReleaseProps } from './CheckoutPendingOrderRelease';

/* 버튼 흐름을 보려고 훅을 대체해 컴포넌트를 함수로 부른다(Checkout.client.test 와 같은 방식). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], si: 0, refs: [] as { current: unknown }[], ri: 0, effects: [] as (() => void | (() => void))[] }));
const actions = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => { const i = hooks.ri++; hooks.refs[i] ??= { current: initial }; return hooks.refs[i]; },
  useId: () => 'pending-release',
}));
vi.mock('@/app/cart/actions', () => ({ loadUnpaidCheckoutOrdersAction: actions.load, releaseUnpaidCheckoutOrdersAction: actions.release }));

import { CheckoutPendingOrderRelease } from './CheckoutPendingOrderRelease';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const ORDER = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const VARIANT = '00000000-0000-4000-8000-0000000000aa';
const unpaid = { id: ORDER, orderNumber: '2026111210000001', total: 23000, itemName: '굿즈 A', itemCount: 3, goodIds: ['g1', 'g9'], variantIds: [VARIANT],
  userCouponIds: [], releasable: true };
const onReleased = vi.fn();
let props: Omit<CheckoutPendingOrderReleaseProps, 'onReleased'> = { causes: { limitGoodIds: ['g1'] } };
const render = () => { hooks.si = 0; hooks.ri = 0; hooks.effects = []; return CheckoutPendingOrderRelease({ onReleased, ...props }); };
const html = () => renderToStaticMarkup(<>{render()}</>);
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const load = async () => { render(); for (const effect of hooks.effects) effect(); await flush(); };
const button = (label: string) => all(render()).find((node) => node.type === 'button' && Children.toArray(node.props.children as ReactNode).join('').includes(label))!;
const click = async (label: string) => { await (button(label).props.onClick as () => unknown)(); await flush(); };

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  props = { causes: { limitGoodIds: ['g1'] } };
  actions.load.mockReset();
  actions.load.mockResolvedValue({ ok: true, orders: [unpaid] });
  actions.release.mockReset();
  onReleased.mockReset();
});

/* 견적이 결제 대기 주문 때문에 막혔을 수 있으면 그 주문을 실제로 찾았을 때만 알리고, 확인 단계를 거쳐 확인한 주문만 닫는다(ADR-0030). */
describe('CheckoutPendingOrderRelease', () => {
  it('결제 대기 주문을 찾기 전이나 못 찾으면 아무것도 그리지 않는다 — 화면은 사유만 보인다', async () => {
    expect(html()).toBe('');
    actions.load.mockResolvedValue({ ok: true, orders: [] });
    await load();
    expect(html()).toBe('');
    actions.load.mockResolvedValue({ ok: false });
    hooks.states = [];
    await load();
    expect(html()).toBe('');
    /* 막힘이 없으면 읽지도 않는다. */
    hooks.states = [];
    actions.load.mockClear();
    props = { causes: {} };
    await load();
    expect(actions.load).not.toHaveBeenCalled();
    expect(actions.release).not.toHaveBeenCalled();
  });

  it('찾으면 결제 대기 주문 건수와 실제 버튼·밑줄 링크를 경고 글과 나눈 상자에 보인다', async () => {
    await load();
    const markup = html();
    expect(markup).toContain('<div class="checkout-pending-release">');
    expect(markup).toContain('결제 대기 주문 1건이 이 굿즈의 구매 한도를 잡고 있어요.');
    expect(markup).toContain(`<a class="checkout-pending-release__link" href="/orders/${ORDER}">결제 대기 주문 보기</a>`);
    expect(markup).toContain('<button class="wc-btn" type="button">결제 대기 주문 취소하고 계속</button>');
    /* 화면을 여는 것만으로는 아무것도 닫지 않는다. */
    expect(actions.release).not.toHaveBeenCalled();
  });

  it('누르면 취소될 주문(주문번호·굿즈·금액)과 청구·결제창 안내를 보이는 확인 단계를 열고, 아직 닫지 않는다', async () => {
    await load();
    await click('결제 대기 주문 취소하고 계속');
    const markup = html();
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('결제하지 않은 주문 1건을 취소할까요?');
    expect(markup).toContain('청구된 금액은 없고, 다른 창에서 진행 중인 결제는 끝나요.');
    expect(markup).toContain('주문번호 2026111210000001');
    expect(markup).toContain('굿즈 A 외 2건');
    expect(markup).toContain('₩23,000');
    expect(actions.release).not.toHaveBeenCalled();
    /* 돌아가기는 확인 단계만 닫는다. */
    await click('돌아가기');
    expect(html()).not.toContain('role="alertdialog"');
    expect(actions.release).not.toHaveBeenCalled();
  });

  /* 전체 비우기 확인과 같게 Esc로 닫는다 — 아무것도 닫지 않고 연 버튼으로 포커스를 돌려준다(포커스 효과). */
  it('확인 단계는 Esc로 닫힌다', async () => {
    await load();
    await click('결제 대기 주문 취소하고 계속');
    const dialog = all(render()).find((node) => node.props.role === 'alertdialog')!;
    const stopPropagation = vi.fn();
    (dialog.props.onKeyDown as (event: { key: string; stopPropagation(): void }) => void)({ key: 'Escape', stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(html()).not.toContain('role="alertdialog"');
    expect(html()).toContain('결제 대기 주문 취소하고 계속');
    expect(actions.release).not.toHaveBeenCalled();
  });

  it('확인하면 본 주문만 닫고 견적을 다시 받게 한다', async () => {
    actions.release.mockResolvedValue({ ok: true, released: 1, confirming: false });
    await load();
    await click('결제 대기 주문 취소하고 계속');
    actions.load.mockResolvedValue({ ok: true, orders: [] });
    await click('1건 취소하고 계속');
    expect(actions.release).toHaveBeenCalledWith([ORDER]);
    expect(onReleased).toHaveBeenCalledTimes(1);
    await load();
    expect(html()).toContain('결제 대기 주문을 취소했어요');
  });

  it('결제 승인을 확인 중이면 닫지 않았다고 알리고 견적을 다시 받지 않는다', async () => {
    actions.release.mockResolvedValue({ ok: true, released: 0, confirming: true });
    await load();
    await click('결제 대기 주문 취소하고 계속');
    await click('1건 취소하고 계속');
    expect(onReleased).not.toHaveBeenCalled();
    expect(html()).toContain('결제 결과를 확인하고 있는 주문은 취소하지 않았어요');
  });

  it('실패하면 사실대로 알린다', async () => {
    actions.release.mockResolvedValue({ ok: false });
    await load();
    await click('결제 대기 주문 취소하고 계속');
    await click('1건 취소하고 계속');
    expect(onReleased).not.toHaveBeenCalled();
    expect(html()).toContain('주문을 취소하지 못했어요');
  });

  it('재고 부족은 그 굿즈를 담은 결제 대기 주문만 원인으로 알린다', async () => {
    props = { causes: { stockGoodIds: ['g5'] } };
    await load();
    expect(html()).toBe('');
    hooks.states = [];
    props = { causes: { stockGoodIds: ['g9'] } };
    await load();
    expect(html()).toContain('결제 대기 주문 1건이 이 굿즈의 재고를 잡고 있어요.');
  });

  /* t12b(UI 재리뷰): g4의 회원 누적 한도로 막혔는데 g4와 무관한 g7 결제 대기 주문의 취소를 권했다(취소해도 g4는 그대로 막힌다). */
  it('회원 누적 한도로 막힌 굿즈를 담지 않은 결제 대기 주문은 권하지 않는다 — 사유만 남는다', async () => {
    actions.load.mockResolvedValue({ ok: true, orders: [{ ...unpaid, goodIds: ['g7'], variantIds: [] }] });
    props = { causes: { limitGoodIds: ['g4'] } };
    await load();
    expect(html()).toBe('');
    expect(actions.release).not.toHaveBeenCalled();
  });

  it('쿠폰 사용 처리는 그 쿠폰을 쓴 결제 대기 주문만, 첫구매 예약은 모든 결제 대기 주문을 원인으로 본다', async () => {
    const coupon = '00000000-0000-4000-8000-0000000000c1';
    actions.load.mockResolvedValue({ ok: true, orders: [{ ...unpaid, userCouponIds: [] }] });
    props = { causes: { userCouponIds: [coupon] } };
    await load();
    expect(html()).toBe('');
    hooks.states = [];
    actions.load.mockResolvedValue({ ok: true, orders: [{ ...unpaid, userCouponIds: [coupon] }] });
    await load();
    expect(html()).toContain('결제 대기 주문 1건이 이 쿠폰을 쓰고 있어요.');
    hooks.states = [];
    actions.load.mockResolvedValue({ ok: true, orders: [{ ...unpaid, userCouponIds: [] }] });
    props = { causes: { firstPurchase: true } };
    await load();
    expect(html()).toContain('결제 대기 주문 1건이 첫구매 혜택을 잡고 있을 수 있어요.');
  });

  it('결제를 확인하는 주문만 있으면 취소 버튼 없이 그 주문으로 잇는다', async () => {
    actions.load.mockResolvedValue({ ok: true, orders: [{ ...unpaid, id: OTHER, releasable: false }] });
    await load();
    const markup = html();
    expect(markup).toContain('결제 결과를 확인하고 있는 주문이 있어요');
    expect(markup).toContain(`href="/orders/${OTHER}"`);
    expect(markup).not.toContain('취소하고 계속');
  });
});
