import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, LegacyCartItem } from '@/lib/cart';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good } from '@/lib/data';
import type { AddressShippingQuote } from '@/lib/shipping-regions';
import type { CouponQuote } from '@/lib/coupon-targeting';
import type { GoodsSalesPrecheckoutQuote, GoodsSalesQuoteGood, GoodsSalesQuoteLine } from '@/lib/goods-sales';
import { goodsSalesPrecheckoutQuote } from '@/test/fixtures/goods-sales-precheckout';
import CartLoading from '@/app/cart/loading';
import { Cart } from './Cart';

const mocks = vi.hoisted(() => ({
  items: [] as CartItem[],
  legacyItems: [] as LegacyCartItem[],
  ready: true,
  mode: 'server' as 'server' | 'local',
  quote: null as AddressShippingQuote | null,
  quotePrices: new Map<string, number>(),
  quotePeriods: new Map<string, Pick<GoodsSalesQuoteLine, 'regularPrice' | 'pricePeriodId' | 'startsAt' | 'endsAt'>>(),
  quoteLineExtras: new Map<string, Partial<GoodsSalesQuoteLine>>(),
  /* 굿즈 단위 구매 조건(주문당 최소·최대, 회원 누적 한도). 견적은 고른 줄의 굿즈만 돌려준다. */
  quoteGoods: new Map<string, Partial<GoodsSalesQuoteGood>>(),
  coupon: null as CouponQuote | null,
  precheckout: null as GoodsSalesPrecheckoutQuote | null,
  precheckoutError: null as string | null,
  legacyEnabled: false,
  precheckoutEnabled: false,
  /* 견적 훅이 받은 줄 — 장바구니가 고른 줄만 견적하는지 본다(ADR-0030). */
  quotedItems: [] as readonly CartItem[],
}));

vi.mock('@/components/shop/useShippingQuote', () => ({
  useShippingQuote: (quoted: readonly CartItem[], enabled: boolean) => {
    mocks.legacyEnabled = enabled;
    mocks.quotedItems = quoted;
    return {quote:enabled ? mocks.quote : null,sales:enabled && mocks.quote ? {
    calculatedAt:'2026-09-10T00:00:00Z', shipping:mocks.quote,
    subtotal:quoted.reduce((sum,item)=>sum+(mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0)*item.qty,0),
    lines:quoted.map(item=>({...item,regularPrice:mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0,effectivePrice:mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0,pricePeriodId:null,startsAt:null,endsAt:null,...mocks.quotePeriods.get(item.variantId),available:true,...mocks.quoteLineExtras.get(item.variantId)})),
    goods:[...new Set(quoted.map(item=>item.goodId))].filter(goodId=>mocks.quoteGoods.has(goodId)).map(goodId=>({goodId,
      qty:quoted.filter(item=>item.goodId===goodId).reduce((sum,item)=>sum+item.qty,0),orderQuantityLimitEnabled:false,minOrderQty:null,maxOrderQty:null,
      memberPurchaseLimitEnabled:false,memberLifetimeQtyLimit:null,memberReservedQty:null,memberRemainingQty:null,reason:null,...mocks.quoteGoods.get(goodId)})),
    paymentMethods:{card:true,bankTransfer:true},
    coupon:mocks.coupon,
    } : null,loading:enabled && !mocks.quote,error:null,refresh:vi.fn()};
  },
  useGoodsSalesPrecheckoutQuote: (_items: readonly CartItem[], enabled: boolean) => {
    mocks.precheckoutEnabled = enabled;
    return { sales: enabled ? mocks.precheckout : null, loading: enabled && !mocks.precheckout && !mocks.precheckoutError,
      error: enabled ? mocks.precheckoutError : null, refresh: vi.fn() };
  },
}));
const gimpoGroup: AddressShippingQuote['groups'][number] = {originId:'gimpo',originCode:'GIMPO',originName:'김포',baseFee:3000,freeThreshold:50000,
  policySubtotal:12000,policyFee:3000,individualFee:0,totalFee:3000, regionMode: 'legacy_base_only', regionStatus: 'unconfigured',
  regionalContractFee: null, regionalFee: 0, finalFee: 3000, policyId: null, policyVersion: null, ruleId: null,
  regionLabel: null, carrierCode: 'hanjin', feeUnit: null, unitCount: 0, destinationPostalCode: null, matchedAddressPrefix: null};
const defaultQuote: AddressShippingQuote = {totalFee:3000,groups:[gimpoGroup],checkoutAllowed:true,finalTotalFee:3000,destination:null,nextChangeAt:null};
mocks.quote = defaultQuote;
beforeEach(() => {
  mocks.quote = defaultQuote; mocks.legacyItems = []; mocks.ready = true; mocks.quotePrices.clear(); mocks.quotePeriods.clear(); mocks.quoteLineExtras.clear(); mocks.quoteGoods.clear(); mocks.coupon = null;
  mocks.precheckout = null; mocks.precheckoutError = null; mocks.legacyEnabled = false; mocks.precheckoutEnabled = false;
});

vi.mock('@/components/shell/CartProvider', () => ({
  useReleaseUnpaidCartOrders: () => true,
  useCart: () => ({
    items: mocks.items,
    count: mocks.items.reduce((total, item) => total + item.qty, 0),
    ready: mocks.ready,
    legacyItems: mocks.legacyItems,
    removeLegacyItem: vi.fn(),
    mode: mocks.mode,
    pending: false,
    error: null,
    getQuantity: () => 0,
    add: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    resetForSignOut: vi.fn(),
  }),
}));

vi.mock('@/app/cart/coupon-actions', () => ({
  applyCouponAction: vi.fn(),
  applyCouponCodeAction: vi.fn(),
  clearCouponAction: vi.fn(),
}));

