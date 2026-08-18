import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATE_NAMES,
  inquiryEmailDedupeKey,
  isEmailTemplateName,
  isOrderEmailTemplateName,
  orderEmailDedupeKey,
  parseOrderEmailDedupeKey,
} from './dedupe';

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

describe('문의 답변 메일 키 (#253)', () => {
  const MESSAGE_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

  it('템플릿 이름 목록에 inquiry_answered가 있다 — DB CHECK와 같은 집합이다', () => {
    expect(EMAIL_TEMPLATE_NAMES).toContain('inquiry_answered');
    expect(isEmailTemplateName('inquiry_answered')).toBe(true);
  });

  /* 키에 담기는 값이 답변 메시지 id다. 문의 id로 만들면 두 번째 답변이 첫 답변의
     sent 행에 막혀 조용히 사라진다. */
  it('dedupe_key는 답변 메시지 id를 담는다', () => {
    expect(inquiryEmailDedupeKey(MESSAGE_ID)).toBe(`inquiry_answered:${MESSAGE_ID}`);
  });

  /* 형식만 uuid로 같아서, 구분하지 않으면 메시지 id를 주문 id로 읽고 엉뚱한 주문을
     조회한다. 재발송 게이트(admin_request_email_resend)도 같은 구분을 한다. */
  it('주문 메일 파서가 문의 키를 주문으로 오인하지 않는다', () => {
    expect(isOrderEmailTemplateName('inquiry_answered')).toBe(false);
    expect(parseOrderEmailDedupeKey(`inquiry_answered:${MESSAGE_ID}`)).toBeNull();
    expect(parseOrderEmailDedupeKey(`order_confirmation:${MESSAGE_ID}`)).toEqual({
      template: 'order_confirmation',
      orderId: MESSAGE_ID,
    });
  });
});
