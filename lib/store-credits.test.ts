import { describe, expect, it } from 'vitest';
import { normalizeStoreCreditAmount, parseStoreCreditCheckoutQuote, parseStoreCreditHistory, parseStoreCreditPolicyInput } from './store-credits';

describe('적립금 정책 입력과 주문 사용', () => {
  it('금액을 원 단위 정수로만 받고 빈 요청만 0원 미사용으로 구별한다', () => {
    expect(normalizeStoreCreditAmount(undefined)).toBe(0);
    expect(normalizeStoreCreditAmount('0')).toBe(0);
    expect(normalizeStoreCreditAmount('1200')).toBe(1200);
    expect(normalizeStoreCreditAmount('1.5')).toBeNull();
    expect(normalizeStoreCreditAmount('-1')).toBeNull();
    expect(normalizeStoreCreditAmount('1e3')).toBeNull();
  });

  it('미설정 수치를 임의의 0으로 저장하지 않고 비활성 초안으로 보존한다', () => {
    const result = parseStoreCreditPolicyInput(new FormData());
    expect(result).toEqual({ ok: true, policy: {
      enabled: false, earnKind: null, earnValue: null, earnMaxPerOrder: null,
      maxBalance: null, validityDays: null, minUse: null, maxUse: null,
      restoreGraceDays: null, refundEarnedCreditMode: null, evidence: '',
    } });
  });
  it('활성화에는 모든 승인값을 요구하며 복원 유효기간의 명시적 0을 보존한다', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ enabled: 'on', earnKind: 'rate_bps', earnValue: '100', earnMaxPerOrder: '1000', maxBalance: '5000', validityDays: '30', minUse: '100', maxUse: '2000', restoreGraceDays: '0', refundEarnedCreditMode: 'offset_future_credits', evidence: '합성 검증 정책' })) form.set(key, value);
    expect(parseStoreCreditPolicyInput(form)).toMatchObject({ ok: true, policy: { restoreGraceDays: 0 } });
    form.delete('maxBalance');
    expect(parseStoreCreditPolicyInput(form)).toMatchObject({ ok: false });
  });
});

describe('적립금 서버 응답의 금액·상태 검증', () => {
  const quote = { enabled: true, available: 1000, reserved: 200, debt: 0, minUse: 100, maxUse: 800, requestedAmount: 500, valid: true, reason: null };
  it('완전한 견적만 사용하고 누락·소수·정책 불일치 응답은 unavailable로 거른다', () => {
    expect(parseStoreCreditCheckoutQuote(quote)).toEqual(quote);
    expect(parseStoreCreditCheckoutQuote({ enabled: true })).toBeNull();
    expect(parseStoreCreditCheckoutQuote({ ...quote, available: 1.5 })).toBeNull();
    expect(parseStoreCreditCheckoutQuote({ ...quote, debt: 100 })).toBeNull();
    expect(parseStoreCreditCheckoutQuote({ ...quote, reason: 'store_credit_amount_invalid' })).toBeNull();
    expect(parseStoreCreditCheckoutQuote({ ...quote, maxUse: 2000 })).toBeNull();
    expect(parseStoreCreditCheckoutQuote({ ...quote, enabled: false })).toBeNull();
  });
  it('비활성 정책의 미사용 0원 상태는 실제 0원으로만 허용한다', () => {
    const disabled = { ...quote, enabled: false, minUse: null, maxUse: 0, requestedAmount: 0, reason: 'store_credit_disabled' };
    expect(parseStoreCreditCheckoutQuote(disabled)).toEqual(disabled);
    expect(parseStoreCreditCheckoutQuote({ ...disabled, requestedAmount: 500 })).toBeNull();
  });
  it('이력 응답의 실제 전체 건수와 출처·금액 필드를 검증한다', () => {
    const history = { userId: '00000000-0000-4000-8000-000000004881', enabled: false, available: 1000, reserved: 0, debt: 0, total: 1, page: 1, pageSize: 30, items: [{
      id: '1', kind: 'grant', amount: 1000, availableDelta: 1000, reservedDelta: 0, debtDelta: 0,
      orderId: '20000000-0000-4000-8000-000000004881', lotId: '30000000-0000-4000-8000-000000004881', actorId: null,
      reason: '', expiresAt: '2026-10-10T00:00:00Z', createdAt: '2026-09-10T00:00:00Z',
    }] };
    expect(parseStoreCreditHistory(history)).toEqual(history);
    expect(parseStoreCreditHistory({ ...history, reserved: undefined })).toBeNull();
    expect(parseStoreCreditHistory({ ...history, total: 0 })).toBeNull();
    expect(parseStoreCreditHistory({ ...history, items: [{ ...history.items[0], availableDelta: undefined }] })).toBeNull();
  });
});
