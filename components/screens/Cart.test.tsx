import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, LegacyCartItem } from '@/lib/cart';
import type { UserCouponSummary } from '@/lib/coupons';
import type { CartCouponState } from '@/lib/coupons.server';
import type { Good } from '@/lib/data';
import type { ShippingQuote } from '@/lib/fulfillment';
import { Cart } from './Cart';

const mocks = vi.hoisted(() => ({
  items: [] as CartItem[],
  legacyItems: [] as LegacyCartItem[],
  ready: true,
  mode: 'server' as 'server' | 'local',
  quote: null as ShippingQuote | null,
}));

vi.mock('@/components/shop/useShippingQuote', () => ({
  useShippingQuote: () => ({quote:mocks.quote,loading:!mocks.quote,error:null,refresh:vi.fn()}),
}));
const gimpoGroup = {originId:'gimpo',originCode:'GIMPO',originName:'김포',baseFee:3000,freeThreshold:50000,
  policySubtotal:12000,policyFee:3000,individualFee:0,totalFee:3000};
const defaultQuote = {totalFee:3000,groups:[gimpoGroup]};
mocks.quote = defaultQuote;
beforeEach(() => { mocks.quote = defaultQuote; mocks.legacyItems = []; mocks.ready = true; });

vi.mock('@/components/shell/CartProvider', () => ({
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

const DEFAULT_VARIANT = '00000000-0000-4000-8000-000000000013';
const SOLD_VARIANT = '00000000-0000-4000-8000-000000000014';
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

describe('Cart 배송비 요약', () => {
  it('임계 미달이면 실제 배송비를 붙이고 남은 금액을 안내한다', () => {
    const html = render([{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }]);

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
    expect(html).toContain('38,000원 더 담으면 묶음 배송비가 무료예요.');
  });

  it('임계에 도달하면 배송비를 받지 않고 안내를 감춘다', () => {
    mocks.quote = {totalFee:0,groups:[{...gimpoGroup,policySubtotal:60000,policyFee:0,totalFee:0}]};
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
    expect(html).toContain('총 할인 금액');
    expect(html).toContain('−₩0');
    expect(html).toContain('배송비');
    expect(html).toContain('예상 총액');
    expect(html).toContain('출고지별 배송비를 합산합니다.');
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
    mocks.quote = {totalFee:0,groups:[{...gimpoGroup,policySubtotal:60000,policyFee:0,totalFee:0}]};
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 5 }],
      { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
    );

    expect(html).toContain('−₩5,000');
    expect(html).toContain('₩55,000');
    expect(html).toContain('적용 해제');
  });

  it('조건 미달이 되면 할인을 접고 사유를 알린다', () => {
    const html = render(
      [{ goodId: 'g13', variantId: DEFAULT_VARIANT, qty: 1 }],
      { selectedUserCouponId: fix5k.id, coupons: [fix5k] },
    );

    expect(html).toContain('−₩0');
    expect(html).toContain('최소 주문 금액');
    expect(html).toContain('₩15,000');
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

describe('Cart 빈 상태', () => {
  it('굿즈샵으로 돌려보낸다', () => {
    const html = render([]);

    expect(html).toContain('장바구니가 비어 있어요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-cart__summary');
  });
});


describe('origin quote and option lines', () => {
  it('keeps each origin fee and free-shipping remainder separate', () => {
    mocks.items=[{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1},{goodId:'g14',variantId:SOLD_VARIANT,qty:1}];
    mocks.quote={totalFee:7000,groups:[gimpoGroup,{...gimpoGroup,originId:'namyangju',originCode:'NAMYANGJU',originName:'남양주',baseFee:4000,policyFee:4000,totalFee:4000,policySubtotal:9000,freeThreshold:30000}]};
    const html=renderToStaticMarkup(<Cart catalog={{goods:[goods[0],{...goods[1],stock:'ok',stockQty:5,originId:'namyangju',options:goods[1].options!.map(option=>({...option,stockQty:5}))}],ips:[]}} couponState={emptyCouponState} />);
    expect(html).toContain('김포 출고');expect(html).toContain('남양주 출고');
    expect(html).toContain('38,000원 더 담으면');expect(html).toContain('21,000원 더 담으면');
    expect(html).toContain('₩7,000');expect(html).toContain('₩28,000');
  });
  it('blocks checkout while the current cart has no server quote', () => {
    mocks.quote=null;
    const html=render([{goodId:'g13',variantId:DEFAULT_VARIANT,qty:1}]);
    expect(html).toContain('배송비 확인 후 표시');expect(html).not.toContain('href="/checkout"');
  });
  it('shows separate option names and prices for the same good', () => {
    const options=[
      {id:'00000000-0000-4000-8000-000000000001',name:'파랑',price:12000,stockQty:2,code:'BLUE',attributes:{},isDefault:true},
      {id:'00000000-0000-4000-8000-000000000002',name:'빨강',price:15000,stockQty:3,code:'RED',attributes:{},isDefault:false},
    ];
    mocks.items=options.map(option=>({goodId:'g13',variantId:option.id,qty:1}));
    const html=renderToStaticMarkup(<Cart catalog={{goods:[{...goods[0],options}],ips:[]}} couponState={emptyCouponState} />);
    expect(html).toContain('파랑');expect(html).toContain('빨강');
    expect(html).toContain('₩15,000');expect(html).toContain('₩27,000');
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
