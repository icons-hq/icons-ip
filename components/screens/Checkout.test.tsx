import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { Good } from '@/lib/data';
import type { AddressGoodsSalesQuote } from '@/lib/shipping-regions';
import { EMPTY_CHECKOUT_ADDRESS_PREFILL, type CheckoutAddressPrefill } from '@/lib/address-book';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import { Checkout, checkoutMethodAvailable } from './Checkout';

const mocks = vi.hoisted(() => ({ items: [] as CartItem[], sales: null as AddressGoodsSalesQuote | null }));

vi.mock('@/components/shop/useShippingQuote', () => ({useShippingQuote: () => ({quote:mocks.sales?.shipping ?? null,sales:mocks.sales,loading:false,error:null,refresh:vi.fn()})}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/checkout/actions', () => ({ placeOrderAction: vi.fn() }));
vi.mock('@/app/cart/coupon-actions', () => ({ applyCouponAction: vi.fn(), applyCouponCodeAction: vi.fn(), clearCouponAction: vi.fn() }));
vi.mock('@/app/my/addresses/actions', () => ({ saveAddressBookEntryAction: vi.fn() }));
vi.mock('@/components/checkout/PostcodeField', () => ({
  PostcodeField: () => <div data-postcode-field />,
}));
vi.mock('@/components/shell/CartProvider', () => ({
  useReleaseUnpaidCartOrders: () => true,
  useCart: () => ({
    items: mocks.items,
    ready: true,
    mode: 'server' as const,
    pending: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const goods: Good[] = [
  {
    id: 'g13',
    name: '홍실 아크릴 블록',
    ip: 'hong-sil-quest',
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 20,
    options: [{id:'00000000-0000-4000-8000-000000000001',name:'기본 옵션',price:12000,stockQty:20,code:'G13',isDefault:true,attributes:{}}],
    img: 'none',
  },
  {
    id: 'g14',
    name: '홍실 한정 피규어',
    ip: 'hong-sil-quest',
    type: '피규어',
    price: 30000,
    badge: null,
    stock: 'ok',
    stockQty: 5,
    options: [{id:'00000000-0000-4000-8000-000000000001',name:'기본 옵션',price:30000,stockQty:5,code:'G14',isDefault:true,attributes:{}}],
    img: 'none',
    allowBankTransfer: false,
  },
];

function render({
  paymentAvailable,
  bankTransferAvailable,
  items = [{ goodId: 'g13', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }],
  resumeOrderId = null,
  paymentFailCode = null,
  quote = {},
  addressPrefill = EMPTY_CHECKOUT_ADDRESS_PREFILL,
  couponState,
}: {
  addressPrefill?: CheckoutAddressPrefill;
  couponState?: CartCouponState;
  paymentAvailable: boolean;
  bankTransferAvailable: boolean;
  items?: CartItem[];
  resumeOrderId?: string | null;
  paymentFailCode?: string | null;
  quote?: Partial<AddressGoodsSalesQuote> | null;
}) {
  mocks.items = items;
  const lines = items.map(item => ({ ...item, regularPrice: goods.find(good => good.id === item.goodId)?.price ?? 0,
    effectivePrice: goods.find(good => good.id === item.goodId)?.price ?? 0, pricePeriodId: null, startsAt: null, endsAt: null, available: true }));
  mocks.sales = quote === null ? null : {
    calculatedAt: '2026-09-10T00:00:00Z', subtotal: lines.reduce((sum, line) => sum + line.effectivePrice * line.qty, 0), lines,
    goods: items.map(item => ({ goodId: item.goodId, qty: item.qty, orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
      memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason: null })),
    shipping: { totalFee: 3000, groups: [], checkoutAllowed: true, finalTotalFee: 3000, destination: null, nextChangeAt: null },
    paymentMethods: { card: true, bankTransfer: !items.some(item => goods.find(good => good.id === item.goodId)?.allowBankTransfer === false) }, ...quote,
  };
  return renderToStaticMarkup(
    <Checkout
      catalog={{ goods, ips: [] }}
      addressPrefill={addressPrefill}
      paymentAvailable={paymentAvailable}
      bankTransferAvailable={bankTransferAvailable}
      resumeOrderId={resumeOrderId}
      appliedCoupon={couponState?.coupons.find(held => held.id === couponState.selectedUserCouponId) ?? null}
      couponState={couponState}
      paymentFailCode={paymentFailCode}
    />,
  );
}

/* React SSR은 속성 순서를 보존하지 않으므로 태그를 통째로 뽑아 검사한다. */
function methodRadio(html: string, value: 'card' | 'bank_transfer'): string {
  const tag = html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`결제수단 라디오(${value})가 렌더되지 않았다`);
  return tag;
}

it.each(['coupon_first_purchase_reserved', 'coupon_first_purchase_pending'])('견적에서 첫구매 주문이 차단돼도 내 주문 링크를 제공한다: %s', (reason) => {
  const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { coupon: {
    userCouponId: '00000000-0000-4000-8000-000000000099', couponCode: 'FIRST', eligibleSubtotal: 12000, discount: 0, reason,
  } } });
  expect(html).toContain('href="/orders?pending=1"');
  expect(html).toContain('진행 중인 주문 확인');
});

function submitButton(html: string): string {
  const tag = html.match(/<button[^>]*checkout-submit[^>]*>/)?.[0];
  if (!tag) throw new Error('제출 버튼이 렌더되지 않았다');
  return tag;
}

/* submit 가드와 제출 버튼 disabled가 공유하는 판정. 여기가 어긋나면 "버튼은
   활성인데 눌러도 아무 일도 없는" 화면이 된다. */
describe('checkoutMethodAvailable', () => {
  it('카드 게이트가 닫혀도 무통장이 열려 있으면 무통장 제출을 허용한다', () => {
    const gates = { card: false, bankTransfer: true };

    expect(checkoutMethodAvailable('bank_transfer', gates)).toBe(true);
    expect(checkoutMethodAvailable('card', gates)).toBe(false);
  });

  it('무통장이 닫힌 구성에서는 카드만 허용한다', () => {
    const gates = { card: true, bankTransfer: false };

    expect(checkoutMethodAvailable('card', gates)).toBe(true);
    expect(checkoutMethodAvailable('bank_transfer', gates)).toBe(false);
  });
});

describe('Checkout 결제수단 게이트', () => {
  it('배송비가 확정되지 않으면 확정 결제 금액을 제시하거나 주문을 허용하지 않는다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { shipping: {
      totalFee: 3000, groups: [], checkoutAllowed: false, finalTotalFee: null, destination: null, nextChangeAt: null,
    } } });
    expect(html).toContain('배송지 확인 후 확정');
    expect(html).not.toContain('₩15,000');
    expect(submitButton(html)).toContain('disabled');
  });
  it('다른 화면의 새 쿠폰을 갱신된 주문서 확인 없이 소비하지 않는다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { coupon: {
      userCouponId: '11111111-1111-4111-8111-111111111111', couponCode: 'CHANGED',
      discount: 1000, eligibleSubtotal: 12000, reason: null,
    } } });
    expect(html).toContain('다른 화면에서 선택한 쿠폰이 변경되었습니다');
    expect(submitButton(html)).toContain('disabled');
  });
  it('상품이 무통장 전용이면 카드 PG가 열려 있어도 서버 견적의 무통장을 선택한다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { paymentMethods: { card: false, bankTransfer: true } } });
    expect(methodRadio(html, 'card')).toContain('disabled');
    expect(methodRadio(html, 'bank_transfer')).toContain('checked');
    expect(submitButton(html)).not.toContain('disabled');
  });

  it('구매 한도 위반과 견적 미확인 상태에서는 주문을 제출할 수 없다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { goods: [{
      goodId: 'g13', qty: 1, orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 3,
      memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason: 'order_quantity_below_minimum',
    }] } });
    expect(html).toContain('최소 구매 수량보다 적어요');
    expect(submitButton(html)).toContain('disabled');
    expect(submitButton(render({ paymentAvailable: true, bankTransferAvailable: true, quote: null }))).toContain('disabled');
  });
  /* DB 트리거가 1,000원 미만 결제 대기 주문을 거절한다. 제출 뒤 "잠시 후 다시 시도"로
     보이면 고객은 같은 실패를 반복한다(AMT-7). */
  it('굿즈 금액과 배송비 합이 최소 결제 금액 미만이면 제출 전에 사유를 안내하고 막는다', () => {
    const free = { totalFee: 0, groups: [], checkoutAllowed: true, finalTotalFee: 0, destination: null, nextChangeAt: null };
    const below = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { subtotal: 900, shipping: free } });
    expect(below).toContain('최소 결제 금액(₩1,000)보다 적어');
    expect(submitButton(below)).toContain('disabled');

    const atMinimum = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { subtotal: 1000, shipping: free } });
    expect(atMinimum).not.toContain('최소 결제 금액');
  });
  it('카드 OFF·무통장 ON이면 무통장이 선택된 채 제출 버튼이 살아 있다', () => {
    const html = render({ paymentAvailable: false, bankTransferAvailable: true });

    expect(methodRadio(html, 'bank_transfer')).toContain('checked');
    expect(methodRadio(html, 'bank_transfer')).not.toContain('disabled');
    expect(methodRadio(html, 'card')).toContain('disabled');
    expect(html).toContain('주문하고 입금 안내 받기');
    expect(submitButton(html)).not.toContain('disabled');
    expect(html).not.toContain('선택한 결제수단을 지금은 쓸 수 없어요');
  });

  it('카드 ON·무통장 OFF이면 카드로 시작하고 무통장 라디오만 잠근다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: false });

    expect(methodRadio(html, 'card')).toContain('checked');
    expect(methodRadio(html, 'card')).not.toContain('disabled');
    expect(methodRadio(html, 'bank_transfer')).toContain('disabled');
    expect(html).toContain('지금은 무통장 입금을 받지 않습니다.');
    expect(html).toContain('결제하기');
    expect(submitButton(html)).not.toContain('disabled');
  });

  it('무통장 차단 굿즈가 담기면 무통장 라디오와 제출을 함께 막는다', () => {
    const html = render({
      paymentAvailable: false,
      bankTransferAvailable: true,
      items: [{ goodId: 'g13', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }, { goodId: 'g14', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }],
    });

    expect(methodRadio(html, 'bank_transfer')).toContain('disabled');
    expect(html).toContain('이 주문에는 무통장을 쓸 수 없는 굿즈가 있어요.');
    expect(html).toContain('선택한 결제수단을 지금은 쓸 수 없어요');
    expect(submitButton(html)).toContain('disabled');
  });

  it('두 게이트가 모두 닫히면 제출 버튼도 잠긴다', () => {
    const html = render({ paymentAvailable: false, bankTransferAvailable: false });

    expect(methodRadio(html, 'card')).toContain('disabled');
    expect(methodRadio(html, 'bank_transfer')).toContain('disabled');
    expect(html).toContain('선택한 결제수단을 지금은 쓸 수 없어요');
    expect(submitButton(html)).toContain('disabled');
  });
});