/* 모바일 서브헤더의 [← 이전]이 라우터를 쓴다. 정적 렌더라 클릭은 일어나지 않는다. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

const DEFAULT_VARIANT = '00000000-0000-4000-8000-000000000013';
const SOLD_VARIANT = '00000000-0000-4000-8000-000000000014';
const RANDOM_VARIANT = '00000000-0000-4000-8000-000000000015';
const BLUE_VARIANT = '00000000-0000-4000-8000-000000000016';
const goods: Good[] = [
  {
    id: 'g13',
    originId: 'gimpo',
    name: '홍실 아크릴 블록',
    ip: 'hong-sil-quest',
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 20,
    options: [{id:DEFAULT_VARIANT,name:'기본 옵션',code:'G13',price:12000,stockQty:20,isDefault:true,attributes:{}}],
    img: 'none',
  },
  {
    id: 'g14',
    name: '품절된 키링',
    ip: 'hong-sil-quest',
    type: '키링',
    price: 9000,
    badge: null,
    stock: 'soldout',
    stockQty: 0,
    options: [{id:SOLD_VARIANT,name:'기본 옵션',code:'G14',price:9000,stockQty:0,isDefault:true,attributes:{}}],
    img: 'none',
  },
  /* D5② 랜덤 판매 — 카탈로그가 옵션을 기본 옵션 키 하나('랜덤')로 접은 모양. */
  {
    id: 'g15', originId: 'gimpo', name: '랜덤 포토카드', ip: 'hong-sil-quest', type: '포토카드', price: 5000, badge: null, stock: 'ok', stockQty: 6,
    optionSaleMode: 'random', options: [{id:RANDOM_VARIANT,name:'랜덤',code:'',price:5000,stockQty:6,isDefault:true,attributes:{},orderMaxQty:null,memberMaxQty:null}],
    img: 'none',
  },
  /* D7② 옵션별 구매 제한 — 주문당 최대 2개·1인 최대 3개. */
  {
    id: 'g16', originId: 'gimpo', name: '아크릴 키링', ip: 'hong-sil-quest', type: '키링', price: 7000, badge: null, stock: 'ok', stockQty: 9,
    options: [{id:BLUE_VARIANT,name:'파랑',code:'BLUE',price:7000,stockQty:9,isDefault:true,attributes:{},orderMaxQty:2,memberMaxQty:3},
      {id:'00000000-0000-4000-8000-000000000017',name:'빨강',code:'RED',price:7000,stockQty:0,isDefault:false,attributes:{}}],
    img: 'none',
  },
];

const fix5k: UserCouponSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'active',
  issuedAt: '2026-08-30T00:00:00Z',
  expiresAt: null,
  usedAt: null,
  coupon: {
    code: 'CPNFIX5K',
    name: '5천원 할인',
    discountType: 'fixed',
    discountValue: 5000,
    maxDiscountAmount: null,
    minSubtotal: 20000,
    endsAt: null,
    gradeBenefit: null,
  },
};

const emptyCouponState: CartCouponState = { selectedUserCouponId: null, coupons: [] };

function render(items: CartItem[], couponState: CartCouponState = emptyCouponState) {
  mocks.items = items;
  return renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} couponState={couponState} />);
}

/* 주문 버튼은 고른 줄로 주문서 초안을 만든 뒤 이동하는 버튼이다(ADR-0030) — 링크가 아니다. 열렸는지는 disabled 로 본다. */
const CHECKOUT_ENABLED = '<button class="wc-btn primary wc-cart__checkout" type="button">';
const checkoutEnabled = (html: string) => html.includes(CHECKOUT_ENABLED);

function transactionPrecheckout(): GoodsSalesPrecheckoutQuote {
  return { ...goodsSalesPrecheckoutQuote, subtotal: 8000,
    lines: [{ ...goodsSalesPrecheckoutQuote.lines[0], goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }],
    goods: [{ ...goodsSalesPrecheckoutQuote.goods[0], goodId: 'g13', qty: 1, minOrderQty: 1 }],
  };
}

function renderTransaction(couponState: CartCouponState = emptyCouponState) {
  mocks.items = [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }];
  return renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} couponState={couponState} transactionMode="transaction" />);
}

describe('transaction cart product conditions', () => {
  it('uses only the product prequote and defers shipping, coupon and total amounts to checkout', () => {
    mocks.precheckout = transactionPrecheckout();
    const html = renderTransaction();
    expect(mocks.precheckoutEnabled).toBe(true); expect(mocks.legacyEnabled).toBe(false);
    expect(html).toContain('₩8,000'); expect(html).toContain('회원 추가 구매 가능 4개');
    expect(html).toContain('배송지·선불/착불 선택 후 확정');
    expect(html).toContain('주문서에서 할인·배송비 확인 후 표시');
    expect(html).not.toContain('무료'); expect(html).not.toContain('₩3,000'); expect(html).not.toContain('김포 출고');
    expect(checkoutEnabled(html)).toBe(true);
  });
  it('requires a current successful product quote before enabling checkout', () => {
    let html = renderTransaction();
    expect(html).toContain('현재 가격과 구매 조건을 확인하고 있어요.');
    expect(checkoutEnabled(html)).toBe(false);
    mocks.precheckoutError = '현재 가격과 구매 조건을 확인하지 못했습니다.';
    html = renderTransaction();
    expect(html).toContain(mocks.precheckoutError); expect(html).toContain('가격·구매 조건 다시 확인');
    expect(checkoutEnabled(html)).toBe(false); expect(html).not.toContain('가격·배송비 다시 확인');
  });
  it('blocks unavailable stock, member limits and incompatible payment conditions from the server', () => {
    const valid = transactionPrecheckout();
    const cases: [GoodsSalesPrecheckoutQuote, string][] = [
      [{ ...valid, lines: [{ ...valid.lines[0], available: false }] }, '재고가 변경'],
      [{ ...valid, goods: [{ ...valid.goods[0], reason: 'member_purchase_limit_exceeded' }] }, '회원 누적 구매 한도를 초과'],
      [{ ...valid, paymentMethods: { card: false, bankTransfer: false } }, '공통 결제수단이 없어요'],
    ];
    for (const [quote, message] of cases) {
      mocks.precheckout = quote;
      const html = renderTransaction();
      expect(html).toContain(message); expect(checkoutEnabled(html)).toBe(false);
    }
  });
  it('keeps a selected coupon without comparing it with an intentionally absent coupon calculation', () => {
    mocks.precheckout = transactionPrecheckout();
    const html = renderTransaction({ selectedUserCouponId: fix5k.id, coupons: [fix5k] });
    expect(html).toContain('5천원 할인'); expect(html).toContain('주문서에서 확인');
    expect(html).not.toContain('다른 화면에서 선택한 쿠폰이 변경');
    expect(html).not.toContain('최소 주문 금액 미달'); expect(checkoutEnabled(html)).toBe(true);
  });
  it('does not query either contract when runtime availability is unknown', () => {
    mocks.items = [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }];
    const html = renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} couponState={emptyCouponState} transactionMode="unavailable" />);
    expect(mocks.precheckoutEnabled).toBe(false); expect(mocks.legacyEnabled).toBe(false);
    expect(html).toContain('주문 조건을 확인하지 못했습니다.'); expect(checkoutEnabled(html)).toBe(false);
  });
});

