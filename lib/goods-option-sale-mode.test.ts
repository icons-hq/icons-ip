import { describe, expect, it } from 'vitest';
import { goodsOptionLimitMessage, goodsOptionLimitNotices, isGoodsOptionSaleMode, maskCustomerOrderItem, parseGoodsOptionLimit, parseGoodsOptionSaleModeState, PLACE_ORDER_OPTION_LIMIT_MESSAGES, PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE, PLACE_ORDER_RANDOM_OPTION_MESSAGE, parseRandomAllocationLimit, RANDOM_OPTION_LABEL, RANDOM_OPTION_NOTICE, RANDOM_OPTION_PREORDER_NOTICE, RANDOM_OPTION_PROBLEMS, randomOptionAllocationNotice, randomOptionNotices } from './goods-option-sale-mode';
import { goodsOptionSaleModeErrorMessage } from '@/lib/admin/goods-option-sale-mode-messages';

describe('랜덤 판매 계약', () => {
  it('판매 방식은 select·random 두 값이다', () => {
    expect(isGoodsOptionSaleMode('select')).toBe(true);
    expect(isGoodsOptionSaleMode('random')).toBe(true);
    expect(isGoodsOptionSaleMode('lucky')).toBe(false);
    expect(isGoodsOptionSaleMode(null)).toBe(false);
  });

  it('고객 표기는 확정 카피를 쓴다', () => {
    expect(RANDOM_OPTION_LABEL).toBe('랜덤');
    expect(RANDOM_OPTION_NOTICE).toBe('옵션은 주문 후 재고에서 무작위로 정해져 발송됩니다. 같은 옵션이 중복될 수 있습니다.');
    expect(PLACE_ORDER_RANDOM_OPTION_MESSAGE).toContain('장바구니');
  });

  it('운영자 조회 결과를 읽는다', () => {
    const state = { goodId: 'random-main', optionSaleMode: 'select', updatedAt: '2026-10-28T01:00:00+00:00', randomProblem: 'random_option_price_mismatch', activeOptionCount: 3 };
    expect(parseGoodsOptionSaleModeState(state)).toEqual(state);
    expect(parseGoodsOptionSaleModeState({ ...state, randomProblem: null })?.randomProblem).toBeNull();
    expect(parseGoodsOptionSaleModeState({ ...state, optionSaleMode: 'lucky' })).toBeNull();
    expect(parseGoodsOptionSaleModeState({ ...state, randomProblem: 'unknown_code' })).toBeNull();
    expect(parseGoodsOptionSaleModeState({ ...state, updatedAt: 'not-a-date' })).toBeNull();
  });

  it('DB 사유 코드마다 운영자 문구가 있고, 메시지 접두로도 찾는다', () => {
    for (const code of RANDOM_OPTION_PROBLEMS) expect(goodsOptionSaleModeErrorMessage(code)).toMatch(/[가-힣]/);
    expect(goodsOptionSaleModeErrorMessage('random_option_price_mismatch')).toContain('판매가');
    expect(goodsOptionSaleModeErrorMessage('ERROR: random_option_limit_mismatch')).toBe(goodsOptionSaleModeErrorMessage('random_option_limit_mismatch'));
    expect(goodsOptionSaleModeErrorMessage('random_option_limit_mismatch')).toContain('같은 옵션 배정 상한');
    expect(goodsOptionSaleModeErrorMessage('random_option_preorder_mismatch')).toContain('발송 예정일');
    /* 옛 코드는 더 이상 DB가 내지 않는다(예약·옵션별 제한을 랜덤 판매에서 쓸 수 있다). */
    expect(RANDOM_OPTION_PROBLEMS).not.toContain('random_option_preorder');
    expect(RANDOM_OPTION_PROBLEMS).not.toContain('random_option_variant_limits');
    expect(goodsOptionSaleModeErrorMessage('goods_changed')).toContain('다른 곳에서');
    expect(goodsOptionSaleModeErrorMessage('operator_capability_required')).toContain('권한');
    expect(goodsOptionSaleModeErrorMessage('sensitive failure')).toBe('판매 방식을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.');
  });
});

