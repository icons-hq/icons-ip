import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { UserCouponSummary } from '@/lib/coupons';
import type { Good } from '@/lib/data';
import type { AddressGoodsSalesQuote } from '@/lib/shipping-regions';

/* 제출 가드 흐름을 보려고 훅을 대체해 Checkout 을 함수로 부른다(GoodsTransactionCheckout.client.test 와 같은 방식). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0 }));
const mocks = vi.hoisted(() => ({ place: vi.fn(), items: [] as CartItem[], sales: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.ri++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/checkout/actions', () => ({ placeOrderAction: mocks.place }));
vi.mock('@/app/cart/coupon-actions', () => ({ applyCouponAction: vi.fn(), applyCouponCodeAction: vi.fn(), clearCouponAction: vi.fn() }));
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: vi.fn() }));
vi.mock('@/components/checkout/PostcodeField', () => ({ PostcodeField: () => null }));
vi.mock('@/components/checkout/useStoreCreditQuote', () => ({ useStoreCreditQuote: () => ({ quote: null, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock('@/components/shop/useShippingQuote', () => ({ useShippingQuote: () => ({
  quote: (mocks.sales as AddressGoodsSalesQuote | null)?.shipping ?? null, sales: mocks.sales, loading: false, error: null, refresh: vi.fn(),
}) }));
vi.mock('@/components/shell/CartProvider', () => ({
  useReleaseUnpaidCartOrders: () => true,
  useCart: () => ({ items: mocks.items, ready: true, mode: 'server' as const, pending: false, error: null, refresh: vi.fn() }),
}));

import { CouponPicker } from '@/components/checkout/CouponPicker';
import { Checkout } from './Checkout';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));

const VARIANT = '00000000-0000-4000-8000-000000000001';
const good: Good = { id: 'g13', name: '홍실 아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null, stock: 'ok', stockQty: 20,
  options: [{ id: VARIANT, name: '기본 옵션', price: 12000, stockQty: 20, code: 'G13', isDefault: true, attributes: {} }], img: 'none' };
const held = (id: string, name: string): UserCouponSummary => ({ id, status: 'active', issuedAt: '2026-08-30T00:00:00Z', expiresAt: null, usedAt: null,
  coupon: { code: 'CPNFIX5K', name, discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null } });
const couponA = held('11111111-1111-4111-8111-111111111111', '5천원 할인');
const couponB = held('22222222-2222-4222-8222-222222222222', '3천원 할인');

let props: Parameters<typeof Checkout>[0];
const render = () => { hooks.si = hooks.ri = 0; return Checkout(props); };
const picker = () => all(render()).find((node) => node.type === CouponPicker)!;
const submitButton = () => all(render()).find((node) => node.type === 'button' && String(node.props.className).includes('checkout-submit'))!;
const submit = () => (all(render()).find((node) => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });

beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  mocks.place.mockReset();
  mocks.place.mockResolvedValue({ ok: false, error: 'unavailable' });
  mocks.items = [{ goodId: 'g13', variantId: VARIANT, qty: 1 }];
  mocks.sales = {
    calculatedAt: '2026-09-10T00:00:00Z', subtotal: 12000,
    lines: [{ goodId: 'g13', variantId: VARIANT, qty: 1, regularPrice: 12000, effectivePrice: 12000, pricePeriodId: null, startsAt: null, endsAt: null, available: true }],
    goods: [{ goodId: 'g13', qty: 1, orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null, memberPurchaseLimitEnabled: false,
      memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason: null }],
    shipping: { totalFee: 3000, groups: [], checkoutAllowed: true, finalTotalFee: 3000, destination: null, nextChangeAt: null },
    paymentMethods: { card: true, bankTransfer: true },
    coupon: { userCouponId: couponA.id, couponCode: 'CPNFIX5K', eligibleSubtotal: 12000, discount: 5000, reason: null },
  };
  props = {
    catalog: { goods: [good], ips: [] },
    addressPrefill: {
      address: { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', deliveryNote: '' },
      source: 'address_book', book: [],
    },
    paymentAvailable: true, bankTransferAvailable: true, resumeOrderId: null,
    appliedCoupon: couponA, couponState: { selectedUserCouponId: couponA.id, coupons: [couponA, couponB] },
  };
});

/* 쿠폰 변경 서버 액션이 끝나기 전에 결제를 누르면 이전 쿠폰으로 주문이 큐에 들어가고, DB 가 coupon_selection_changed 로
   거절한다(Next 는 서버 액션을 한 번에 하나씩 보낸다). 쿠폰 칸이 바쁜 동안에는 결제 버튼과 submit 가드가 함께 잠긴다. */
describe('Checkout 쿠폰 변경 중 결제 잠금', () => {
  it('쿠폰 칸이 바쁘면 결제 버튼을 잠그고 제출해도 주문을 만들지 않는다', async () => {
    expect(submitButton().props.disabled).toBe(false);

    (picker().props.onPendingChange as (pending: boolean) => void)(true);
    expect(submitButton().props.disabled).toBe(true);
    await submit();
    expect(mocks.place).not.toHaveBeenCalled();

    (picker().props.onPendingChange as (pending: boolean) => void)(false);
    expect(submitButton().props.disabled).toBe(false);
    await submit();
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect(mocks.place.mock.calls[0][4]).toBe(couponA.id);
  });

  it('주문을 만드는 동안에는 쿠폰 칸을 잠근다', async () => {
    let resolve!: (value: unknown) => void;
    mocks.place.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    const work = submit();
    expect(picker().props.disabled).toBe(true);
    resolve({ ok: false, error: 'unavailable' });
    await work;
    expect(picker().props.disabled).toBe(false);
  });
});
