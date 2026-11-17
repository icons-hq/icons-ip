import { describe, expect, it } from 'vitest';
import { ORDER_DETAIL_STATUSES, type OrderDetailStatus } from '../orders';
import {
  ORDER_RECEIPT_NOTICE_PARAM,
  ORDER_RECEIPT_NOTICE_UNAVAILABLE,
  ORDER_RECEIPT_PROVIDERS,
  ORDER_RECEIPT_SECTION_ID,
  isAllowedTossReceiptUrl,
  orderReceiptAvailable,
  orderReceiptHref,
  orderStatementAvailable,
  orderStatementHref,
} from './receipt';

const ORDER_ID = '20000000-0000-4000-8000-000000002051';

describe('영수증·명세서 경로 계약', () => {
  it('상수와 경로 함수가 스펙과 같다', () => {
    expect(ORDER_RECEIPT_PROVIDERS).toEqual(['toss']);
    expect(ORDER_RECEIPT_NOTICE_PARAM).toBe('receipt');
    expect(ORDER_RECEIPT_NOTICE_UNAVAILABLE).toBe('unavailable');
    expect(ORDER_RECEIPT_SECTION_ID).toBe('order-payment');
    expect(orderReceiptHref(ORDER_ID)).toBe(`/orders/${ORDER_ID}/receipt`);
    expect(orderStatementHref(ORDER_ID)).toBe(`/orders/${ORDER_ID}/statement`);
  });
});

describe('orderReceiptAvailable', () => {
  const tossPaid = { provider: 'toss', status: 'paid' };

  it('카드 + 토스 + 결제 성립 상태(paid·canceled·refunded)만 참이다', () => {
    for (const status of ['paid', 'canceled', 'refunded']) {
      expect(orderReceiptAvailable({ paymentMethod: 'card', payment: { provider: 'toss', status } }), status).toBe(true);
    }
  });

  it('결제 전·실패 상태는 거짓이다', () => {
    for (const status of ['pending', 'failed', '', 'PAID']) {
      expect(orderReceiptAvailable({ paymentMethod: 'card', payment: { provider: 'toss', status } }), status).toBe(false);
    }
  });

  it('토스 밖 provider(나이스페이·코페이·무통장)와 provider 미상은 거짓이다', () => {
    for (const provider of ['nicepay', 'korpay', 'bank_transfer', 'tosspayments', '', null, undefined]) {
      expect(orderReceiptAvailable({ paymentMethod: 'card', payment: { provider, status: 'paid' } }), String(provider)).toBe(false);
    }
    expect(orderReceiptAvailable({ paymentMethod: 'card', payment: { status: 'paid' } })).toBe(false);
  });

  it('무통장 주문과 결제 없음은 거짓이다', () => {
    expect(orderReceiptAvailable({ paymentMethod: 'bank_transfer', payment: tossPaid })).toBe(false);
    expect(orderReceiptAvailable({ paymentMethod: 'card', payment: null })).toBe(false);
  });
});

describe('orderStatementAvailable', () => {
  it('결제가 끝난 5개 상태만 참이다', () => {
    const available = ORDER_DETAIL_STATUSES.filter((status) => orderStatementAvailable(status));
    expect(available).toEqual(['paid', 'confirmed', 'shipping', 'delivered', 'done']);
  });

  it('pending·canceled는 발급하지 않는다', () => {
    const blocked: OrderDetailStatus[] = ['pending', 'canceled'];
    for (const status of blocked) expect(orderStatementAvailable(status), status).toBe(false);
  });
});

describe('isAllowedTossReceiptUrl', () => {
  const allowed = [
    'https://tosspayments.com/receipt/abc',
    'https://dashboard.tosspayments.com/receipt/redirection?transactionId=tgen_20261117&ref=PX',
    'https://receipt.TossPayments.com/x',
    'https://a.b.tosspayments.com',
  ];

  it.each(allowed)('허용: %s', (url) => {
    expect(isAllowedTossReceiptUrl(url)).toBe(true);
  });

  it('http와 그 밖 프로토콜을 거절한다', () => {
    for (const url of [
      'http://dashboard.tosspayments.com/receipt',
      'javascript://dashboard.tosspayments.com/%0Aalert(1)',
      'ftp://tosspayments.com/receipt',
      '//dashboard.tosspayments.com/receipt',
      'dashboard.tosspayments.com/receipt',
    ]) {
      expect(isAllowedTossReceiptUrl(url), url).toBe(false);
    }
  });

  it('다른 호스트와 접미 위장 호스트를 거절한다', () => {
    for (const url of [
      'https://evil.com/receipt',
      'https://tosspayments.com.evil.com/receipt',
      'https://nottosspayments.com/receipt',
      'https://eviltosspayments.com/receipt',
      'https://tosspayments.co.kr/receipt',
      'https://evil.com/tosspayments.com',
      'https://evil.com/?next=https://dashboard.tosspayments.com',
      'https://evil.com#.tosspayments.com',
      'https://tosspayments.com.@evil.com/receipt',
      'https://dashboard.tosspayments.com@evil.com/receipt',
      'https://tosspayments.com./receipt',
    ]) {
      expect(isAllowedTossReceiptUrl(url), url).toBe(false);
    }
  });

  it('계정 정보·비표준 포트·공백·제어문자·역슬래시가 섞이면 거절한다', () => {
    for (const url of [
      'https://user:secret@dashboard.tosspayments.com/receipt',
      'https://user@dashboard.tosspayments.com/receipt',
      'https://dashboard.tosspayments.com:8443/receipt',
      ' https://dashboard.tosspayments.com/receipt',
      'https://dashboard.tosspayments.com/re ceipt',
      'https://dashboard.tosspayments.com/receipt\n',
      'https://evil.com\\@dashboard.tosspayments.com/receipt',
      'https://dashboard.tosspayments.com/\u0000receipt',
    ]) {
      expect(isAllowedTossReceiptUrl(url), JSON.stringify(url)).toBe(false);
    }
  });

  it('길이 2048자까지만 허용한다(2049자 거절)', () => {
    const prefix = 'https://dashboard.tosspayments.com/receipt/';
    const exact = prefix + 'a'.repeat(2048 - prefix.length);
    expect(exact).toHaveLength(2048);
    expect(isAllowedTossReceiptUrl(exact)).toBe(true);
    expect(isAllowedTossReceiptUrl(`${exact}a`)).toBe(false);
  });

  it('문자열이 아니거나 비어 있거나 파싱되지 않으면 거절한다', () => {
    for (const value of [undefined, null, 0, {}, [], ['https://tosspayments.com/receipt'], '', 'not a url', 'https://']) {
      expect(isAllowedTossReceiptUrl(value), String(value)).toBe(false);
    }
  });
});