describe('Cart 배송비 요약', () => {
  it('임계 미달이면 실제 배송비를 붙이고 남은 금액을 안내한다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
    expect(html).toContain('38,000원 더 담으면 묶음 배송비가 무료예요.');
  });

  it('임계에 도달하면 배송비를 받지 않고 안내를 감춘다', () => {
    mocks.quote = {...defaultQuote,totalFee:0,finalTotalFee:0,groups:[{...gimpoGroup,policySubtotal:60000,policyFee:0,totalFee:0,finalFee:0}]};
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 5 }]);

    expect(html).toContain('₩60,000');
    expect(html).toContain('무료');
    expect(html).not.toContain('더 담으면');
  });
});

describe('Cart 주문 요약 테이블', () => {
  const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);

  it('금액 행을 표로 세운다', () => {
    expect(html).toContain('총 굿즈 금액');
    expect(html).toContain('쿠폰 할인');
    expect(html).toContain('−₩0');
    expect(html).toContain('배송비');
    expect(html).toContain('예상 총액');
    expect(html).toContain('배송 묶음별 배송비를 합산합니다.');
  });

  /* R28(MD-0006)·SHEET-007: 'N개 주문하기' — N은 고른 줄의 수량 합이다(들어오면 전체 선택이라 담긴 총 수량과 같다). */
  it('주문 CTA에 고른 줄의 총 수량을 싣는다', () => {
    expect(html).toContain('<span class="wc-cart__checkout-count">1개 주문하기</span>');
    expect(html).not.toContain('굿즈 주문하기');
    expect(checkoutEnabled(html)).toBe(true);
    const several = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 3 }]);
    expect(several).toContain('<span class="wc-cart__checkout-count">3개 주문하기</span>');
  });
});

describe('Cart 쿠폰 슬롯 (S7)', () => {
  it('보유 쿠폰 select와 코드 입력을 연다', () => {
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 5 }],
      { selectedUserCouponId: null, coupons: [fix5k] },
    );

    expect(html).toContain('<select');
    expect(html).toContain('쿠폰 선택 안 함');
    expect(html).toContain('5천원 할인');
    expect(html).toContain('쿠폰 적용</button>');
  });

  /* R25: 운영(legacy) 주문서도 같은 선택을 보이고, 배송비 쿠폰은 어느 화면에서도 받지 않는다 — 사실대로 안내한다. */
  it('주문서에서도 바꿀 수 있다고 안내하고 배송비 쿠폰을 주문서로 미루지 않는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }], { selectedUserCouponId: null, coupons: [fix5k] });
    expect(html).toContain('주문서에서도 바꿀 수 있어요.');
    expect(html).not.toContain('배송비 쿠폰은 주문서에서 확인');
  });

  it('보유 쿠폰이 없으면 안내와 코드 입력만 둔다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }], emptyCouponState);
    expect(html).toContain('사용할 수 있는 쿠폰이 없어요.');
    expect(html).toContain('id="cart-coupon-code"');
    expect(html).not.toContain('id="cart-coupon-select"');
  });

  it('보유 쿠폰을 불러오지 못했으면 그 사실을 한 번만 알리고 없다고 하지 않는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }], { selectedUserCouponId: null, coupons: [], unavailable: true });
    expect(html.match(/보유 쿠폰을 불러오지 못했습니다/g)).toHaveLength(1);
    expect(html).not.toContain('사용할 수 있는 쿠폰이 없어요');
    expect(html).toContain('id="cart-coupon-code"');
  });

  it('적용된 쿠폰은 할인 행과 예상 총액에 반영된다', () => {
    mocks.quote = {...defaultQuote,totalFee:0,finalTotalFee:0,groups:[{...gimpoGroup,policySubtotal:60000,policyFee:0,totalFee:0,finalFee:0}]};
    mocks.coupon = { userCouponId: fix5k.id, couponCode: 'TEST-COUPON', eligibleSubtotal: 60000, discount: 5000, reason: null };
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 5 }],
      { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
    );

    expect(html).toContain('−₩5,000');
    expect(html).toContain('₩55,000');
    expect(html).toContain('적용 해제');
  });

  it('대상 품목 일부에만 적용된 서버 할인액을 전체 소계로 다시 계산하지 않는다', () => {
    mocks.quote = {...defaultQuote,totalFee:0,finalTotalFee:0,groups:[{...gimpoGroup,policySubtotal:60000,policyFee:0,totalFee:0,finalFee:0}]};
    mocks.coupon = { userCouponId: fix5k.id, couponCode: 'TEST-COUPON', eligibleSubtotal: 1500, discount: 1500, reason: null };
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 5 }], { selectedUserCouponId: fix5k.id, coupons: [fix5k] });
    expect(html).toContain('−₩1,500');
    expect(html).toContain('₩58,500');
    expect(html).not.toContain('−₩5,000');
  });

  it('조건 미달이 되면 할인을 접고 사유를 알린다', () => {
    mocks.coupon = { userCouponId: fix5k.id, couponCode: 'TEST-COUPON', eligibleSubtotal: 12000, discount: 0, reason: 'coupon_min_subtotal' };
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }],
      { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
    );

    expect(html).toContain('−₩0');
    expect(html).toContain('최소 주문 금액');
    expect(html).toContain('₩15,000');
  });

  it.each(['coupon_first_purchase_reserved', 'coupon_first_purchase_pending'])('견적에서 첫구매 주문이 차단돼도 내 주문 링크를 제공한다: %s', (reason) => {
    mocks.coupon = { userCouponId: fix5k.id, couponCode: 'FIRST', eligibleSubtotal: 12000, discount: 0, reason };
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }],
      { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
    );
    /* DB가 결제 대기 주문 때문이라고 알린 쿠폰 막힘은 진행 중인 주문 목록으로 잇는다(#540, 무통장 입금 대기 포함). */
    expect(html).toContain('href="/orders?pending=1"');
    /* 결제 대기 주문 취소(ADR-0030)는 그 주문을 실제로 찾았을 때만 보인다 — 정적 렌더에서는 아직 읽지 않았다. 화면을 열기만
       해서는 다른 탭 결제를 끊지 않는다. */
    expect(html).not.toContain('결제 대기 주문 취소하고 계속');
    expect(checkoutEnabled(html)).toBe(false);
  });

  it('로그인 전에는 컨트롤 대신 안내만 둔다', () => {
    mocks.mode = 'local';
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }], emptyCouponState);
    mocks.mode = 'server';

    expect(html).toContain('로그인하면 보유 쿠폰을 적용할 수 있어요.');
    expect(html).not.toContain('<select');
  });
});

