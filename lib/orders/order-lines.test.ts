import { describe, expect, it } from 'vitest';
import type { GoodsTransactionDisplay, GoodsTransactionLine } from '@/lib/goods-transaction';
import { transactionDisplay, transactionLineId } from '@/test/fixtures/cart-transaction';
import { buildOrderLines, orderLinePriceDisplay, visibleOptionName, type OrderLineGoodInfo, type OrderLineInputItem } from './order-lines';

const GOOD = 'transaction-good';
const VARIANT = transactionDisplay.lines[0].variantId;

function item(overrides: Partial<OrderLineInputItem> = {}): OrderLineInputItem {
  return { key: 'item-1', lineId: transactionLineId, goodId: GOOD, variantId: VARIANT, name: '아크릴 스탠드', optionName: '파랑', qty: 2, unitPrice: 10000, ...overrides };
}

function receiptWith(lines: Partial<GoodsTransactionLine>[]): GoodsTransactionDisplay {
  return { ...transactionDisplay, lines: lines.map((line, index) => ({ ...transactionDisplay.lines[0], lineId: `line-${index}`, ...line })) };
}

const goods = (overrides: Partial<OrderLineGoodInfo> = {}) => new Map<string, OrderLineGoodInfo>([[GOOD, { ipId: 'ip-1', imagePath: 'goods/a.webp', bg: 'linear-gradient(#000, #fff)', saleRestriction: 'none', ...overrides }]]);
const imageUrl = (path: string) => `https://cdn.example/${path}`;

function build(overrides: Partial<Parameters<typeof buildOrderLines>[0]> = {}) {
  return buildOrderLines({ items: [item()], receipt: transactionDisplay, goods: goods(), ipTitles: new Map([['ip-1', '홍실']]), adultAccess: 'full', imageUrl, ...overrides });
}

describe('visibleOptionName', () => {
  it('null·빈 값·기본 옵션은 줄에서 감추고, 그 밖의 이름은 그대로 보인다', () => {
    expect(visibleOptionName(null)).toBeNull();
    expect(visibleOptionName(undefined)).toBeNull();
    expect(visibleOptionName('')).toBeNull();
    expect(visibleOptionName('   ')).toBeNull();
    expect(visibleOptionName('기본 옵션')).toBeNull();
    expect(visibleOptionName(' 기본 옵션 ')).toBeNull();
    expect(visibleOptionName('파랑')).toBe('파랑');
    expect(visibleOptionName('랜덤')).toBe('랜덤');
    expect(visibleOptionName('기본 옵션 A')).toBe('기본 옵션 A');
  });
});

describe('orderLinePriceDisplay', () => {
  it('구매가격이 제품 가격보다 낮으면 구매가격과 정가 취소선을 함께 보인다', () => {
    expect(orderLinePriceDisplay({ purchaseAmount: 18000, regularAmount: 20000 })).toEqual({ primary: 18000, strike: 20000 });
  });

  it('구매가격과 제품 가격이 같거나 제품 가격이 없으면 숫자 하나만 보인다', () => {
    expect(orderLinePriceDisplay({ purchaseAmount: 20000, regularAmount: 20000 })).toEqual({ primary: 20000, strike: null });
    expect(orderLinePriceDisplay({ purchaseAmount: 20000, regularAmount: null })).toEqual({ primary: 20000, strike: null });
  });

  it('구매가격이 더 높은 데이터 이상은 구매가격만 보인다', () => {
    expect(orderLinePriceDisplay({ purchaseAmount: 25000, regularAmount: 20000 })).toEqual({ primary: 25000, strike: null });
  });

  it('구매가격을 모르면 아무것도 보이지 않는다', () => {
    expect(orderLinePriceDisplay({ purchaseAmount: null, regularAmount: null })).toBeNull();
    expect(orderLinePriceDisplay({ purchaseAmount: null, regularAmount: 20000 })).toBeNull();
  });
});

