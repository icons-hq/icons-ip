import { describe, expect, it } from 'vitest';
import { orderPaymentMethodLabel, parseOrderPaymentDisplay, type OrderPaymentDisplay } from './payment-display';

const valid = {
  provider: 'toss',
  method: '카드',
  detail: '43301234****123*',
  approvedAt: '2026-11-17T05:00:00.123456+00:00',
};

describe('parseOrderPaymentDisplay', () => {
  it('RPC가 내보내는 정확한 4키를 읽는다', () => {
    expect(parseOrderPaymentDisplay(valid)).toEqual(valid);
    expect(parseOrderPaymentDisplay({ provider: 'korpay', method: null, detail: null, approvedAt: null })).toEqual({
      provider: 'korpay',
      method: null,
      detail: null,
      approvedAt: null,
    });
  });

  it('approvedAt은 Postgres·Z·오프셋 ISO 표기를 받는다', () => {
    for (const approvedAt of [
      '2026-11-17T05:00:00+00:00',
      '2026-11-17T05:00:00Z',
      '2026-11-17T14:00:00.5+09:00',
      '2026-11-17T14:00:00.123456+0900',
    ]) {
      expect(parseOrderPaymentDisplay({ ...valid, approvedAt })?.approvedAt, approvedAt).toBe(approvedAt);
    }
  });

  it('null·비객체·배열은 거절한다', () => {
    for (const value of [null, undefined, 'toss', 7, true, [valid], [], new Date()]) {
      expect(parseOrderPaymentDisplay(value), String(value)).toBeNull();
    }
  });

  it('키가 정확히 4개가 아니면 거절한다(누락·추가)', () => {
    const { detail: _detail, ...missing } = valid;
    void _detail;
    expect(parseOrderPaymentDisplay(missing)).toBeNull();
    expect(parseOrderPaymentDisplay({ ...valid, paymentKey: 'tgen_secret' })).toBeNull();
    expect(parseOrderPaymentDisplay({ ...valid, resultCode: 'DONE' })).toBeNull();
    expect(parseOrderPaymentDisplay({ provider: 'toss', method: '카드', detail: null, approved_at: null })).toBeNull();
    expect(parseOrderPaymentDisplay({})).toBeNull();
  });

  it('provider는 비어 있지 않은 32자 이하 문자열이어야 한다', () => {
    expect(parseOrderPaymentDisplay({ ...valid, provider: 'a'.repeat(32) })?.provider).toBe('a'.repeat(32));
    for (const provider of ['a'.repeat(33), '', ' ', null, 1, undefined, ' toss']) {
      expect(parseOrderPaymentDisplay({ ...valid, provider }), String(provider)).toBeNull();
    }
  });

  it('method는 50자, detail은 100자까지이고 문자열 아닌 값·빈 문자열은 거절한다', () => {
    expect(parseOrderPaymentDisplay({ ...valid, method: 'm'.repeat(50) })?.method).toHaveLength(50);
    expect(parseOrderPaymentDisplay({ ...valid, method: 'm'.repeat(51) })).toBeNull();
    expect(parseOrderPaymentDisplay({ ...valid, detail: 'd'.repeat(100) })?.detail).toHaveLength(100);
    expect(parseOrderPaymentDisplay({ ...valid, detail: 'd'.repeat(101) })).toBeNull();
    for (const bad of ['', ' ', 12, true, {}, ['카드'], undefined]) {
      expect(parseOrderPaymentDisplay({ ...valid, method: bad }), `method ${String(bad)}`).toBeNull();
      expect(parseOrderPaymentDisplay({ ...valid, detail: bad }), `detail ${String(bad)}`).toBeNull();
    }
  });

  it('approvedAt은 ISO 문자열 또는 null만 받는다', () => {
    for (const approvedAt of [
      '2026-11-17',
      '2026-11-17 05:00:00+00',
      '2026-11-17T05:00:00',
      '2026-11-17T14:00:00+09',
      '2026-13-45T25:61:61Z',
      'yesterday',
      '',
      1763355600000,
      new Date(),
      undefined,
    ]) {
      expect(parseOrderPaymentDisplay({ ...valid, approvedAt }), String(approvedAt)).toBeNull();
    }
  });
});

describe('orderPaymentMethodLabel', () => {
  const display = (method: string | null, detail: string | null = null): OrderPaymentDisplay => ({
    provider: 'toss',
    method,
    detail,
    approvedAt: null,
  });

  it('무통장 주문은 근거와 상관없이 무통장 입금이다', () => {
    expect(orderPaymentMethodLabel('bank_transfer', null)).toBe('무통장 입금');
    expect(orderPaymentMethodLabel('bank_transfer', display('카드', '4330****'))).toBe('무통장 입금');
  });

  it('근거가 없으면 카드·간편결제다', () => {
    expect(orderPaymentMethodLabel('card', null)).toBe('카드·간편결제');
  });

  it('카드(한글 카드·영문 CARD)는 신용·체크카드 + 마스킹 표기다', () => {
    expect(orderPaymentMethodLabel('card', display('카드', '43301234****123*'))).toBe('신용·체크카드 (43301234****123*)');
    expect(orderPaymentMethodLabel('card', display('CARD', '1234-****-****-5678'))).toBe('신용·체크카드 (1234-****-****-5678)');
    expect(orderPaymentMethodLabel('card', display('CARD'))).toBe('신용·체크카드');
    expect(orderPaymentMethodLabel('card', display('카드'))).toBe('신용·체크카드');
  });

  it('간편결제는 결제사를 괄호로 보인다', () => {
    expect(orderPaymentMethodLabel('card', display('간편결제', '네이버페이'))).toBe('간편결제 (네이버페이)');
    expect(orderPaymentMethodLabel('card', display('간편결제'))).toBe('간편결제');
  });

  it('방식과 같은 글자의 보조 표기는 중복이라 뺀다', () => {
    expect(orderPaymentMethodLabel('card', display('카드', '카드'))).toBe('신용·체크카드');
    expect(orderPaymentMethodLabel('card', display('CARD', 'card'))).toBe('신용·체크카드');
    expect(orderPaymentMethodLabel('card', display('간편결제', '간편결제'))).toBe('간편결제');
  });

  it('그 밖 방식(계좌이체·휴대폰·가상계좌)은 결제사가 준 이름 그대로다', () => {
    expect(orderPaymentMethodLabel('card', display('계좌이체', '계좌이체'))).toBe('계좌이체');
    expect(orderPaymentMethodLabel('card', display('휴대폰', '010-****-1234'))).toBe('휴대폰');
    expect(orderPaymentMethodLabel('card', display('가상계좌'))).toBe('가상계좌');
  });

  it('방식은 모르고 표기만 있으면 카드·간편결제 + 표기다', () => {
    expect(orderPaymentMethodLabel('card', display(null, '네이버페이'))).toBe('카드·간편결제 (네이버페이)');
    expect(orderPaymentMethodLabel('card', display(null, null))).toBe('카드·간편결제');
  });
});
