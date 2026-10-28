import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';

/* 정적 마크업(실제 React)과, 적용 흐름을 위한 훅 대체 렌더(CheckoutAddressBook.test 와 같은 방식)를 함께 쓴다. */
const hooks = vi.hoisted(() => ({ fake: false, states: [] as unknown[], index: 0, pending: [] as Promise<unknown>[] }));
const mocks = vi.hoisted(() => ({ apply: vi.fn(), applyCode: vi.fn(), clear: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!hooks.fake) return actual.useState(initial);
      const i = hooks.index++;
      if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }];
    },
    useTransition: () => {
      if (!hooks.fake) return actual.useTransition();
      return [false, (callback: () => Promise<unknown> | unknown) => { const result = callback(); if (result instanceof Promise) hooks.pending.push(result); }];
    },
  };
});
vi.mock('@/app/cart/coupon-actions', () => ({ applyCouponAction: mocks.apply, applyCouponCodeAction: mocks.applyCode, clearCouponAction: mocks.clear }));

import { CouponPicker, type CouponPickerProps } from './CouponPicker';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));
const text = (node: ReactNode): string => Children.toArray(node).map((child) => (isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child))).join('');

const fix5k: UserCouponSummary = {
  id: '11111111-1111-4111-8111-111111111111', status: 'active', issuedAt: '2026-08-30T00:00:00Z', expiresAt: null, usedAt: null,
  coupon: { code: 'CPNFIX5K', name: '5천원 할인', discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null, minSubtotal: 20000, endsAt: null, gradeBenefit: null },
};
const shipFree: UserCouponSummary = {
  ...fix5k, id: '22222222-2222-4222-8222-222222222222',
  coupon: { ...fix5k.coupon, code: 'SHIPFREE', name: '배송비 무료', benefitKind: 'shipping', minSubtotal: 0 },
};
const state = (coupons: UserCouponSummary[], selected: string | null = null): CartCouponState => ({ selectedUserCouponId: selected, coupons });

let props: CouponPickerProps;
const html = (overrides: Partial<CouponPickerProps> = {}) => renderToStaticMarkup(<CouponPicker {...props} {...overrides} />);

beforeEach(() => {
  hooks.fake = false; hooks.states = []; hooks.pending = [];
  mocks.apply.mockReset(); mocks.applyCode.mockReset(); mocks.clear.mockReset();
  props = { surface: 'checkout', couponState: state([fix5k]), appliedCoupon: null, quote: null };
});

