import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, LegacyCartItem } from '@/lib/cart';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good } from '@/lib/data';
import type { AddressShippingQuote } from '@/lib/shipping-regions';
import type { CouponQuote } from '@/lib/coupon-targeting';
import type { GoodsSalesPrecheckoutQuote, GoodsSalesQuoteLine } from '@/lib/goods-sales';
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
  coupon: null as CouponQuote | null,
  precheckout: null as GoodsSalesPrecheckoutQuote | null,
  precheckoutError: null as string | null,
  legacyEnabled: false,
  precheckoutEnabled: false,
}));

vi.mock('@/components/shop/useShippingQuote', () => ({
  useShippingQuote: (_items: readonly CartItem[], enabled: boolean) => {
    mocks.legacyEnabled = enabled;
    return {quote:enabled ? mocks.quote : null,sales:enabled && mocks.quote ? {
    calculatedAt:'2026-09-10T00:00:00Z', shipping:mocks.quote,
    subtotal:mocks.items.reduce((sum,item)=>sum+(mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0)*item.qty,0),
    lines:mocks.items.map(item=>({...item,regularPrice:mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0,effectivePrice:mocks.quotePrices.get(item.variantId) ?? goods.find(good=>good.id===item.goodId)?.price??0,pricePeriodId:null,startsAt:null,endsAt:null,...mocks.quotePeriods.get(item.variantId),available:true,...mocks.quoteLineExtras.get(item.variantId)})),
    goods:[],paymentMethods:{card:true,bankTransfer:true},
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
  mocks.quote = defaultQuote; mocks.legacyItems = []; mocks.ready = true; mocks.quotePrices.clear(); mocks.quotePeriods.clear(); mocks.quoteLineExtras.clear(); mocks.coupon = null;
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
    expect(html).toContain('href="/checkout"');
  });
  it('requires a current successful product quote before enabling checkout', () => {
    let html = renderTransaction();
    expect(html).toContain('현재 가격과 구매 조건을 확인하고 있어요.');
    expect(html).not.toContain('href="/checkout"');
    mocks.precheckoutError = '현재 가격과 구매 조건을 확인하지 못했습니다.';
    html = renderTransaction();
    expect(html).toContain(mocks.precheckoutError); expect(html).toContain('가격·구매 조건 다시 확인');
    expect(html).not.toContain('href="/checkout"'); expect(html).not.toContain('가격·배송비 다시 확인');
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
      expect(html).toContain(message); expect(html).not.toContain('href="/checkout"');
    }
  });
  it('keeps a selected coupon without comparing it with an intentionally absent coupon calculation', () => {
    mocks.precheckout = transactionPrecheckout();
    const html = renderTransaction({ selectedUserCouponId: fix5k.id, coupons: [fix5k] });
    expect(html).toContain('5천원 할인'); expect(html).toContain('주문서에서 확인');
    expect(html).not.toContain('다른 화면에서 선택한 쿠폰이 변경');
    expect(html).not.toContain('최소 주문 금액 미달'); expect(html).toContain('href="/checkout"');
  });
  it('does not query either contract when runtime availability is unknown', () => {
    mocks.items = [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }];
    const html = renderToStaticMarkup(<Cart catalog={{ goods, ips: [] }} couponState={emptyCouponState} transactionMode="unavailable" />);
    expect(mocks.precheckoutEnabled).toBe(false); expect(mocks.legacyEnabled).toBe(false);
    expect(html).toContain('주문 조건을 확인하지 못했습니다.'); expect(html).not.toContain('href="/checkout"');
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

  it('주문 CTA에 담긴 수량을 싣는다', () => {
    expect(html).toContain('1개 굿즈 주문하기');
    expect(html).toContain('href="/checkout"');
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
    expect(html).toContain('href="/orders?pending=1"');
    expect(html).toContain('진행 중인 주문 확인');
    expect(html).not.toContain('href="/checkout"');
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
    expect(html).toContain('주문할 수 없는 굿즈 1개');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/checkout"');
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

  it('견적이 옵션 한도 위반을 알리면 품목 줄에 확정 카피를 보이고 주문을 막는다', () => {
    mocks.quoteLineExtras.set(BLUE_VARIANT, { optionLimit: { orderMaxQty: 2, memberMaxQty: 3, memberReservedQty: 2, memberRemainingQty: 1,
      reason: 'option_member_limit_exceeded' } });
    const html = render([{ goodId: 'g16', variantId: BLUE_VARIANT, qty: 2 }]);
    expect(html).toContain('&#x27;파랑&#x27;은 1인당 3개까지 구매할 수 있습니다.');
    expect(html).toContain('1인당 구매 수량이 정해진 옵션이 있어요.');
    expect(html).not.toContain('href="/checkout"');
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
    expect(html).not.toContain('href="/checkout"');
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

  /* 모바일 바는 예상 총액이 확정된 동안만 금액을 싣는다 — 같은 기존 계산값이고, 데스크톱 문구(수량)는 그대로 남는다. */
  it('주문 CTA 를 고정 바 묶음에 담고 예상 총액이 확정되면 "₩금액 주문하기" 문구를 함께 싣는다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    const bar = html.slice(html.indexOf('<div class="wc-cart__cta-bar">'));

    expect(bar).toMatch(/^<div class="wc-cart__cta-bar"><a class="wc-btn primary wc-cart__checkout wc-cart__checkout--amount" href="\/checkout">/);
    expect(bar).toContain('<span class="wc-cart__checkout-count">1개 굿즈 주문하기</span>');
    expect(bar).toContain('<span class="wc-cart__checkout-amount">₩15,000 주문하기</span>');
  });

  it('배송비가 확정되지 않았거나 주문서 계약이면 금액 문구 없이 수량 문구만 싣는다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'address_required', finalFee: null, regionalFee: null }] };
    let html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('class="wc-btn primary wc-cart__checkout" href="/checkout"');
    expect(html).not.toContain('wc-cart__checkout-amount');

    mocks.precheckout = transactionPrecheckout();
    html = renderTransaction();
    expect(html).toContain('<span class="wc-cart__checkout-count">1개 굿즈 주문하기</span>');
    expect(html).not.toContain('wc-cart__checkout-amount');
  });

  it('주문할 수 없는 카트의 바는 금액을 보여도 링크가 아니다', () => {
    const html = render([{ goodId: 'gone', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toMatch(/<div class="wc-cart__cta-bar"><span aria-disabled="true" class="wc-btn primary disabled wc-cart__checkout[^"]*">/);
    expect(html).not.toContain('href="/checkout"');
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


describe('origin quote and option lines', () => {
  it('keeps each origin fee and free-shipping remainder separate', () => {
    mocks.items=[{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1},{goodId:'g14',variantId:SOLD_VARIANT,qty:1}];
    mocks.quote={...defaultQuote,totalFee:7000,finalTotalFee:7000,groups:[gimpoGroup,{...gimpoGroup,originId:'namyangju',originCode:'NAMYANGJU',originName:'남양주',baseFee:4000,policyFee:4000,totalFee:4000,finalFee:4000,policySubtotal:9000,freeThreshold:30000}]};
    const html=renderToStaticMarkup(<Cart catalog={{goods:[goods[0],{...goods[1],stock:'ok',stockQty:5,originId:'namyangju',options:goods[1].options!.map(option=>({...option,stockQty:5}))}],ips:[]}} couponState={emptyCouponState} />);
    /* 고객 화면은 출고지 이름 대신 배송 묶음 번호로 구분한다(10/14 회의 S7). */
    expect(html).toContain('<h2>배송 묶음 1</h2>');expect(html).toContain('<h2>배송 묶음 2</h2>');
    expect(html).not.toContain('김포');expect(html).not.toContain('남양주');
    expect(html).toContain('38,000원 더 담으면');expect(html).toContain('21,000원 더 담으면');
    expect(html).toContain('₩7,000');expect(html).toContain('₩28,000');
  });
  it('blocks checkout while the current cart has no server quote', () => {
    mocks.quote=null;
    const html=render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}]);
    expect(html).toContain('배송비 확인 후 표시');expect(html).not.toContain('href="/checkout"');
  });
  it('배송지를 아직 받지 않은 장바구니는 금액 확정을 미루고 주문서 진입을 허용한다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'address_required', finalFee: null, regionalFee: null }] };
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('배송지 입력 후 확정');
    expect(html).not.toContain('₩15,000');
    expect(html).toContain('href="/checkout"');
  });
  it('정책이 중지된 배송 견적은 확인 없이 주문서로 넘기지 않는다', () => {
    mocks.quote = { ...defaultQuote, checkoutAllowed: false, finalTotalFee: null,
      groups: [{ ...gimpoGroup, regionMode: 'managed', regionStatus: 'policy_unavailable', finalFee: null, regionalFee: null }] };
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(html).toContain('현재 배송비를 확인 중입니다');
    expect(html).not.toContain('href="/checkout"');
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
  expect(html).not.toContain('href="/checkout"');
  expect(html).not.toContain('장바구니가 비어 있어요');
 });
