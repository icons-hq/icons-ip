import { describe, expect, it } from 'vitest';
import { orderEmailDedupeKey, parseOrderEmailDedupeKey } from './dedupe';

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

describe('orderEmailDedupeKey', () => {
  it('만든 키를 그대로 되읽는다', () => {
    for (const template of ['order_confirmation', 'order_shipped'] as const) {
      const key = orderEmailDedupeKey(template, ORDER_ID);
      expect(parseOrderEmailDedupeKey(key)).toEqual({ template, orderId: ORDER_ID });
    }
  });

  it('키 형식은 DB에 이미 쌓인 값과 같다', () => {
    expect(orderEmailDedupeKey('order_confirmation', ORDER_ID)).toBe(
      `order_confirmation:${ORDER_ID}`,
    );
  });
});

describe('parseOrderEmailDedupeKey', () => {
  // 재발송은 이 파싱 결과로 주문을 고른다. 모르는 키를 통과시키면 엉뚱한 주문에 메일이 간다.
  it('주문 메일이 아닌 키는 통과시키지 않는다', () => {
    const rejected = [
      '',
      'order_confirmation',
      `unknown_template:${ORDER_ID}`,
      'order_confirmation:not-a-uuid',
      `order_confirmation:${ORDER_ID.slice(0, -1)}`,
      `ticket_confirmation:${ORDER_ID}`,
    ];

    for (const key of rejected) {
      expect(parseOrderEmailDedupeKey(key)).toBeNull();
    }
  });

  it('대문자 uuid는 정규화해서 돌려준다', () => {
    expect(parseOrderEmailDedupeKey(`order_shipped:${ORDER_ID.toUpperCase()}`)).toEqual({
      template: 'order_shipped',
      orderId: ORDER_ID,
    });
  });
});