describe('Cart 라인 상태', () => {
  it('카탈로그에서 사라진 굿즈는 판매 종료로 두고 주문을 막는다', () => {
    const html = render([{ goodId: 'gone', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('판매 종료');
    expect(html).toContain('주문할 수 없는 굿즈 1개는 주문에서 빠져요.');
    /* 고를 수 있는 줄이 하나도 없으니 주문할 줄도 없다. */
    expect(html).toContain('<button class="wc-btn primary wc-cart__checkout" disabled="" type="button"><span class="wc-cart__checkout-count">0개 주문하기</span></button>');
    expect(checkoutEnabled(html)).toBe(false);
  });

  it('품절 라인은 수량 스테퍼 없이 상태만 알린다', () => {
    const html = render([{ goodId: 'g14', variantId: SOLD_VARIANT, qty: 1 }]);

    expect(html).toContain('품절');
    expect(html).not.toContain('wc-stepper');
    expect(html).toContain('품절된 키링 장바구니에서 삭제');
  });

  it('구매 가능한 라인은 수량 스테퍼와 재고 상한을 준다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 2 }]);

    expect(html).toContain('wc-stepper');
    expect(html).toContain('홍실 아크릴 블록 수량');
    expect(html).toContain('href="/shop/g13"');
  });
});

describe('Cart 랜덤 판매·옵션별 구매 제한 품목 줄', () => {
  it('랜덤 판매 굿즈는 옵션명을 랜덤으로 보이고 수량 상한은 풀 합계다', () => {
    const html = render([{ goodId: 'g15', variantId: RANDOM_VARIANT, qty: 6 }]);
    expect(html).toContain('<p class="wc-cart__line-option">랜덤</p>');
    expect(html).toMatch(/aria-disabled="true" aria-label="수량 늘리기"/);
  });

  it('랜덤 전환 전에 다른 옵션 키로 담은 줄도 판매 종료가 아니라 랜덤 줄로 보인다', () => {
    const html = render([{ goodId: 'g15', variantId: '00000000-0000-4000-8000-0000000000ee', qty: 1 }]);
    expect(html).toContain('<p class="wc-cart__line-option">랜덤</p>');
    expect(html).not.toContain('판매 종료');
  });

  it('랜덤 전환 전에 담은 줄은 수량 스테퍼 대신 다시 담기로 키 줄에 합치게 한다(키 줄은 그대로 스테퍼)', () => {
    const html = render([{ goodId: 'g15', variantId: RANDOM_VARIANT, qty: 1 }, { goodId: 'g15', variantId: '00000000-0000-4000-8000-0000000000ee', qty: 2 }]);
    expect(html.match(/wc-stepper"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="랜덤 포토카드 랜덤 한 줄로 다시 담기"');
    expect(html).toContain('판매 방식이 바뀌기 전에 담은 줄이에요. 다시 담으면 랜덤 한 줄로 합쳐집니다.');
    expect(html).toContain('랜덤 포토카드 장바구니에서 삭제');
  });

  it('옵션별 주문당 최대 수량이 스테퍼 상한이다', () => {
    const html = render([{ goodId: 'g16', variantId: BLUE_VARIANT, qty: 2 }]);
    expect(html).toMatch(/aria-disabled="true" aria-label="수량 늘리기"/);
    expect(html).not.toContain('까지 주문할 수 있습니다');
  });

  /* 견적이 판정한 불가 줄은 체크된 채 남아 전체 주문을 막지 않는다 — 선택에서 빼고 사유를 줄에 보인다(ADR-0030 확정 동작 2). */
  /* 구매 조건은 이번 선택의 수량 문제다 — 줄을 비활성으로 빼지 않고 체크만 풀어 사유를 보인다. 다시 고르면 다시 견적한다. */
  it('견적이 옵션 한도 위반을 알리면 그 줄의 체크만 풀고 품목 줄에 확정 카피를 보인다', () => {
    mocks.quoteLineExtras.set(BLUE_VARIANT, { optionLimit: { orderMaxQty: 2, memberMaxQty: 3, memberReservedQty: 2, memberRemainingQty: 1,
      reason: 'option_member_limit_exceeded' } });
    const html = render([{ goodId: 'g16', variantId: BLUE_VARIANT, qty: 2 }]);
    expect(html).toContain('&#x27;파랑&#x27;은 1인당 3개까지 구매할 수 있습니다.');
    expect(html).toContain('구매 조건에 맞지 않는 굿즈 1개는 체크를 풀었어요');
    expect(html).not.toContain('주문할 수 없는 굿즈');
    expect(html).toMatch(/<input aria-label="아크릴 키링[^"]*선택" type="checkbox"\/>/);
    expect(checkoutEnabled(html)).toBe(false);
  });

  it('굿즈 주문당 최대 수량을 넘으면 그 굿즈 줄의 체크만 풀고, 다른 굿즈는 주문할 수 있다', () => {
    mocks.quoteGoods.set('g13', { orderQuantityLimitEnabled: true, minOrderQty: 1, maxOrderQty: 2, reason: 'order_quantity_above_maximum' });
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 3 }, { goodId: 'g16', variantId: BLUE_VARIANT, qty: 1 }]);
    expect(html).toContain('주문당 최대 2개까지 구매할 수 있어요. 옵션을 합해 2개 이하로 골라주세요.');
    expect(html).toMatch(/<input aria-label="홍실 아크릴 블록[^"]*선택" type="checkbox"\/>/);
    expect(html).toMatch(/<input aria-label="아크릴 키링[^"]*선택" type="checkbox" checked=""\/>/);
    expect(html).not.toContain('주문할 수 없는 굿즈');
    /* 낡은 막힘 문구가 남지 않는다 — 남은 고른 줄만 견적한다. */
    expect(mocks.quotedItems.map((item) => item.goodId)).toEqual(['g16']);
    expect(checkoutEnabled(html)).toBe(true);
    expect(html).toContain('1개 주문하기');
  });

  it('회원 누적 한도에 도달했으면 수량 조정을 권하지 않는다', () => {
    mocks.quoteGoods.set('g13', { memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 3, memberReservedQty: 3, memberRemainingQty: 0,
      reason: 'member_purchase_limit_exceeded' });
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('회원 누적 구매 한도(3개)에 도달했어요.');
    expect(html).not.toContain('수량을 줄');
    /* 결제 대기 주문을 실제로 찾기 전에는 해소 안내를 그리지 않는다 — 사유만 보인다. */
    expect(html).not.toContain('결제 대기 주문 취소하고 계속');
  });

  it('화면을 연 뒤 재고가 줄어든 줄은 빼고 나머지 줄로 주문할 수 있다', () => {
    mocks.quoteLineExtras.set(BLUE_VARIANT, { available: false, supply: { mode: 'stock', availableQty: 1, policyId: null, policyRevision: null, state: 'stock',
      startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: null } });
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }, { goodId: 'g16', variantId: BLUE_VARIANT, qty: 2 }]);
    expect(html).toContain('재고가 1개만 남아 이번 주문에서 빠졌어요. 수량을 줄이면 다시 고를 수 있어요.');
    expect(html).toContain('주문할 수 없는 굿즈 1개는 주문에서 빠져요. 수량을 줄이면 다시 고를 수 있어요.');
    /* 막힘 판정은 남은 고른 줄로만 한다 — 남은 줄(g13)은 주문할 수 있다. */
    expect(html).not.toContain('현재 판매 상태나 재고가 변경된 굿즈가 있어요');
    expect(mocks.quotedItems.map((item) => item.goodId)).toEqual(['g13']);
    expect(checkoutEnabled(html)).toBe(true);
    expect(html).toContain('1개 주문하기');
  });
});

