import { describe, expect, it } from 'vitest';
import {
  goodsOptionLimitMessage,
  goodsOptionLimitNotices,
  parseGoodsOptionLimit,
  PLACE_ORDER_OPTION_LIMIT_MESSAGES,
} from './goods-option-sale-mode';

describe('parseGoodsOptionLimit', () => {
  it('견적 line.optionLimit을 그대로 읽는다', () => {
    expect(parseGoodsOptionLimit({ orderMaxQty: 2, memberMaxQty: 3, memberReservedQty: 2, memberRemainingQty: 1, reason: 'option_member_limit_exceeded' }))
      .toEqual({ orderMaxQty: 2, memberMaxQty: 3, memberReservedQty: 2, memberRemainingQty: 1, reason: 'option_member_limit_exceeded' });
    expect(parseGoodsOptionLimit({ orderMaxQty: null, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null, reason: null }))
      .toEqual({ orderMaxQty: null, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null, reason: null });
  });

  it('비회원 견적은 회원 이력 없이 주문당 사유만 가진다', () => {
    expect(parseGoodsOptionLimit({ orderMaxQty: 2, memberMaxQty: 3, memberReservedQty: null, memberRemainingQty: null, reason: 'option_order_limit_exceeded' })
      ?.reason).toBe('option_order_limit_exceeded');
  });

  it('서버 계약과 다른 모양은 버린다', () => {
    expect(parseGoodsOptionLimit(undefined)).toBeNull();
    expect(parseGoodsOptionLimit({ orderMaxQty: 0, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null, reason: null })).toBeNull();
    expect(parseGoodsOptionLimit({ orderMaxQty: 2, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null, reason: 'order_quantity_above_maximum' })).toBeNull();
    // 남은 수량은 상한 - 누적(0 아래로 내려가지 않음)이어야 한다.
    expect(parseGoodsOptionLimit({ orderMaxQty: null, memberMaxQty: 3, memberReservedQty: 2, memberRemainingQty: 3, reason: null })).toBeNull();
    expect(parseGoodsOptionLimit({ orderMaxQty: null, memberMaxQty: 3, memberReservedQty: 5, memberRemainingQty: 0, reason: 'option_member_limit_exceeded' })
      ?.memberRemainingQty).toBe(0);
    // 상한이 없으면 회원 이력도 없다.
    expect(parseGoodsOptionLimit({ orderMaxQty: null, memberMaxQty: null, memberReservedQty: 1, memberRemainingQty: null, reason: null })).toBeNull();
  });
});

describe('옵션별 구매 제한 문구', () => {
  it('확정 카피로 정적 안내를 만든다', () => {
    expect(goodsOptionLimitNotices('빨강', { orderMaxQty: 2, memberMaxQty: 3 })).toEqual([
      "'빨강'은 한 번에 2개까지 주문할 수 있습니다.",
      "'빨강'은 1인당 3개까지 구매할 수 있습니다.",
    ]);
    expect(goodsOptionLimitNotices('파랑', { orderMaxQty: null, memberMaxQty: null })).toEqual([]);
  });

  it('사유별 장바구니 안내는 같은 문장을 쓴다', () => {
    expect(goodsOptionLimitMessage('option_order_limit_exceeded', '빨강', { orderMaxQty: 2, memberMaxQty: 3 }))
      .toBe("'빨강'은 한 번에 2개까지 주문할 수 있습니다.");
    expect(goodsOptionLimitMessage('option_member_limit_exceeded', '빨강', { orderMaxQty: 2, memberMaxQty: 3 }))
      .toBe("'빨강'은 1인당 3개까지 구매할 수 있습니다.");
  });

  it('주문 생성 거절 문구는 옵션 이름 없이 장바구니로 돌려보낸다', () => {
    expect(Object.keys(PLACE_ORDER_OPTION_LIMIT_MESSAGES).sort()).toEqual(['option_member_limit_exceeded', 'option_order_limit_exceeded']);
    expect(PLACE_ORDER_OPTION_LIMIT_MESSAGES.option_member_limit_exceeded).toContain('결제 대기');
  });
});