describe('Checkout 결제 실패 복귀 안내', () => {
  it('failUrl 복귀 시 검증된 코드는 우리 문구로 안내한다', () => {
    const html = render({
      paymentAvailable: true,
      bankTransferAvailable: true,
      paymentFailCode: 'PAY_PROCESS_CANCELED',
    });

    expect(html).toContain('결제를 직접 취소하셨어요');
  });

  it('미지 코드는 provider 문자열 노출 없이 공통 문구로 덮는다', () => {
    const html = render({
      paymentAvailable: true,
      bankTransferAvailable: true,
      paymentFailCode: 'SOME_UNKNOWN_CODE',
    });

    expect(html).toContain('결제가 완료되지 않았어요');
    expect(html).not.toContain('SOME_UNKNOWN_CODE');
  });

  it('카트가 비어도(주문 이관 후) 재개 화면에서 같은 안내가 선다', () => {
    const html = render({
      paymentAvailable: true,
      bankTransferAvailable: true,
      items: [],
      resumeOrderId: '20000000-0000-4000-8000-000000000388',
      paymentFailCode: 'REJECT_CARD_COMPANY',
    });

    expect(html).toContain('진행 중인 주문이 있어요');
    expect(html).toContain('카드사가 결제를 거절했어요');
    expect(html).toContain('/checkout/20000000-0000-4000-8000-000000000388');
  });
});

