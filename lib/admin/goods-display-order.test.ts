import { describe, expect, it } from 'vitest';
import {
  GOODS_DISPLAY_ORDER_MAX, displayOrderAnchorReadback, displayOrderBefore, displayOrderSlotReadback, parseDisplayOrderText,
  parseGoodsDisplayOrderRequest, parseGoodsDisplayOrderSlotRequest,
} from './goods-display-order';

describe('진열 순서 번호 읽기', () => {
  it('0 이상의 정수 글자만 숫자로 읽는다', () => {
    expect(parseDisplayOrderText('0')).toBe(0);
    expect(parseDisplayOrderText(' 12 ')).toBe(12);
    expect(parseDisplayOrderText(String(GOODS_DISPLAY_ORDER_MAX))).toBe(GOODS_DISPLAY_ORDER_MAX);
  });
  it('비었거나 음수·소수·너무 큰 값은 읽지 않는다', () => {
    for (const text of ['', '  ', '-1', '1.5', '1e3', 'abc', String(GOODS_DISPLAY_ORDER_MAX + 1), '12345678901']) expect(parseDisplayOrderText(text), text).toBeNull();
  });
});

describe('순서 조회 요청', () => {
  it('검색어와 페이지만 받고 검색어는 앞뒤 공백을 뗀다', () => {
    expect(parseGoodsDisplayOrderRequest({ query: ' 키링 ', page: 2 })).toEqual({ query: '키링', page: 2 });
    expect(parseGoodsDisplayOrderRequest({ query: '', page: 1 })).toEqual({ query: '', page: 1 });
  });
  it('모양이 틀리면 거절한다', () => {
    for (const value of [null, [], { page: 1 }, { query: 1, page: 1 }, { query: '', page: 0 }, { query: '', page: 1.5 }, { query: '', page: 100001 }, { query: 'a'.repeat(101), page: 1 }]) {
      expect(parseGoodsDisplayOrderRequest(value), JSON.stringify(value)).toBeNull();
    }
  });
  it('번호 조회는 0 이상의 정수와 (없거나) 비지 않은 상품 URL을 받는다', () => {
    expect(parseGoodsDisplayOrderSlotRequest({ order: 3, goodId: null })).toEqual({ order: 3, goodId: null });
    expect(parseGoodsDisplayOrderSlotRequest({ order: 0 })).toEqual({ order: 0, goodId: null });
    expect(parseGoodsDisplayOrderSlotRequest({ order: 3, goodId: ' hw-1 ' })).toEqual({ order: 3, goodId: 'hw-1' });
    for (const value of [null, { order: -1, goodId: null }, { order: 1.5 }, { order: GOODS_DISPLAY_ORDER_MAX + 1 }, { order: 1, goodId: '' }, { order: 1, goodId: 7 }, { order: 1, goodId: 'x'.repeat(201) }]) {
      expect(parseGoodsDisplayOrderSlotRequest(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('[이 앞에 두기]가 넣을 번호', () => {
  it('바로 앞 줄이 없고 번호가 1 이상이면 한 칸 앞 번호를 준다', () => {
    expect(displayOrderBefore({ order: 1, previousOrder: null })).toEqual({ order: 0 });
    expect(displayOrderBefore({ order: 5, previousOrder: null })).toEqual({ order: 4 });
  });
  it('바로 앞 줄의 번호가 한 칸 앞보다 작으면 한 칸 앞 번호를 준다', () => {
    expect(displayOrderBefore({ order: 5, previousOrder: 3 })).toEqual({ order: 4 });
  });
  it('한 칸 앞 번호를 이미 쓰고 있으면 이유를 준다', () => {
    expect(displayOrderBefore({ order: 5, previousOrder: 4 })).toEqual({ reason: '바로 앞 번호를 쓰는 상품이 있음' });
  });
  it('같은 번호의 상품이 앞에 있으면 그 묶음의 첫 줄을 쓰게 이유를 준다', () => {
    expect(displayOrderBefore({ order: 5, previousOrder: 5 })).toEqual({ reason: '같은 번호가 앞에 있음' });
  });
  it('0번은 더 앞에 둘 수 없다', () => {
    expect(displayOrderBefore({ order: 0, previousOrder: null })).toEqual({ reason: '더 앞 번호 없음' });
  });
});

describe('번호 칸 아래 요약', () => {
  it('아무도 쓰지 않는 번호는 비어 있다고 알린다', () => {
    expect(displayOrderSlotReadback({ order: 4, names: [], total: 0 })).toBe('4번은 아직 쓰는 상품이 없습니다.');
  });
  it('쓰는 상품이 있으면 이름과 함께 겹침을 알린다', () => {
    expect(displayOrderSlotReadback({ order: 4, names: ['키링'], total: 1 })).toBe('4번은 이미 쓰는 상품이 있습니다(키링). 번호가 같은 상품끼리는 앞뒤를 정할 수 없습니다.');
  });
  it('이름이 다 담기지 않으면 나머지 개수를 알린다', () => {
    expect(displayOrderSlotReadback({ order: 4, names: ['가', '나', '다'], total: 5 })).toContain('(가, 나, 다 외 2개)');
  });
  it('[이 앞에 두기]로 넣은 번호는 어느 상품 앞인지 말한다', () => {
    expect(displayOrderAnchorReadback({ name: '키링', order: 5 })).toBe('‘키링’ 바로 앞에 둡니다. 그 상품은 지금 5번입니다.');
  });
});