describe('CouponPicker — 표시', () => {
  it('보유 쿠폰 select 와 코드 입력을 같은 묶음에 두고, 주문서 form 안에 form 을 중첩하지 않는다', () => {
    const markup = html();
    expect(markup).toContain('id="checkout-coupon-select"');
    expect(markup).toMatch(/<option value=""( selected="")?>쿠폰 선택 안 함<\/option>/);
    expect(markup).toContain(`<option value="${fix5k.id}">5천원 할인 · ₩5,000 할인</option>`);
    expect(markup).toContain('id="checkout-coupon-code"');
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>쿠폰 적용<\/button>/);
    expect(markup).not.toContain('<form');
    expect(markup).toContain('장바구니에서 고른 쿠폰이 이어져요. 바꾸면 결제 금액을 다시 계산해요.');
  });

  it('장바구니 id 는 기존 그대로이고, 주문서에서도 바꿀 수 있다고 사실대로 안내한다', () => {
    const markup = html({ surface: 'cart' });
    expect(markup).toContain('id="cart-coupon-select"');
    expect(markup).toContain('id="cart-coupon-code"');
    expect(markup).toContain('보유 쿠폰 1장을 고르거나 코드를 입력해주세요. 주문서에서도 바꿀 수 있어요.');
    expect(markup).not.toContain('배송비 쿠폰은 주문서에서');
  });

  it('주문서에서 배송비 쿠폰을 고르는 계약(거래 런타임)이면 장바구니는 그 사실을 안내한다', () => {
    const markup = html({ surface: 'cart', shippingCouponsAtCheckout: true });
    expect(markup).toContain('굿즈 쿠폰을 미리 선택할 수 있어요. 중복 적용과 배송비 쿠폰은 주문서에서 확인해주세요.');
  });

  it('쓸 수 있는 쿠폰이 없으면 select 대신 안내하고 코드 입력은 남긴다', () => {
    const markup = html({ couponState: state([]) });
    expect(markup).not.toContain('<select');
    expect(markup).toContain('사용할 수 있는 쿠폰이 없어요. 쿠폰 코드가 있으면 아래에 입력해주세요.');
    expect(markup).toContain('id="checkout-coupon-code"');
  });

  /* 보유 쿠폰 조회가 실패하면 목록이 비어 있어도 '없다'고 단정하지 않는다 — 장바구니·주문서가 같은 문구를 쓴다. */
  it.each(['cart', 'checkout'] as const)('보유 쿠폰을 불러오지 못했으면 없다고 하지 않고 그 사실을 알린다(%s)', (surface) => {
    const markup = html({ surface, couponState: { selectedUserCouponId: null, coupons: [], unavailable: true } });
    expect(markup).toContain('보유 쿠폰을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.');
    expect(markup).not.toContain('사용할 수 있는 쿠폰이 없어요');
    expect(markup).not.toContain('<select');
    expect(markup).toContain(`id="${surface}-coupon-code"`);
  });

  it('지금 계약에서 쓸 수 없는 배송비 쿠폰은 목록에서 빼고 장수만 알린다', () => {
    const markup = html({ couponState: state([fix5k, shipFree]) });
    expect(markup).not.toContain(shipFree.id);
    expect(markup).toContain('배송비 쿠폰 1장은 지금 주문에 쓸 수 없어요.');
    expect(html({ couponState: state([shipFree]) })).toContain('사용할 수 있는 쿠폰이 없어요.');
  });

  it('적용한 쿠폰이 최소 주문 금액에 못 미치면 금액과 함께 알린다', () => {
    const markup = html({ couponState: state([fix5k], fix5k.id), appliedCoupon: fix5k,
      quote: { userCouponId: fix5k.id, couponCode: 'CPNFIX5K', eligibleSubtotal: 12000, discount: 0, reason: 'coupon_min_subtotal' } });
    expect(markup).toContain('쿠폰 대상 굿즈 금액이 최소 주문 금액(₩20,000)에 못 미쳐 지금은 할인이 적용되지 않아요.');
    expect(markup).toContain(`<option value="${fix5k.id}" selected="">`);
    expect(markup).toContain('적용 해제');
  });

  it('다른 쿠폰의 견적이면 조건 안내를 하지 않는다', () => {
    const markup = html({ couponState: state([fix5k], fix5k.id), appliedCoupon: fix5k,
      quote: { userCouponId: shipFree.id, couponCode: 'SHIPFREE', eligibleSubtotal: 0, discount: 0, reason: 'coupon_min_subtotal' } });
    expect(markup).not.toContain('최소 주문 금액');
  });

  /* 만료·대상 없음 같은 사유에서 견적은 eligibleSubtotal 을 0으로 준다 — 최소 금액이 있는 쿠폰이라도 금액 미달로 안내하면 안 된다. */
  it.each([
    ['coupon_expired', '사용 기간이 지난 쿠폰이에요.'],
    ['coupon_no_eligible_goods', '쿠폰 대상 굿즈를 담으면 사용할 수 있어요.'],
    ['coupon_not_started', '아직 사용 기간이 시작되지 않은 쿠폰이에요.'],
  ])('최소 주문 금액이 있는 쿠폰도 견적 사유(%s)대로 알린다', (reason, copy) => {
    const markup = html({ couponState: state([fix5k], fix5k.id), appliedCoupon: fix5k,
      quote: { userCouponId: fix5k.id, couponCode: 'CPNFIX5K', eligibleSubtotal: 0, discount: 0, reason } });
    expect(markup).toContain(copy);
    expect(markup).not.toContain('최소 주문 금액');
  });

  it('대상 굿즈가 없으면 그 사유를 쿠폰 칸에서 알린다', () => {
    const markup = html({ couponState: state([fix5k], fix5k.id), appliedCoupon: { ...fix5k, coupon: { ...fix5k.coupon, minSubtotal: 0 } },
      quote: { userCouponId: fix5k.id, couponCode: 'CPNFIX5K', eligibleSubtotal: 0, discount: 0, reason: 'coupon_no_eligible_goods' } });
    expect(markup).toContain('쿠폰 대상 굿즈를 담으면 사용할 수 있어요.');
  });

  it('제출 중이면 모든 컨트롤을 잠근다', () => {
    const markup = html({ disabled: true });
    expect(markup).toMatch(/<select[^>]*disabled=""/);
    expect(markup.match(/<input[^>]*>/)?.[0]).toContain('disabled=""');
    expect(markup.match(/<button[^>]*>쿠폰 적용/)?.[0]).toContain('disabled=""');
  });
});