describe('랜덤 예약판매·같은 옵션 배정 상한 안내', () => {
  it('예약판매면 예약 물량 문구, 아니면 재고 문구다', () => {
    expect(RANDOM_OPTION_PREORDER_NOTICE).toBe('옵션은 주문 후 예약 물량에서 무작위로 정해져 발송됩니다. 같은 옵션이 중복될 수 있습니다.');
    expect(randomOptionNotices()).toEqual([RANDOM_OPTION_NOTICE]);
    expect(randomOptionNotices({ preorder: true })).toEqual([RANDOM_OPTION_PREORDER_NOTICE]);
  });
  it('상한 문장을 더하고, 1인 상한이 1이면 중복 문장을 뺀다', () => {
    expect(randomOptionNotices({ allocationLimit: { orderMaxQty: 2, memberMaxQty: 3 } }))
      .toEqual([RANDOM_OPTION_NOTICE, '같은 옵션은 한 번에 2개, 1인당 3개까지 배정됩니다.']);
    expect(randomOptionNotices({ preorder: true, allocationLimit: { orderMaxQty: null, memberMaxQty: 1 } }))
      .toEqual(['옵션은 주문 후 예약 물량에서 무작위로 정해져 발송됩니다.', '같은 옵션은 1인당 1개까지 배정됩니다.']);
    expect(randomOptionAllocationNotice({ orderMaxQty: 1, memberMaxQty: null })).toBe('같은 옵션은 한 번에 1개까지 배정됩니다.');
    expect(randomOptionAllocationNotice({ orderMaxQty: null, memberMaxQty: null })).toBeNull();
    expect(randomOptionAllocationNotice(null)).toBeNull();
  });
  it('공개 랜덤 한 줄의 allocation_limit을 읽는다', () => {
    expect(parseRandomAllocationLimit({ orderMaxQty: 2, memberMaxQty: null })).toEqual({ orderMaxQty: 2, memberMaxQty: null });
    expect(parseRandomAllocationLimit({ orderMaxQty: 0, memberMaxQty: null })).toBeNull();
    expect(parseRandomAllocationLimit('2')).toBeNull();
    expect(PLACE_ORDER_RANDOM_OPTION_LIMIT_MESSAGE).toContain('수량을 줄여');
  });
});

describe('maskCustomerOrderItem', () => {
  const row = { id: 'item-1', variant_id: 'allocated', variant_name_snapshot: 'C', variant_code_snapshot: 'RANDOM-C', option_sale_mode_snapshot: 'random' as const };

  it('service role로 읽은 랜덤 행을 고객 표기로 바꾼다', () => {
    expect(maskCustomerOrderItem(row, 'cart-key')).toEqual({ id: 'item-1', variant_id: 'cart-key', variant_name_snapshot: '랜덤', variant_code_snapshot: null, option_sale_mode_snapshot: 'random' });
  });

  it('랜덤이 아닌 행은 그대로 둔다', () => {
    const plain = { ...row, option_sale_mode_snapshot: null };
    expect(maskCustomerOrderItem(plain, 'cart-key')).toBe(plain);
  });
});

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

  it('옵션명 끝 받침에 맞춰 은/는을 고르고, 판정할 수 없으면 은(는)이다(m27 QA-1)', () => {
    expect(goodsOptionLimitNotices('레드', { orderMaxQty: 2, memberMaxQty: 3 })).toEqual([
      "'레드'는 한 번에 2개까지 주문할 수 있습니다.",
      "'레드'는 1인당 3개까지 구매할 수 있습니다.",
    ]);
    expect(goodsOptionLimitMessage('option_order_limit_exceeded', '레드', { orderMaxQty: 2, memberMaxQty: null }))
      .toBe("'레드'는 한 번에 2개까지 주문할 수 있습니다.");
    expect(goodsOptionLimitMessage('option_member_limit_exceeded', '포토카드 2', { orderMaxQty: null, memberMaxQty: 1 }))
      .toBe("'포토카드 2'는 1인당 1개까지 구매할 수 있습니다.");
    expect(goodsOptionLimitMessage('option_order_limit_exceeded', 'Red', { orderMaxQty: 2, memberMaxQty: null }))
      .toBe("'Red'은(는) 한 번에 2개까지 주문할 수 있습니다.");
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
