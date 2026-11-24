import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { UserCouponSummary } from '@/lib/coupons';
import type { Good } from '@/lib/data';
import type { AddressGoodsSalesQuote } from '@/lib/shipping-regions';

/* 제출 가드 흐름을 보려고 훅을 대체해 Checkout 을 함수로 부른다(GoodsTransactionCheckout.client.test 와 같은 방식). */
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], si: 0, ri: 0 }));
const mocks = vi.hoisted(() => ({ place: vi.fn(), save: vi.fn(), push: vi.fn(), cartPending: false, items: [] as CartItem[], sales: null as unknown }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const i = hooks.si++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[i]) : next; }]; },
  useRef: (value: unknown) => { const i = hooks.ri++; return hooks.refs[i] ??= { current: value }; },
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock('@/app/checkout/actions', () => ({ placeOrderAction: mocks.place }));
vi.mock('@/app/cart/coupon-actions', () => ({ applyCouponAction: vi.fn(), applyCouponCodeAction: vi.fn(), clearCouponAction: vi.fn() }));
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: mocks.save }));
vi.mock('@/components/checkout/PostcodeField', () => ({ PostcodeField: () => null }));
vi.mock('@/components/checkout/useStoreCreditQuote', () => ({ useStoreCreditQuote: () => ({ quote: null, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock('./CheckoutDraftQuotes', () => ({
  useDraftStoreCreditQuote: () => ({ quote: null, loading: false, error: null, refresh: vi.fn() }),
  useDirectCheckoutQuote: () => ({ quote: null, sales: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('@/components/shop/useShippingQuote', () => ({ useShippingQuote: () => ({
  quote: (mocks.sales as AddressGoodsSalesQuote | null)?.shipping ?? null, sales: mocks.sales, loading: false, error: null, refresh: vi.fn(),
}) }));
vi.mock('@/components/shell/CartProvider', () => ({
  useReleaseUnpaidCartOrders: () => true,
  useCart: () => ({ items: mocks.items, ready: true, mode: 'server' as const, pending: mocks.cartPending, error: null, refresh: vi.fn() }),
}));

import { CouponPicker } from '@/components/checkout/CouponPicker';
import { CheckoutAddressSection } from '@/components/checkout/CheckoutAddressSection';
import type { CheckoutAddressEntryState } from '@/components/checkout/useCheckoutAddressEntry';
import { setCustomerConfirmHandler, type CustomerConfirmRequest } from '@/lib/customer-confirm';
import type { CheckoutAddress } from '@/lib/checkout';
import { PurchaseAcknowledgement } from '@/components/checkout/PurchaseAcknowledgement';
import { Checkout } from './Checkout';

type Element = ReactElement<Record<string, unknown>>;
const all = (node: ReactNode): Element[] => Children.toArray(node).flatMap((child) => (isValidElement<Record<string, unknown>>(child) ? [child, ...all(child.props.children as ReactNode)] : []));

const VARIANT = '00000000-0000-4000-8000-000000000001';
const good: Good = { id: 'g13', name: '홍실 아크릴 블록', ip: 'hong-sil-quest', price: 12000, badge: null, stock: 'ok', stockQty: 20,
  options: [{ id: VARIANT, name: '기본 옵션', price: 12000, stockQty: 20, code: 'G13', isDefault: true, attributes: {} }], img: 'none' };
const held = (id: string, name: string): UserCouponSummary => ({ id, status: 'active', issuedAt: '2026-08-30T00:00:00Z', expiresAt: null, usedAt: null,
  coupon: { code: 'CPNFIX5K', name, discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null } });
const couponA = held('11111111-1111-4111-8111-111111111111', '5천원 할인');
const couponB = held('22222222-2222-4222-8222-222222222222', '3천원 할인');

let props: Parameters<typeof Checkout>[0];
const render = () => { hooks.si = hooks.ri = 0; return Checkout(props); };
const picker = () => all(render()).find((node) => node.type === CouponPicker)!;
const acknowledgement = () => all(render()).find((node) => node.type === PurchaseAcknowledgement)!;
const acknowledge = (checked = true) => (acknowledgement().props.onChange as (checked: boolean) => void)(checked);
const submitButton = () => all(render()).find((node) => node.type === 'button' && String(node.props.className).includes('checkout-submit'))!;
const submit = () => (all(render()).find((node) => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });

beforeEach(() => {
  hooks.states = []; hooks.refs = [];
  mocks.cartPending = false;
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
  /* 결제 전 확인 동의(PAY-015) — 아래 시험은 체크한 뒤의 흐름이다. 체크 전은 맨 아래 'Checkout 결제 전 확인 동의'가 본다. */
  acknowledge();
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

/* 결제가 몰리면 서버가 주문 생성을 자동으로 다시 시도한다(동접 대비). 3초가 넘으면 '처리 중'을 알리고, 끝내 혼잡이면 다시 누르라고 안내한다. */
describe('Checkout 결제 혼잡 안내', () => {
  const texts = (node: ReactNode) => all(node).flatMap((element) => Children.toArray(element.props.children as ReactNode)).filter((child): child is string => typeof child === 'string');

  it('주문 생성이 3초를 넘기면 버튼과 안내를 처리 중으로 바꾸고, 끝나면 되돌린다', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: unknown) => void;
      mocks.place.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
      const work = submit();
      expect(texts(render())).toContain('재고를 확인하는 중');
      await vi.advanceTimersByTimeAsync(2_999);
      expect(texts(render())).not.toContain('주문이 많아 처리 중이에요');
      await vi.advanceTimersByTimeAsync(1);
      const busy = texts(render());
      expect(busy).toContain('주문이 많아 처리 중이에요');
      expect(busy).toContain('주문이 몰려 순서대로 처리하고 있어요. 이 화면에서 잠시만 기다려주세요.');
      resolve({ ok: false, error: 'order_busy' });
      await work;
      const after = texts(render());
      expect(after).not.toContain('주문이 많아 처리 중이에요');
      expect(after).toContain('주문이 몰려 지금은 접수하지 못했어요. 잠시 후 결제하기를 다시 눌러주세요.');
    } finally { vi.useRealTimers(); }
  });

  it('빨리 끝난 주문은 처리 중 안내를 띄우지 않는다', async () => {
    vi.useFakeTimers();
    try {
      await submit();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(texts(render())).not.toContain('주문이 많아 처리 중이에요');
    } finally { vi.useRealTimers(); }
  });
});

/* 같은 주문서(초안)를 다른 탭·뒤로 가기로 다시 내면 DB가 원 주문과 함께 거절한다(ADR-0030 완료 기준 5). 주문서는 원 주문으로
   잇고 다시 주문하지 않는다. */
describe('Checkout 이미 주문한 주문서', () => {
  const ORDER = '00000000-0000-4000-8000-0000000000e1';
  it('재제출이 거절되면 원 주문 보기를 보이고 결제 버튼을 잠근다', async () => {
    props = { ...props, draft: { id: '00000000-0000-4000-8000-0000000000d1', source: 'selection', baseGoodId: null, expiresAt: '2099-01-01T00:00:00Z',
      stale: false, usedOrderId: null, lines: [{ goodId: 'g13', variantId: VARIANT, qty: 1 }] } };
    mocks.place.mockResolvedValueOnce({ ok: false, error: 'checkout_draft_used', orderId: ORDER });
    await submit();
    const tree = all(render());
    expect(tree.some((node) => node.props.href === `/orders/${ORDER}`)).toBe(true);
    expect(tree.some((node) => node.props.role === 'alert'
      && Children.toArray(node.props.children as ReactNode).some((child) => typeof child === 'string' && child.includes('이미 주문한 주문서예요')))).toBe(true);
    expect(submitButton().props.disabled).toBe(true);
    await submit();
    expect(mocks.place).toHaveBeenCalledTimes(1);
  });

  /* 그 주문의 결제 승인을 확인하고 있으면(리스가 지난 confirming 포함) 다시 내도 새 주문을 만들지 않는다 — 그 주문으로 잇는다. */
  it('결제 확인 중인 주문이 있으면 그 주문 보기를 보이고 결제 버튼을 잠근다', async () => {
    props = { ...props, draft: { id: '00000000-0000-4000-8000-0000000000d1', source: 'selection', baseGoodId: null, expiresAt: '2099-01-01T00:00:00Z',
      stale: false, usedOrderId: null, lines: [{ goodId: 'g13', variantId: VARIANT, qty: 1 }] } };
    mocks.place.mockResolvedValueOnce({ ok: false, error: 'checkout_payment_in_progress', orderId: ORDER });
    await submit();
    const tree = all(render());
    expect(tree.some((node) => node.props.href === `/orders/${ORDER}`)).toBe(true);
    expect(tree.some((node) => node.props.role === 'alert'
      && Children.toArray(node.props.children as ReactNode).some((child) => typeof child === 'string' && child.includes('결제 확인 중인 주문이 있어요')))).toBe(true);
    expect(submitButton().props.disabled).toBe(true);
    await submit();
    expect(mocks.place).toHaveBeenCalledTimes(1);
  });
});

/* QA2 S-W1m-02: 주문서가 스스로 재견적해 버튼을 끄는 경로에서도 판매기간 안내 한 줄이 나오고 일반 '재고 변경' 문구는 같이 뜨지 않는다. */
describe('Checkout 재견적으로 주문 불가가 된 줄의 판매기간 안내', () => {
  const ended = { state: 'ended' as const, startsAt: null, endsAt: '2026-09-09T00:00:00Z', calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: null };
  const unavailableSales = () => {
    const sales = mocks.sales as AddressGoodsSalesQuote;
    mocks.sales = { ...sales, lines: sales.lines.map((line) => ({ ...line, available: false })) };
  };
  const alertText = (node: ReactNode): string => Children.toArray(node).map((part) => (typeof part === 'string' ? part : isValidElement<Record<string, unknown>>(part) ? alertText(part.props.children as ReactNode) : '')).join('');
  const alerts = () => all(render()).filter((node) => node.props.role === 'alert').map((node) => alertText(node.props.children as ReactNode)).join('\n');
  it('카탈로그가 아직 옛 값이면 서버 속성을 한 번 다시 읽도록 불가 줄 조합을 알린다', async () => {
    const { QuoteUnavailableRefresh } = await import('@/components/shop/QuoteUnavailableRefresh');
    unavailableSales();
    expect(all(render()).find((node) => node.type === QuoteUnavailableRefresh)!.props.signature).toBe('g13');
    expect(submitButton().props.disabled).toBe(true);
  });
  it('카탈로그에 판매기간 종료가 반영되면 상품 이름 한 줄만 보이고 재고 변경·일반 불가 문구는 없다', () => {
    unavailableSales();
    props = { ...props, catalog: { goods: [{ ...good, salePeriod: ended }], ips: [] } };
    const text = alerts();
    expect(text).toContain('판매기간이 끝난 상품이 있어요: 홍실 아크릴 블록');
    expect(text).not.toContain('재고가 변경된');
    expect(text).not.toContain('현재 판매 상태나 재고가 변경된');
  });
  it('판매기간 안내가 이미 있으면 다시 읽지 않는다', async () => {
    const { QuoteUnavailableRefresh } = await import('@/components/shop/QuoteUnavailableRefresh');
    unavailableSales();
    props = { ...props, catalog: { goods: [{ ...good, salePeriod: ended }], ips: [] } };
    expect(all(render()).find((node) => node.type === QuoteUnavailableRefresh)!.props.signature).toBeNull();
  });
});

/* 결제 전 주문 내용 확인·구매 조건 동의(PAY-015) — 체크 전에는 결제 버튼이 잠기고 제출해도 주문을 만들지 않으며, 체크하면 서버 액션에 true로 넘긴다. */
describe('Checkout 결제 전 확인 동의', () => {
  it('체크 전에는 버튼이 잠기고 제출해도 주문을 만들지 않는다', async () => {
    acknowledge(false);
    expect(acknowledgement().props.checked).toBe(false);
    expect(submitButton().props.disabled).toBe(true);
    await submit();
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it('체크하면 주문을 만들고 서버 액션에 동의 true를 8번째 인자로 넘긴다', async () => {
    expect(submitButton().props.disabled).toBe(false);
    await submit();
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect(mocks.place.mock.calls[0][7]).toBe(true);
  });

  it('주문이 거절되면 바뀐 내용을 다시 확인하도록 체크를 풀고 버튼을 잠근다', async () => {
    await submit();
    expect(acknowledgement().props.checked).toBe(false);
    expect(submitButton().props.disabled).toBe(true);
    acknowledge();
    expect(submitButton().props.disabled).toBe(false);
  });

  it('주문을 만드는 동안에는 체크박스도 잠근다', async () => {
    let resolve!: (value: unknown) => void;
    mocks.place.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    const work = submit();
    expect(acknowledgement().props.disabled).toBe(true);
    resolve({ ok: false, error: 'unavailable' });
    await work;
  });
});

/* 화면이 실제로 보인 제한 고지를 서버 액션 9번째 인자로 보내고, 서버가 안내가 바뀌었다고 거절하면 체크를 풀고 주문서를 새로 읽는다. */
describe('Checkout 제한 고지 대조', () => {
  it('보인 제한 상품 id 목록을 9번째 인자로 보낸다(제한 없으면 빈 목록)', async () => {
    await submit();
    expect(mocks.place.mock.calls[0][8]).toEqual([]);
    acknowledge();
    props = { ...props, claimRestrictions: { g13: { goodId: 'g13', returnAllowed: false, exchangeAllowed: null, reason: '각인' }, other: { goodId: 'other', returnAllowed: false, exchangeAllowed: null, reason: 'x' } } };
    await submit();
    expect(mocks.place.mock.calls[1][8]).toEqual(['g13']);
  });

  it('읽지 못한 화면은 unavailable 표식을 보낸다', async () => {
    props = { ...props, claimRestrictions: null };
    await submit();
    expect(mocks.place.mock.calls[0][8]).toBe('unavailable');
  });

  it('안내가 바뀌었다는 거절이면 안내 문구를 보이고 체크를 푼다', async () => {
    mocks.place.mockResolvedValueOnce({ ok: false, error: 'claim_notice_changed' });
    await submit();
    expect(acknowledgement().props.checked).toBe(false);
    expect(submitButton().props.disabled).toBe(true);
    expect(all(render()).some((node) => node.props.role === 'alert' && Children.toArray(node.props.children as ReactNode).some((child) => typeof child === 'string' && child.includes('제한 안내가 바뀌었어요')))).toBe(true);
  });
});

/* 국내 커머스 관행 맞추기 P1(11/24): 검색한 주소가 공동주택인데 상세 주소가 비면 주문 전에 한 번 확인받고(막지 않는다),
   체크한 배송지는 주문을 만든 뒤에만 주소록에 저장한다(거절된 주문의 배송지는 남기지 않는다). */
describe('Checkout 배송지 확인·주소록 저장', () => {
  const focused: string[] = [];
  const section = () => all(render()).find((node) => node.type === CheckoutAddressSection)!;
  const entry = () => section().props.entry as CheckoutAddressEntryState;
  const setAddress = (next: (current: CheckoutAddress) => CheckoutAddress) => (section().props.setAddress as (value: typeof next) => void)(next);
  beforeEach(() => {
    focused.length = 0;
    mocks.save.mockReset();
    mocks.push.mockReset();
    vi.stubGlobal('window', { requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0; }, scrollTo: vi.fn() });
    vi.stubGlobal('document', { getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) });
  });
  afterEach(() => { vi.unstubAllGlobals(); setCustomerConfirmHandler(null); });

  it('공동주택 검색 결과에 상세 주소가 없으면 확인받고, [상세 주소 입력]이면 주문하지 않고 그 칸으로 간다', async () => {
    const asked: CustomerConfirmRequest[] = [];
    let answer = false;
    setCustomerConfirmHandler(async (request) => { asked.push(request); return answer; });
    entry().setApartment(true);
    setAddress((current) => ({ ...current, address2: '' }));
    await submit();
    expect(asked[0]).toMatchObject({ confirmLabel: '이대로 주문', cancelLabel: '상세 주소 입력' });
    expect(mocks.place).not.toHaveBeenCalled();
    expect(focused).toContain('checkout-address2');

    answer = true;
    await submit();
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect(mocks.place.mock.calls[0][0]).toMatchObject({ address2: '' });

    /* 공동주택이 아니거나(주소록·직전 주문 배송지) 상세 주소를 적었으면 묻지 않는다. */
    setAddress((current) => ({ ...current, address2: '101동' }));
    acknowledge();
    await submit();
    expect(asked).toHaveLength(2);
    expect(mocks.place).toHaveBeenCalledTimes(2);
  });

  it('저장 체크는 기본 꺼짐이고, 켜면 주문을 만든 뒤에만 그 배송지를 주소록에 저장한다', async () => {
    expect(entry().saveToBook).toBe(false);
    mocks.place.mockResolvedValue({ ok: true, orderId: '00000000-0000-4000-8000-0000000000aa' });
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/checkout/00000000-0000-4000-8000-0000000000aa');

    hooks.states = []; hooks.refs = []; acknowledge();
    entry().setSaveToBook(true);
    entry().setSaveLabel('본가');
    mocks.place.mockResolvedValueOnce({ ok: false, error: 'out_of_stock' });
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();

    acknowledge();
    mocks.save.mockResolvedValue({ ok: true, entries: [], savedId: '7a570000-0000-4000-8000-000000000009' });
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(null, { label: '본가', recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', makeDefault: true });
  });

  it('주소록 저장이 실패해도 주문 흐름은 그대로 이어진다', async () => {
    entry().setSaveToBook(true);
    mocks.place.mockResolvedValue({ ok: true, orderId: '00000000-0000-4000-8000-0000000000aa' });
    mocks.save.mockRejectedValue(new Error('network'));
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/checkout/00000000-0000-4000-8000-0000000000aa');
  });
});

/* 탭을 다시 볼 때 supabase-js 가 보내는 인증 이벤트로 장바구니가 다시 동기화된다 — 주문서를 '확인하고 있어요'로 바꾸면 배송지 시트와
   입력 중인 새 배송지가 사라진다. 첫 확인 뒤에는 화면을 두고, 동기화 동안 제출만 막는다. */
describe('Checkout 장바구니 재동기화 중 화면 유지', () => {
  it('처음 확인하는 동안은 불러오는 화면이고, 한 번 그린 뒤의 재동기화에는 배송지 칸을 그대로 두고 결제만 잠근다', async () => {
    hooks.states = []; hooks.refs = [];
    mocks.cartPending = true;
    expect(all(render()).some((node) => node.type === CheckoutAddressSection)).toBe(false);
    mocks.cartPending = false;
    render();
    acknowledge();
    expect(all(render()).some((node) => node.type === CheckoutAddressSection)).toBe(true);
    mocks.cartPending = true;
    expect(all(render()).some((node) => node.type === CheckoutAddressSection)).toBe(true);
    expect(submitButton().props.disabled).toBe(true);
    await submit();
    expect(mocks.place).not.toHaveBeenCalled();
  });
});