describe('CouponPicker — 적용·해제', () => {
  beforeEach(() => { hooks.fake = true; });
  afterEach(() => { hooks.fake = false; });

  const tree = () => { hooks.index = 0; return CouponPicker(props); };
  const find = (predicate: (node: Element) => boolean) => all(tree()).find(predicate);
  const settle = async () => { await Promise.all(hooks.pending); hooks.pending = []; };

  it('select 로 고르면 적용, "선택 안 함"이면 해제한다', async () => {
    mocks.apply.mockResolvedValue({ ok: true });
    mocks.clear.mockResolvedValue({ ok: true });
    (find((node) => node.type === 'select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: fix5k.id } });
    await settle();
    expect(mocks.apply).toHaveBeenCalledWith(fix5k.id);

    props = { ...props, couponState: state([fix5k], fix5k.id), appliedCoupon: fix5k };
    (find((node) => node.type === 'select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } });
    await settle();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  it('코드 칸 Enter 는 주문 제출 대신 코드 적용으로 돌리고, IME 조합 중 Enter 는 건드리지 않는다', async () => {
    mocks.applyCode.mockResolvedValue({ ok: true });
    (find((node) => node.props.id === 'checkout-coupon-code')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'WELCOME-5000' } });

    const composing = vi.fn();
    (find((node) => node.props.id === 'checkout-coupon-code')!.props.onKeyDown as (event: unknown) => void)({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault: composing });
    expect(composing).not.toHaveBeenCalled();
    expect(mocks.applyCode).not.toHaveBeenCalled();

    const preventDefault = vi.fn();
    (find((node) => node.props.id === 'checkout-coupon-code')!.props.onKeyDown as (event: unknown) => void)({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault });
    await settle();
    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.applyCode).toHaveBeenCalledWith('WELCOME-5000');
    expect(find((node) => node.props.id === 'checkout-coupon-code')!.props.value).toBe('');
  });

  it('빈 코드는 액션 없이 안내한다', () => {
    (find((node) => node.type === 'button' && text(node.props.children as ReactNode) === '쿠폰 적용')!.props.onClick as () => void)();
    expect(mocks.applyCode).not.toHaveBeenCalled();
    expect(text(tree())).toContain('쿠폰 코드를 입력해주세요.');
  });

  it('지금 계약에서 배송비 쿠폰 코드를 넣으면 쓸 수 없다고 사실대로 알린다', async () => {
    mocks.applyCode.mockResolvedValue({ ok: false, message: '배송비 쿠폰은 주문서에서 받을 방식과 배송지를 확인한 뒤 선택해주세요.', shippingCoupon: true });
    (find((node) => node.props.id === 'checkout-coupon-code')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'SHIPFREE' } });
    (find((node) => node.type === 'button' && text(node.props.children as ReactNode) === '쿠폰 적용')!.props.onClick as () => void)();
    await settle();
    const rendered = text(tree());
    expect(rendered).toContain('배송비 쿠폰은 지금 주문에 쓸 수 없어요.');
    expect(rendered).not.toContain('주문서에서 받을 방식');
  });

  it('첫구매 선점 거절은 진행 중 주문 링크를 함께 둔다', async () => {
    mocks.apply.mockResolvedValue({ ok: false, message: '첫구매 혜택으로 진행 중인 주문을 완료하거나 취소해주세요.', pendingOrder: true });
    (find((node) => node.type === 'select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: fix5k.id } });
    await settle();
    expect(renderToStaticMarkup(<>{tree()}</>)).toContain('href="/orders?pending=1"');
  });
});