/* 주소록(L7 · MY-11) · 배송지 미리 채우기 정정(10/14 S6a): 무엇으로 채웠는지 사실대로 안내하고, 주소록에서 고르거나 저장한다. */
describe('Checkout 배송지 미리 채우기·주소록', () => {
  const home = {
    id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
    postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', isDefault: true,
  };
  const office = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '회사', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };

  it('주소록의 기본 배송지로 채우고 그 사실과 선택지를 보여 준다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, addressPrefill: {
      address: { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', deliveryNote: '' },
      source: 'address_book', book: [home, office],
    } });

    expect(html).toContain('주소록의 기본 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.');
    expect(html).not.toContain('최근 결제한 주문의 배송지를 불러왔어요');
    expect(html).toMatch(/<input[^>]*id="checkout-recipientName"[^>]*value="홍길동"/);
    const select = html.match(/<select[^>]*id="checkout-address-book"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? '';
    expect(select).toMatch(new RegExp(`<option value="${home.id}" selected="">집 \\(기본\\) · \\(04524\\) 서울 중구 세종대로 110 101동</option>`));
    expect(select).toContain(`<option value="${office.id}">회사 · (04524) 서울 강남구 테헤란로 152</option>`);
    /* 이미 주소록에 있는 배송지라 다시 저장하자고 하지 않는다. 연락처는 선택지에 싣지 않는다. */
    expect(html).not.toContain('이 배송지를 주소록에 저장');
    expect(select).not.toContain('01012345678');
    expect(html).toContain('href="/my/addresses"');
  });

  it('주소록이 비면 결제를 마친 직전 주문의 배송지로 채웠다고 안내하고 저장을 권한다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, addressPrefill: {
      address: { recipientName: '김팬', phone: '01099998888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '문 앞' },
      source: 'recent_order', book: [],
    } });

    expect(html).toContain('최근 결제한 주문의 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.');
    expect(html).not.toContain('id="checkout-address-book"');
    expect(html).toContain('이 배송지를 주소록에 저장');
    expect(html).toMatch(/<input[^>]*id="checkout-deliveryNote"[^>]*value="문 앞"/);
  });

  it('채울 배송지가 없으면 기존 안내를 두고, 주소록을 읽지 못했으면 주소록 UI 없이 직접 입력한다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true });

    expect(html).toContain('수령에 필요한 정보만 주문에 안전하게 저장합니다.');
    expect(html).not.toContain('불러왔어요');
    expect(html).not.toContain('checkout-address-book');
    expect(html).not.toContain('href="/my/addresses"');
    expect(html).toContain('id="checkout-recipientName"');
  });
});