describe('Cart 빈 상태 (CT-02)', () => {
  it('굿즈샵으로 돌려보낸다', () => {
    const html = render([]);

    expect(html).toContain('장바구니가 비어 있어요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-cart__summary');
  });

  /* 서버 렌더·첫 페인트는 굿즈샵이다 — 직전에 보던 목록 주소는 하이드레이션 뒤 탭 세션에서 읽는다(lib/listing-return). */
  it('16/400 안내 다음 액센트 CTA 하나를 고정 바 묶음에 담고, 일러스트(LG-7)가 없으면 자리를 그리지 않는다', () => {
    const html = render([]);

    expect(html).toContain('<p class="wc-cart__empty-message">장바구니가 비어 있어요</p>');
    expect(html).toMatch(/<div class="wc-cart__cta-bar"><a class="wc-btn accent wc-cart__empty-cta" href="\/shop">굿즈샵 둘러보기<\/a><\/div>/);
    expect(html.indexOf('wc-cart__empty-message')).toBeLessThan(html.indexOf('wc-cart__empty-cta'));
    expect(html).not.toContain('wc-cart__empty-art');
    expect(checkoutEnabled(html)).toBe(false);
  });
});

describe('Cart 모바일 크롬 (CT-03)', () => {
  /* 990px 미만에서는 서브헤더가 전역 헤더를 대신한다(CSS). 제목은 h1 과 같은 말이라 보조기기에는 감춘다. */
  it('[이전 페이지] 버튼·제목·[홈] 링크 서브헤더를 화면 맨 앞에 두고 h1 은 유지한다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    const subheader = html.slice(html.indexOf('<nav aria-label="장바구니 상단 메뉴"'), html.indexOf('</nav>') + 6);

    expect(subheader).toContain('class="wc-cart-subheader"');
    expect(subheader).toMatch(/<button aria-label="이전 페이지" class="wc-cart-subheader__btn wc-cart-subheader__back" type="button">/);
    expect(subheader).toContain('<p aria-hidden="true" class="wc-cart-subheader__title">장바구니</p>');
    expect(subheader).toMatch(/<a aria-label="홈" class="wc-cart-subheader__btn" href="\/">/);
    expect(html.indexOf('wc-cart-subheader')).toBeLessThan(html.indexOf('<h1 class="wc-cart__title">장바구니</h1>'));
  });

  it('불러오는 중에도 서브헤더는 남고 주문 바는 없다', () => {
    mocks.ready = false;
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('wc-cart-subheader');
    expect(html).toContain('장바구니를 불러오는 중이에요.');
    expect(html).not.toContain('wc-cart__cta-bar');
  });

  /* 라우트 로딩 경계가 루트 경계(굿즈 그리드 스켈레톤·전역 헤더)를 대신한다 — 모바일 첫 페인트부터 서브헤더 크롬이고,
     본문이 오면 같은 자리의 같은 블록으로 바뀌어 헤더 교체·본문 점프가 없다(L9 QA 첫 페인트). */
  it('라우트 로딩 경계는 카트 첫 렌더와 같은 서브헤더·제목·불러오는 중 블록을 그린다', () => {
    mocks.ready = false;
    const cart = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    const loading = renderToStaticMarkup(<CartLoading />);
    const frame = (html: string) => html.slice(html.indexOf('<nav aria-label="장바구니 상단 메뉴"'), html.indexOf('</p></div>') + 10);

    expect(frame(loading)).toContain('class="wc-cart-subheader"');
    expect(frame(loading)).toContain('<h1 class="wc-cart__title">장바구니</h1><p aria-live="polite" class="wc-cart__loading" role="status">장바구니를 불러오는 중이에요.</p>');
    expect(frame(loading)).toBe(frame(cart));
    expect(loading).toMatch(/^<div aria-busy="true" class="wc-root wc-cart">/);
    expect(loading).not.toContain('wc-loading__grid');
    expect(loading).not.toContain('wc-cart__cta-bar');
  });

  /* SHEET-007: 모바일 바도 데스크톱과 같은 'N개 주문하기'다 — 금액은 바 위 요약 표가 보인다. */
  it('주문 CTA 를 고정 바 묶음에 담고 예상 총액이 확정돼도 수량 문구만 싣는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    const bar = html.slice(html.indexOf('<div class="wc-cart__cta-bar">'));

    expect(bar.startsWith('<div class="wc-cart__cta-bar"><button class="wc-btn primary wc-cart__checkout" type="button"><span class="wc-cart__checkout-count">1개 주문하기</span></button></div>')).toBe(true);
    expect(html).not.toContain('wc-cart__checkout-amount');
    expect(html).not.toContain('wc-cart__checkout--amount');
    expect(html).toContain('<td class="wc-cart__total">₩15,000</td>');
  });

  it('배송비가 확정되지 않았거나 주문서 계약이어도 같은 수량 문구다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'address_required', finalFee: null, regionalFee: null }] };
    let html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(checkoutEnabled(html)).toBe(true);
    expect(html).not.toContain('wc-cart__checkout-amount');

    mocks.precheckout = transactionPrecheckout();
    html = renderTransaction();
    expect(html).toContain('<span class="wc-cart__checkout-count">1개 주문하기</span>');
    expect(html).not.toContain('wc-cart__checkout-amount');
  });

  it('주문할 수 없는 카트의 바는 잠긴 버튼이다', () => {
    const html = render([{ goodId: 'gone', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('<div class="wc-cart__cta-bar"><button class="wc-btn primary wc-cart__checkout" disabled="" type="button">');
    expect(checkoutEnabled(html)).toBe(false);
  });
});

describe('Cart 요약 박스 (CT-01)', () => {
  it('예상 총액이 금액이면 강조 칸(wc-cart__total)에 기존 계산값을 그대로 싣는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('<td class="wc-cart__total">₩15,000</td>');
    expect(html).not.toContain('wc-cart__total--pending');
  });

  it('안내 문구면 금액 서체로 키우지 않는 칸(--pending)에 둔다', () => {
    mocks.quote = null;
    let html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('<td class="wc-cart__total wc-cart__total--pending">배송비 확인 후 표시</td>');

    mocks.precheckout = transactionPrecheckout();
    html = renderTransaction();
    expect(html).toContain('<td class="wc-cart__total wc-cart__total--pending">주문서에서 할인·배송비 확인 후 표시</td>');
  });
});

