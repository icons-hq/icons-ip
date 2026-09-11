import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';
import type { Good } from '@/lib/data';
import type { AddressGoodsSalesQuote } from '@/lib/shipping-regions';
import { Checkout, checkoutMethodAvailable } from './Checkout';

const mocks = vi.hoisted(() => ({ items: [] as CartItem[], sales: null as AddressGoodsSalesQuote | null }));

vi.mock('@/components/shop/useShippingQuote', () => ({useShippingQuote: () => ({quote:mocks.sales?.shipping ?? null,sales:mocks.sales,loading:false,error:null,refresh:vi.fn()})}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/checkout/actions', () => ({ placeOrderAction: vi.fn() }));
vi.mock('@/components/checkout/PostcodeField', () => ({
  PostcodeField: () => <div data-postcode-field />,
}));
vi.mock('@/components/shell/CartProvider', () => ({
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
}: {
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
      latestAddress={null}
      paymentAvailable={paymentAvailable}
      bankTransferAvailable={bankTransferAvailable}
      resumeOrderId={resumeOrderId}
      appliedCoupon={null}
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
  it('카드 OFF·무통장 ON이면 무통장이 선택된 채 제출 버튼이 살아 있다', () => {
    const html = render({ paymentAvailable: false, bankTransferAvailable: true });

    expect(methodRadio(html, 'bank_transfer')).toContain('checked');
    expect(methodRadio(html, 'bank_transfer')).not.toContain('disabled');
    expect(methodRadio(html, 'card')).toContain('disabled');
    expect(html).toContain('주문 만들고 입금 안내 받기');
    expect(submitButton(html)).not.toContain('disabled');
    expect(html).not.toContain('선택한 결제수단을 지금은 쓸 수 없어요');
  });

  it('카드 ON·무통장 OFF이면 카드로 시작하고 무통장 라디오만 잠근다', () => {
    const html = render({ paymentAvailable: true, bankTransferAvailable: false });

    expect(methodRadio(html, 'card')).toContain('checked');
    expect(methodRadio(html, 'card')).not.toContain('disabled');
    expect(methodRadio(html, 'bank_transfer')).toContain('disabled');
    expect(html).toContain('지금은 무통장 입금을 받지 않습니다.');
    expect(html).toContain('주문 만들고 결제하기');
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