/* R25(D3①): 운영 주문서에서도 장바구니와 같은 선택 상태(cart_coupon_selections)로 쿠폰을 고르고 코드를 넣는다. */
describe('Checkout 쿠폰', () => {
  const fix5k: UserCouponSummary = {
    id: '11111111-1111-4111-8111-111111111111', status: 'active', issuedAt: '2026-08-30T00:00:00Z', expiresAt: null, usedAt: null,
    coupon: { code: 'CPNFIX5K', name: '5천원 할인', discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null },
  };

  it('쿠폰을 고르지 않아도 할인 행과 보유 쿠폰 선택·코드 입력을 보인다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, couponState: { selectedUserCouponId: null, coupons: [fix5k] } });
    expect(html).toMatch(/<dt>쿠폰 할인<\/dt><dd>−₩0<\/dd>/);
    expect(html).toContain('id="checkout-coupon-select"');
    expect(html).toContain(`<option value="${fix5k.id}">5천원 할인 · ₩5,000 할인</option>`);
    expect(html).toContain('id="checkout-coupon-code"');
    /* 주문서 전체가 주문 form 이다 — 쿠폰 칸이 form 을 중첩하지 않는다. */
    expect(html.match(/<form/g)).toHaveLength(1);
  });

  it('적용한 쿠폰은 할인 행에 이름과 서버 견적 할인액을 싣는다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, couponState: { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
      quote: { coupon: { userCouponId: fix5k.id, couponCode: 'CPNFIX5K', eligibleSubtotal: 12000, discount: 5000, reason: null } } });
    expect(html).toMatch(/<dt>쿠폰 할인 \(5천원 할인\)<\/dt><dd>−₩5,000<\/dd>/);
    expect(html).toContain('적용 해제');
    expect(html).toContain('₩10,000');
  });

  it('보유 쿠폰이 없으면 안내와 코드 입력만 둔다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, couponState: { selectedUserCouponId: null, coupons: [] } });
    expect(html).toContain('사용할 수 있는 쿠폰이 없어요.');
    expect(html).toContain('id="checkout-coupon-code"');
  });
});