describe('Cart 목록 행 (CT-04)', () => {
  const lineOf = (html: string, marker: string) => html.split('<li class="wc-cart__line').find((chunk) => chunk.includes(marker)) ?? '';

  it('브랜드·이름·단가 다음 옵션 밴드에 옵션·수량·삭제를 두고, 줄 금액은 밴드 뒤에 둔다', () => {
    const options = [
      { id: '00000000-0000-4000-8000-000000000001', name: '파랑', price: 12000, stockQty: 2, code: 'BLUE', attributes: {}, isDefault: true },
      { id: '00000000-0000-4000-8000-000000000002', name: '빨강', price: 15000, stockQty: 3, code: 'RED', attributes: {}, isDefault: false },
    ];
    mocks.items = [{ goodId: 'g13', variantId: options[1].id, qty: 2 }];
    mocks.quotePrices = new Map(options.map((option) => [option.id, option.price]));
    const html = renderToStaticMarkup(<Cart catalog={{ goods: [{ ...goods[0], options }], ips: [] }} couponState={emptyCouponState} />);
    const line = lineOf(html, '빨강');
    const band = line.slice(line.indexOf('<div class="wc-cart__line-band">'), line.indexOf('<p class="wc-cart__line-total">'));

    expect(line.indexOf('wc-cart__line-media')).toBeLessThan(line.indexOf('wc-cart__line-info'));
    expect(line.indexOf('wc-cart__line-name')).toBeLessThan(line.indexOf('wc-price'));
    expect(line.indexOf('wc-price')).toBeLessThan(line.indexOf('wc-cart__line-band'));
    expect(band).toContain('<div class="wc-cart__line-detail"><p class="wc-cart__line-option">빨강</p></div>');
    expect(band).toContain('aria-label="홍실 아크릴 블록 수량"');
    expect(band).toContain('aria-label="홍실 아크릴 블록 장바구니에서 삭제"');
    expect(band.indexOf('wc-stepper')).toBeLessThan(band.indexOf('wc-cart__remove'));
    expect(line).toContain('<p class="wc-cart__line-total">₩30,000</p>');
  });

  it('직접 입력 값은 옵션과 함께 밴드 왼쪽에 둔다', () => {
    const fieldId = '00000000-0000-4000-8000-0000000000f1';
    mocks.items = [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1, customInputs: { revision: 1, fields: [{ id: fieldId, name: '각인 문구', value: 'ICONS' }] } }];
    const customGood: Good = { ...goods[0], customInputs: { enabled: true, revision: 1, fields: [{ id: fieldId, name: '각인 문구', active: true }] } };
    const html = renderToStaticMarkup(<Cart catalog={{ goods: [customGood], ips: [] }} couponState={emptyCouponState} />);
    const line = lineOf(html, '각인 문구');

    expect(line).toMatch(/<div class="wc-cart__line-detail"><dl class="wc-custom-inputs-summary"><div><dt>각인 문구<\/dt><dd>ICONS<\/dd><\/div><\/dl><\/div>/);
    expect(line).not.toContain('wc-cart__line-state');
    expect(line).toContain('wc-stepper');
  });

  it('품절 라인의 밴드는 수량 없이 삭제만, 판매 종료 라인도 밴드에 삭제를 둔다', () => {
    let html = render([{ goodId: 'g14', variantId: SOLD_VARIANT, qty: 1 }]);
    let band = lineOf(html, '품절된 키링');
    expect(band).not.toContain('wc-stepper');
    expect(band).toMatch(/<div class="wc-cart__line-band"><div class="wc-cart__line-detail"><\/div><button aria-label="품절된 키링 장바구니에서 삭제" class="wc-cart__remove"/);

    html = render([{ goodId: 'gone', variantId: DEFAULT_VARIANT, qty: 1 }]);
    band = lineOf(html, '판매 종료된 굿즈 (gone)');
    expect(band).toMatch(/<div class="wc-cart__line-band"><div class="wc-cart__line-detail"><\/div><button aria-label="판매 종료된 굿즈 gone 삭제" class="wc-cart__remove"/);
  });
});


/* 같은 굿즈의 옵션·직접입력 줄을 화면 읽기 프로그램이 구별하도록 체크박스 이름에 옵션·직접입력 요약을 더한다(ADR-0030). */
describe('Cart 줄 체크박스 이름', () => {
  it('굿즈 이름에 옵션과 직접입력 요약을 더한다', () => {
    const html = render([{ goodId: 'g16', variantId: BLUE_VARIANT, qty: 1 }]);
    expect(html).toContain('aria-label="아크릴 키링 · 파랑 선택"');
  });
});