describe('buildOrderLines 영수증 줄 매칭', () => {
  it('① lineId가 일치하는 줄의 판매가·복수구매 할인·정가를 수량에 곱한다', () => {
    const [line] = build();
    /* (10000 − 1000) × 2 = 18000, 정가 10000 × 2 = 20000 */
    expect(line).toMatchObject({ key: 'item-1', goodId: GOOD, name: '아크릴 스탠드', optionName: '파랑', qty: 2, purchaseAmount: 18000, regularAmount: 20000 });
  });

  it('① 같은 상품의 다른 줄이 있어도 lineId가 맞는 줄을 쓴다', () => {
    const receipt = receiptWith([
      { lineId: 'other', goodId: GOOD, variantId: 'v-other', regularUnitPrice: 9000, unitPrice: 9000, volumeUnitDiscount: 0 },
      { lineId: transactionLineId, goodId: GOOD, variantId: VARIANT, regularUnitPrice: 12000, unitPrice: 11000, volumeUnitDiscount: 500 },
    ]);
    expect(build({ receipt })[0]).toMatchObject({ purchaseAmount: 21000, regularAmount: 24000 });
  });

  it('② lineId가 없으면 (goodId, variantId)가 정확히 한 줄일 때 그 줄을 쓴다', () => {
    const receipt = receiptWith([
      { goodId: GOOD, variantId: 'v-other', regularUnitPrice: 9000, unitPrice: 9000, volumeUnitDiscount: 0 },
      { goodId: GOOD, variantId: VARIANT, regularUnitPrice: 12000, unitPrice: 11000, volumeUnitDiscount: 500 },
    ]);
    expect(build({ items: [item({ lineId: undefined })], receipt })[0]).toMatchObject({ purchaseAmount: 21000, regularAmount: 24000 });
  });

  it('③ 같은 상품의 줄이 모두 같은 단가면 그 값을 쓴다(랜덤 판매처럼 옵션 줄이 합쳐진 경우)', () => {
    const same = { goodId: GOOD, regularUnitPrice: 12000, unitPrice: 11000, volumeUnitDiscount: 0 };
    const receipt = receiptWith([{ ...same, variantId: 'v-a' }, { ...same, variantId: 'v-b' }]);
    expect(build({ items: [item({ lineId: 'merged-id', variantId: 'v-cart-key' })], receipt })[0]).toMatchObject({ purchaseAmount: 22000, regularAmount: 24000 });
  });

  it('④ 단가가 다른 줄이 섞여 있으면 영수증 값을 쓰지 않고 주문 단가 × 수량만 보인다', () => {
    const receipt = receiptWith([
      { goodId: GOOD, variantId: 'v-a', regularUnitPrice: 12000, unitPrice: 11000, volumeUnitDiscount: 0 },
      { goodId: GOOD, variantId: 'v-b', regularUnitPrice: 13000, unitPrice: 11000, volumeUnitDiscount: 0 },
    ]);
    expect(build({ items: [item({ lineId: 'merged-id', variantId: 'v-cart-key' })], receipt })[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
  });

  it('④ 영수증에 없는 상품·영수증이 없는 주문(v1)은 주문 단가 × 수량이고 정가가 없다', () => {
    expect(build({ items: [item({ goodId: 'unknown', lineId: undefined })] })[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
    expect(build({ receipt: null })[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: null });
  });

  it('주문 단가가 없는 선물 품목은 영수증이 있을 때만 가격을 가진다', () => {
    const gift = item({ key: `${GOOD}:${VARIANT}`, lineId: undefined, unitPrice: null });
    expect(build({ items: [gift] })[0]).toMatchObject({ purchaseAmount: 18000, regularAmount: 20000 });
    expect(build({ items: [gift], receipt: null })[0]).toMatchObject({ purchaseAmount: null, regularAmount: null });
  });

  it('금액이 안전한 정수를 넘으면 null이다', () => {
    const huge = receiptWith([{ lineId: transactionLineId, goodId: GOOD, variantId: VARIANT, regularUnitPrice: Number.MAX_SAFE_INTEGER, unitPrice: Number.MAX_SAFE_INTEGER, volumeUnitDiscount: 0 }]);
    expect(build({ receipt: huge })[0]).toMatchObject({ purchaseAmount: null, regularAmount: null });
    expect(build({ items: [item({ qty: 0 })] })[0]).toMatchObject({ purchaseAmount: null, regularAmount: null });
    /* 복수구매 할인이 판매가보다 큰 데이터 이상도 음수 금액을 만들지 않는다. */
    const negative = receiptWith([{ lineId: transactionLineId, goodId: GOOD, variantId: VARIANT, regularUnitPrice: 5000, unitPrice: 1000, volumeUnitDiscount: 2000 }]);
    expect(build({ receipt: negative })[0].purchaseAmount).toBeNull();
  });
});

describe('buildOrderLines 배치 표시값(my_order_item_display)', () => {
  const display = (value: { regularUnitPrice: number | null; volumeUnitDiscount: number | null; activeQty: number }, lineId = transactionLineId) => new Map([[lineId, value]]);

  it('정가·복수구매 단가 할인이 있으면 (주문 단가 − 할인) × 수량이 구매가, 정가 × 수량이 제품 가격이다. 영수증이 없어도 된다', () => {
    const [line] = build({ receipt: null, display: display({ regularUnitPrice: 12000, volumeUnitDiscount: 1000, activeQty: 2 }) });
    expect(line).toMatchObject({ qty: 2, purchaseAmount: 18000, regularAmount: 24000 });
    expect(line).not.toHaveProperty('canceledQty');
  });

  it('정가가 null이면(v1·배정 행 정가 불일치) 주문 단가 × 수량 숫자 하나다', () => {
    const [line] = build({ receipt: null, display: display({ regularUnitPrice: null, volumeUnitDiscount: 0, activeQty: 2 }) });
    expect(line).toMatchObject({ qty: 2, purchaseAmount: 20000, regularAmount: null });
  });

  it('부분 취소: 남은 수량 기준으로 금액을 계산하고 취소된 수량을 canceledQty로 담는다', () => {
    const [line] = build({ items: [item({ qty: 3 })], receipt: null, display: display({ regularUnitPrice: 12000, volumeUnitDiscount: 1000, activeQty: 2 }) });
    expect(line).toMatchObject({ qty: 2, canceledQty: 1, purchaseAmount: 18000, regularAmount: 24000 });
  });

  it('전부 취소되면 수량 0·취소 수량은 원래 수량이고 가격을 지어내지 않는다', () => {
    const [line] = build({ receipt: null, display: display({ regularUnitPrice: 12000, volumeUnitDiscount: 1000, activeQty: 0 }) });
    expect(line).toMatchObject({ qty: 0, canceledQty: 2, purchaseAmount: null, regularAmount: null });
  });

  it('남은 수량이 주문 수량을 넘거나 음수면 주문 수량·0으로 접는다', () => {
    expect(build({ receipt: null, display: display({ regularUnitPrice: null, volumeUnitDiscount: 0, activeQty: 9 }) })[0]).toMatchObject({ qty: 2 });
    expect(build({ receipt: null, display: display({ regularUnitPrice: null, volumeUnitDiscount: 0, activeQty: -1 }) })[0]).toMatchObject({ qty: 0, canceledQty: 2 });
  });

  it('배치 값이 있으면 영수증 줄 매칭보다 앞서고, 그 줄의 값이 없으면 영수증 매칭으로 물러난다', () => {
    const other = new Map([['other-line', { regularUnitPrice: 99999, volumeUnitDiscount: 0, activeQty: 1 }]]);
    /* 이 품목의 배치 값이 없으면 영수증 줄 매칭(① lineId)을 그대로 쓴다. */
    expect(build({ display: other })[0]).toMatchObject({ qty: 2, purchaseAmount: 18000, regularAmount: 20000 });
    /* 배치 값이 있으면 영수증 값(정가 10,000)이 아니라 배치 값(정가 15,000)을 쓴다. */
    expect(build({ display: display({ regularUnitPrice: 15000, volumeUnitDiscount: 0, activeQty: 2 }) })[0]).toMatchObject({ purchaseAmount: 20000, regularAmount: 30000 });
  });

  it('주문 단가가 없는 품목은 구매가를 지어내지 않는다', () => {
    const [line] = build({ items: [item({ unitPrice: null })], receipt: null, display: display({ regularUnitPrice: 12000, volumeUnitDiscount: 0, activeQty: 2 }) });
    expect(line).toMatchObject({ purchaseAmount: null, regularAmount: 24000 });
  });
});

describe('buildOrderLines 썸네일·IP명', () => {
  it('상품 이미지 경로를 이미지 URL 배경으로 만들고 IP명을 붙인다', () => {
    expect(build()[0]).toMatchObject({ ipName: '홍실', thumbnail: 'url("https://cdn.example/goods/a.webp") center / cover no-repeat', adultMasked: false });
  });

  it('이미지 경로가 없으면 상품 배경값, 둘 다 없으면 null이다', () => {
    expect(build({ goods: goods({ imagePath: null }) })[0].thumbnail).toBe('linear-gradient(#000, #fff)');
    expect(build({ goods: goods({ imagePath: null, bg: null }) })[0].thumbnail).toBeNull();
    /* 이미지 URL을 만들지 못해도 배경값으로 물러난다. */
    expect(build({ imageUrl: () => null })[0].thumbnail).toBe('linear-gradient(#000, #fff)');
  });

  it('상품 행을 못 찾으면 IP명·썸네일 없이 줄은 남는다', () => {
    const [line] = build({ goods: new Map(), ipTitles: new Map() });
    expect(line).toMatchObject({ name: '아크릴 스탠드', ipName: null, thumbnail: null, adultMasked: false });
  });

  it('IP 제목을 못 찾으면 IP명만 비운다', () => {
    expect(build({ ipTitles: new Map() })[0]).toMatchObject({ ipName: null, thumbnail: expect.stringContaining('goods/a.webp') });
  });

  it('품목이 자기 이미지 경로(선물 스냅샷)를 가지면 상품 행 이미지보다 먼저 쓴다', () => {
    expect(build({ items: [item({ imagePath: 'gift/own.webp' })] })[0].thumbnail).toContain('gift/own.webp');
  });
});

describe('buildOrderLines 19금 상품 가림', () => {
  it.each(['hidden', 'masked'] as const)('성인 인증 전(%s)에는 이미지를 비우고 가림 표시를 켠다. 이름·가격은 그대로다', (adultAccess) => {
    const [line] = build({ goods: goods({ saleRestriction: 'adult' }), adultAccess });
    expect(line).toMatchObject({ adultMasked: true, thumbnail: null, name: '아크릴 스탠드', purchaseAmount: 18000 });
  });

  it('인증을 마친 회원(full)에게는 일반 상품처럼 이미지가 보인다', () => {
    expect(build({ goods: goods({ saleRestriction: 'adult' }), adultAccess: 'full' })[0]).toMatchObject({ adultMasked: false, thumbnail: expect.stringContaining('goods/a.webp') });
  });

  it('가림 줄은 품목 자체 이미지 경로(선물 스냅샷)도 쓰지 않는다', () => {
    const [line] = build({ items: [item({ imagePath: 'gift/own.webp' })], goods: goods({ saleRestriction: 'adult' }), adultAccess: 'masked' });
    expect(line.thumbnail).toBeNull();
  });

  it('일반 상품은 접근 모드와 상관없이 가리지 않는다', () => {
    expect(build({ adultAccess: 'hidden' })[0]).toMatchObject({ adultMasked: false, thumbnail: expect.stringContaining('goods/a.webp') });
  });
});