/* R26·R27(D4①): 주문서도 배송 묶음을 택배사로 부르고, 묶음이 둘 이상이면 따로 계산되는 이유를 알린다. */
describe('Checkout 배송 묶음 이름', () => {
  const group = { originId: '00000000-0000-4000-8000-000000042201', originCode: 'gimpo', originName: '김포', policySubtotal: 12000, baseFee: 3000,
    freeThreshold: 50000, policyFee: 3000, individualFee: 0, totalFee: 3000, regionMode: 'legacy_base_only' as const, regionStatus: 'unconfigured' as const,
    regionalContractFee: null, regionalFee: 0, finalFee: 3000, policyId: null, policyVersion: null, ruleId: null, regionLabel: null,
    carrierCode: 'hanjin', carrierLabel: '한진택배', feeUnit: null, unitCount: 0, destinationPostalCode: null, matchedAddressPrefix: null };
  it('택배사가 다른 두 묶음은 각 택배사 이름과 이유 한 줄을 보인다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { shipping: { totalFee: 6000, finalTotalFee: 6000, checkoutAllowed: true,
      destination: null, nextChangeAt: null, groups: [group, { ...group, originId: '00000000-0000-4000-8000-000000042202', originCode: 'namyangju', originName: '남양주', carrierCode: 'epost', carrierLabel: '우체국택배' }] } } });
    expect(html).toContain('<h3>한진택배 배송</h3>');
    expect(html).toContain('<h3>우체국택배 배송</h3>');
    expect(html).toContain('택배사가 달라 배송비가 각각 계산됩니다.');
    expect(html).not.toContain('김포');
  });
  it('묶음이 하나면 이유 줄을 두지 않는다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: true, quote: { shipping: { totalFee: 3000, finalTotalFee: 3000, checkoutAllowed: true,
      destination: null, nextChangeAt: null, groups: [group] } } });
    expect(html).toContain('<h3>한진택배 배송</h3>');
    expect(html).not.toContain('배송비가 각각 계산됩니다');
  });
});