describe('origin quote and option lines', () => {
  it('keeps each origin fee and free-shipping remainder separate', () => {
    mocks.items=[{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1},{goodId:'g14',variantId:SOLD_VARIANT,qty:1}];
    mocks.quote={...defaultQuote,totalFee:7000,finalTotalFee:7000,groups:[{...gimpoGroup,carrierLabel:'한진택배'},{...gimpoGroup,originId:'namyangju',originCode:'NAMYANGJU',originName:'남양주',carrierCode:'epost',carrierLabel:'우체국택배',baseFee:4000,policyFee:4000,totalFee:4000,finalFee:4000,policySubtotal:9000,freeThreshold:30000}]};
    const html=renderToStaticMarkup(<Cart catalog={{goods:[goods[0],{...goods[1],stock:'ok',stockQty:5,originId:'namyangju',options:goods[1].options!.map(option=>({...option,stockQty:5}))}],ips:[]}} couponState={emptyCouponState} />);
    /* 고객 화면은 출고지 이름 대신 택배사로 부른다(10/14 회의 S7 · R26). 묶음이 둘이면 따로 계산되는 이유를 한 줄로(R27). */
    expect(html).toContain('<h2>한진택배 배송</h2>');expect(html).toContain('<h2>우체국택배 배송</h2>');
    expect(html).toContain('aria-label="한진택배 배송 굿즈"');
    expect(html).toContain('택배사가 달라 배송비가 각각 계산됩니다.');
    expect(html.indexOf('택배사가 달라')).toBeLessThan(html.indexOf('<h2>한진택배 배송</h2>'));
    expect(html).not.toContain('김포');expect(html).not.toContain('남양주');
    expect(html).toContain('38,000원 더 담으면');expect(html).toContain('21,000원 더 담으면');
    expect(html).toContain('₩7,000');expect(html).toContain('₩28,000');
  });
  it('묶음이 하나면 이유 줄 없이 택배사 이름만, 택배사를 모르면 택배 배송으로 부른다', () => {
    const one=render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}]);
    expect(one).toContain('<h2>택배 배송</h2>');
    expect(one).not.toContain('배송비가 각각 계산됩니다');
    mocks.quote={...defaultQuote,groups:[{...gimpoGroup,carrierLabel:'한진택배'}]};
    expect(render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}])).toContain('<h2>한진택배 배송</h2>');
  });
  /* 배송 묶음 머리·순서는 카탈로그(굿즈의 출고지·줄 순서)로 정한다 — 고른 줄의 견적에 없는 묶음(해제한 줄)도 머리를 유지한다. */
  it('견적에 없는 묶음도 카탈로그 출고지로 머리를 두고 줄을 그 묶음 안에 둔다', () => {
    mocks.items=[{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1},{goodId:'g14',variantId:SOLD_VARIANT,qty:1}];
    mocks.quote={...defaultQuote,groups:[{...gimpoGroup,carrierLabel:'한진택배'}]};
    const html=renderToStaticMarkup(<Cart catalog={{goods:[goods[0],{...goods[1],stock:'ok',stockQty:5,originId:'namyangju',options:goods[1].options!.map(option=>({...option,stockQty:5}))}],ips:[]}} couponState={emptyCouponState} />);
    expect(html).toContain('<h2>한진택배 배송</h2>');
    expect(html).toContain('<h2>택배 배송</h2>');
    expect(html.indexOf('<h2>한진택배 배송</h2>')).toBeLessThan(html.indexOf('<h2>택배 배송</h2>'));
    /* 견적에 없는 묶음의 줄은 묶음 밖 목록으로 흩어지지 않는다. */
    const second = html.slice(html.indexOf('<h2>택배 배송</h2>'));
    expect(second.indexOf('품절된 키링')).toBeLessThan(second.indexOf('</section>'));
  });
  /* 첫 견적 전에는 택배사 이름을 모르므로 묶지 않는다 — 이름 없는 머리가 잠깐 보였다 바뀌지 않게. */
  it('첫 견적 전에는 배송 묶음 머리를 그리지 않는다', () => {
    mocks.quote=null;
    expect(render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}])).not.toContain('wc-shipping-group');
  });
  it('blocks checkout while the current cart has no server quote', () => {
    mocks.quote=null;
    const html=render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}]);
    expect(html).toContain('배송비 확인 후 표시');expect(checkoutEnabled(html)).toBe(false);
  });
  it('배송지를 아직 받지 않은 장바구니는 금액 확정을 미루고 주문서 진입을 허용한다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'address_required', finalFee: null, regionalFee: null }] };
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('배송지 입력 후 확정');
    expect(html).not.toContain('₩15,000');
    expect(checkoutEnabled(html)).toBe(true);
  });
  it('정책이 중지된 배송 견적은 확인 없이 주문서로 넘기지 않는다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'policy_unavailable', finalFee: null, regionalFee: null }] };
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('현재 배송비를 확인 중입니다');
    expect(checkoutEnabled(html)).toBe(false);
  });
  it('shows separate option names and prices for the same good', () => {
    const options=[
      {id:'00000000-0000-4000-8000-000000000001',name:'파랑',price:12000,stockQty:2,code:'BLUE',attributes:{},isDefault:true},
      {id:'00000000-0000-4000-8000-000000000002',name:'빨강',price:15000,stockQty:3,code:'RED',attributes:{},isDefault:false},
    ];
    mocks.items=options.map(option=>({goodId:'g13',variantId:option.id,qty:1}));
    mocks.quotePrices = new Map(options.map(option => [option.id, option.price]));
    const html=renderToStaticMarkup(<Cart catalog={{goods:[{...goods[0],options}],ips:[]}} couponState={emptyCouponState} />);
    expect(html).toContain('파랑');expect(html).toContain('빨강');
    expect(html).toContain('₩15,000');expect(html).toContain('₩27,000');
  });
  /* 소비자가 12,000원 → 할인가 10,800원. 옵션가는 할인하지 않으므로 줄마다 정가는 소비자가 + 옵션가이고,
     기간 할인 중인 옵션만 그 옵션의 정상가와 비교한다. 결제 금액은 서버 견적 그대로다. */
  it('옵션가가 다른 줄마다 그 옵션의 정가와 할인율을 보인다', () => {
    const period = { pricePeriodId: '00000000-0000-4000-8000-000000000305', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z' };
    const options = [
      { id: '00000000-0000-4000-8000-000000000301', name: '기본형', price: 10800 },
      { id: '00000000-0000-4000-8000-000000000302', name: '추가 500원', price: 11300 },
      { id: '00000000-0000-4000-8000-000000000303', name: '추가 3,000원', price: 13800 },
      { id: '00000000-0000-4000-8000-000000000304', name: '기간 할인', price: 12000,
        pricing: { regularPrice: 13800, effectivePrice: 12000, calculatedAt: '2026-10-08T00:00:00Z', ...period } },
    ].map((option, index) => ({ ...option, code: `G13-${index}`, stockQty: 5, attributes: {}, isDefault: index === 0 }));
    mocks.items = options.map(option => ({ goodId: 'g13', variantId: option.id, qty: 1 }));
    mocks.quotePrices = new Map(options.map(option => [option.id, option.price]));
    mocks.quotePeriods.set(options[3].id, { regularPrice: 13800, ...period });
    const catalogGood = { ...goods[0], price: 10800, priceMax: 13800, catalogPrice: 10800, catalogCompareAtPrice: 12000, compareAtPrice: 12000, options };
    const html = renderToStaticMarkup(<Cart catalog={{ goods: [catalogGood], ips: [] }} couponState={emptyCouponState} />);
    /* 줄마다 그 줄의 <li> 를 찾아 옵션 밴드 앞(정보 칸)만 본다 — 단가 블록은 정보 칸에 있다(CT-04). 밴드 뒤의 줄 금액
       (qty 1 이면 판매가와 같은 값)까지 넣으면 단가 블록이 판매가를 빠뜨려도 단언이 통과한다. */
    const linePrice = (name: string) => (html.split('<li class="wc-cart__line').find((chunk) => chunk.includes(`<p class="wc-cart__line-option">${name}</p>`)) ?? '')
      .split('<div class="wc-cart__line-band">')[0];

    expect(linePrice('기본형')).toMatch(/₩12,000<\/s>.*>10%<.*>₩10,800</);
    expect(linePrice('추가 500원')).toMatch(/₩12,500<\/s>.*>10%<.*>₩11,300</);
    expect(linePrice('추가 3,000원')).toMatch(/₩15,000<\/s>.*>8%<.*>₩13,800</);
    expect(linePrice('기간 할인')).toMatch(/₩13,800<\/s>.*>13%<.*>₩12,000</);
  });
});

 it('이관 불가한 이전 굿즈의 수량과 명시적 삭제·재시도를 남기며 주문을 막는다', () => {
  mocks.items = [];
  mocks.legacyItems = [{ goodId: 'old-good', qty: 3 }];
  mocks.ready = false;
  const html = renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} couponState={emptyCouponState} />);
  expect(html).toContain('old-good');
  expect(html).toContain('3개');
  expect(html).toContain('이 항목 삭제');
  expect(html).toContain('다시 확인');
  expect(checkoutEnabled(html)).toBe(false);
  expect(html).not.toContain('장바구니가 비어 있어요');
 });

