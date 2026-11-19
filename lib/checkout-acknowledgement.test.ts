import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_ACKNOWLEDGEMENT_VERSION,
  checkoutAcknowledgementText,
  claimNoticeOf,
  claimNoticeRecord,
  normalizeClaimNotice,
  checkoutRestrictionNotice,
  isCheckoutAcknowledged,
  parseCheckoutClaimRestrictions,
  restrictedCheckoutGoods,
} from './checkout-acknowledgement';

describe('결제 전 확인 동의 값', () => {
  it('정확히 true일 때만 동의다 — 문자열·숫자·객체는 동의가 아니다', () => {
    expect(isCheckoutAcknowledged(true)).toBe(true);
    for (const value of [false, undefined, null, 'true', 'on', 1, 0, {}, []]) expect(isCheckoutAcknowledged(value)).toBe(false);
  });

  it('고지 버전은 날짜 형식 문자열이고 DB 한도(40자) 안이다', () => {
    expect(CHECKOUT_ACKNOWLEDGEMENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CHECKOUT_ACKNOWLEDGEMENT_VERSION.length).toBeLessThanOrEqual(40);
  });

  it('제한 굿즈가 있으면 문구가 그 사실을 더한다', () => {
    expect(checkoutAcknowledgementText(false)).toBe('주문 굿즈·수량·결제 금액·배송지를 확인했으며, 구매 조건과 결제에 동의합니다.');
    expect(checkoutAcknowledgementText(true)).toContain('청약철회 또는 교환이 제한되는 굿즈가 포함되어 있음을 확인하고');
    expect(checkoutAcknowledgementText(true)).toContain('구매 조건과 결제에 동의합니다.');
  });

  it('품목 줄 고지는 어느 쪽이 제한인지 밝힌다', () => {
    const base = { goodId: 'g', reason: '각인 상품' };
    expect(checkoutRestrictionNotice({ ...base, returnAllowed: false, exchangeAllowed: false })).toBe('청약철회·교환 제한 — 각인 상품');
    expect(checkoutRestrictionNotice({ ...base, returnAllowed: false, exchangeAllowed: null })).toBe('청약철회 제한 · 교환 가능 — 각인 상품');
    expect(checkoutRestrictionNotice({ ...base, returnAllowed: true, exchangeAllowed: false })).toBe('교환 제한 · 청약철회 가능 — 각인 상품');
  });
});

describe('제한 굿즈 읽기', () => {
  it('제한이 아닌 행·형식이 틀린 행은 버리고 사유가 비면 개별 확인으로 채운다', () => {
    const parsed = parseCheckoutClaimRestrictions([
      { id: 'a', claim_return_allowed: false, claim_exchange_allowed: null, claim_restriction_reason: '  개봉 후 불가 ' },
      { id: 'b', claim_return_allowed: null, claim_exchange_allowed: false, claim_restriction_reason: ' ' },
      { id: 'c', claim_return_allowed: true, claim_exchange_allowed: true, claim_restriction_reason: null },
      { id: '', claim_return_allowed: false },
      { claim_return_allowed: false },
      null,
      'x',
    ]);
    expect(Object.keys(parsed).sort()).toEqual(['a', 'b']);
    expect(parsed.a).toEqual({ goodId: 'a', returnAllowed: false, exchangeAllowed: null, reason: '개봉 후 불가' });
    expect(parsed.b.reason).toBe('개별 확인');
    expect(parseCheckoutClaimRestrictions(null)).toEqual({});
    expect(parseCheckoutClaimRestrictions({})).toEqual({});
  });

  it('주문서 품목과 맞춰 중복 없이 순서대로 거른다', () => {
    const restrictions = parseCheckoutClaimRestrictions([
      { id: 'a', claim_return_allowed: false, claim_restriction_reason: 'r' },
      { id: 'b', claim_exchange_allowed: false, claim_restriction_reason: 'r' },
    ]);
    expect(restrictedCheckoutGoods(['b', 'x', 'a', 'b'], restrictions).map((r) => r.goodId)).toEqual(['b', 'a']);
    expect(restrictedCheckoutGoods(['constructor', '__proto__', 'toString'], restrictions)).toEqual([]);
  });
});

describe('화면이 보인 제한 고지', () => {
  const restrictions = parseCheckoutClaimRestrictions([
    { id: 'a', claim_return_allowed: false, claim_restriction_reason: 'r' },
    { id: 'b', claim_exchange_allowed: false, claim_restriction_reason: 'r' },
  ]);

  it('교환만 제한된 굿즈(b)도 문구가 청약철회 또는 교환 제한을 말한다', () => {
    expect(checkoutRestrictionNotice(restrictions.b)).toBe('교환 제한 · 청약철회 가능 — r');
    expect(checkoutAcknowledgementText(restrictedCheckoutGoods(['b'], restrictions).length > 0)).toContain('청약철회 또는 교환이 제한되는 굿즈');
  });

  it('품목 기준 보인 목록, 읽기 실패면 unavailable 표식이다', () => {
    expect(claimNoticeOf(restrictions, ['b', 'z', 'a', 'b'])).toEqual(['b', 'a']);
    expect(claimNoticeOf({}, ['a'])).toEqual([]);
    expect(claimNoticeOf(null, ['a'])).toBe('unavailable');
  });

  it('서버가 받은 값은 목록 또는 unavailable만 인정한다', () => {
    expect(normalizeClaimNotice('unavailable')).toBe('unavailable');
    expect(normalizeClaimNotice(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeClaimNotice([])).toEqual([]);
    for (const value of [undefined, null, 'a', 1, [1], [''], {}, new Array(201).fill('x')]) expect(normalizeClaimNotice(value), String(value)).toBeNull();
  });

  it('기록 모양', () => {
    expect(claimNoticeRecord(['a'])).toEqual({ goodIds: ['a'] });
    expect(claimNoticeRecord('unavailable')).toEqual({ unavailable: true });
    expect(claimNoticeRecord(null)).toBeNull();
  });
});