/* 선택 주문(ADR-0030 · 1014-031·032): 견적·쿠폰 대상 소계·배송비·주문 버튼 N은 고른 줄 기준이다. */
describe('Cart 선택 주문', () => {
  it('들어오면 고를 수 있는 줄 전부를 견적하고, 주문할 수 없는 줄은 견적·주문에서 빠질 뿐 주문을 막지 않는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 2 }, { goodId: 'g14', variantId: SOLD_VARIANT, qty: 1 }]);
    expect(mocks.quotedItems).toEqual([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 2 }]);
    expect(html).toContain('주문할 수 없는 굿즈 1개는 주문에서 빠져요.');
    expect(html).toContain('<button class="wc-btn primary wc-cart__checkout" type="button"><span class="wc-cart__checkout-count">2개 주문하기</span></button>');
    /* 총 굿즈 금액도 고른 줄(아크릴 블록 2개)만이다 — 품절 키링 9,000원은 들지 않는다. */
    expect(html).toContain('<th scope="row">총 굿즈 금액</th><td>₩24,000</td>');
    expect(html).toContain('고른 굿즈만 주문해요. 고르지 않은 굿즈는 결제 뒤에도 장바구니에 남아요.');
  });

  it('모든 줄이 주문 가능하고 전부 골랐으면 선택 안내를 띄우지 않는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(mocks.quotedItems).toEqual([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).not.toContain('고른 굿즈만 주문해요.');
    expect(html).not.toContain('wc-cart__warning');
  });
});

/* 선택 바·줄 체크(ADR-0030 · 10/14 회의 1014-031·035·036). 진입 시 전체 체크이고, 주문할 수 없는 줄은 체크할 수 없다. */
describe('Cart 선택 바', () => {
  const lineOf = (html: string, marker: string) => html.split('<li class="wc-cart__line').find((chunk) => chunk.includes(marker)) ?? '';

  it('들어오면 고를 수 있는 줄이 모두 체크된 채 열리고 전체 선택·선택 삭제·전체 비우기를 목록 위에 둔다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }, { goodId: 'g14', variantId: SOLD_VARIANT, qty: 1 }]);
    const bar = html.slice(html.indexOf('<div class="wc-cart__select-bar">'), html.indexOf('<section class="wc-shipping-group"'));
    expect(bar).toContain('<label class="wc-cart__select-all"><input type="checkbox" checked=""/><span>전체 선택 (1/1)</span></label>');
    expect(bar).toContain('<button class="wc-cart__select-action" type="button">선택 삭제</button>');
    expect(bar).toContain('<button aria-expanded="false" class="wc-cart__select-action" type="button">전체 비우기</button>');
    /* 확인은 누른 뒤에만 연다. */
    expect(html).not.toContain('wc-cart__clear-confirm');
    expect(lineOf(html, '홍실 아크릴 블록')).toContain('<label class="wc-cart__line-check"><input aria-label="홍실 아크릴 블록 선택" type="checkbox" checked=""/></label>');
  });

  it('품절·판매 종료·성인 인증 전 줄은 체크할 수 없고 선택 수에 들지 않는다', () => {
    const html = render([{ goodId: 'g14', variantId: SOLD_VARIANT, qty: 1 }, { goodId: 'gone', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(lineOf(html, '품절된 키링')).toContain('<input aria-label="품절된 키링 선택" disabled="" type="checkbox"/>');
    expect(lineOf(html, '판매 종료된 굿즈 (gone)')).toContain('<input aria-label="판매 종료된 굿즈 gone 선택" disabled="" type="checkbox"/>');
    /* 고를 줄이 없으면 전체 선택도 잠기고 선택 삭제는 할 일이 없다. 전체 비우기는 남는다. */
    expect(html).toContain('<input disabled="" type="checkbox"/><span>전체 선택 (0/0)</span>');
    expect(html).toContain('<button class="wc-cart__select-action" disabled="" type="button">선택 삭제</button>');
    expect(html).toContain('<button aria-expanded="false" class="wc-cart__select-action" type="button">전체 비우기</button>');
  });
});
