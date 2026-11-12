import { describe, expect, it } from 'vitest';
import {
  PHONE_COUNTRIES,
  allowedPhoneCountries,
  allowsInternationalEntry,
  maskPhoneNumber,
  normalizePhoneNumber,
  parsePhoneAllowlist,
} from './phone-number';

const ALL = parsePhoneAllowlist('*');
const KOREA_ONLY = parsePhoneAllowlist(undefined);

describe('normalizePhoneNumber (1014-005·006)', () => {
  it.each([
    ['010-1234-5678', '+821012345678'],
    ['01012345678', '+821012345678'],
    ['010 1234 5678', '+821012345678'],
    ['+82 10-1234-5678', '+821012345678'],
    ['+82 010-1234-5678', '+821012345678'],
    ['0082 10 1234 5678', '+821012345678'],
    ['011-123-4567', '+82111234567'],
  ])('normalizes the Korean mobile number %s to E.164', (raw, e164) => {
    expect(normalizePhoneNumber('KR', raw, KOREA_ONLY)).toEqual({ ok: true, e164 });
  });

  it.each(['02-123-4567', '010-123', '0101234567890', '070-1234-5678', '+82 2 123 4567'])('rejects the non-mobile or malformed Korean number %s', (raw) => {
    expect(normalizePhoneNumber('KR', raw, KOREA_ONLY)).toMatchObject({ ok: false });
  });

  it('accepts national input for listed countries, dropping the trunk zero where the country uses one', () => {
    expect(normalizePhoneNumber('JP', '090-1234-5678', ALL)).toEqual({ ok: true, e164: '+819012345678' });
    expect(normalizePhoneNumber('US', '(415) 555-0123', ALL)).toEqual({ ok: true, e164: '+14155550123' });
    expect(normalizePhoneNumber('TW', '0912 345 678', ALL)).toEqual({ ok: true, e164: '+886912345678' });
  });

  /* 목록에 없는 나라도 '+국가번호' 국제 형식이면 받는다(국가 번호를 고정 목록으로 좁히지 않는다). */
  it('accepts any country in international form when that country is open', () => {
    expect(normalizePhoneNumber('INTL', '+351 912 345 678', ALL)).toEqual({ ok: true, e164: '+351912345678' });
    expect(normalizePhoneNumber('KR', '+44 7700 900123', ALL)).toEqual({ ok: true, e164: '+447700900123' });
    expect(normalizePhoneNumber('INTL', '00 971 50 123 4567', parsePhoneAllowlist('KR,+971'))).toEqual({ ok: true, e164: '+971501234567' });
  });

  it('refuses countries that are not open, national input for the international option, letters and over-long input', () => {
    expect(normalizePhoneNumber('JP', '090-1234-5678', KOREA_ONLY)).toEqual({ ok: false, error: '아직 이 나라 번호는 인증할 수 없어요. 다른 번호로 인증해주세요.' });
    expect(normalizePhoneNumber('KR', '+81 90 1234 5678', KOREA_ONLY)).toEqual({ ok: false, error: '아직 이 나라 번호는 인증할 수 없어요. 다른 번호로 인증해주세요.' });
    expect(normalizePhoneNumber('INTL', '7700 900123', ALL)).toEqual({ ok: false, error: '국가 번호를 포함해 +로 시작하게 입력해주세요. 예: +44 7700 900123' });
    expect(normalizePhoneNumber('XX', '010-1234-5678', ALL)).toEqual({ ok: false, error: '인증할 수 없는 나라예요. 목록에서 나라를 다시 골라주세요.' });
    expect(normalizePhoneNumber('US', '415-CALL-NOW', ALL)).toEqual({ ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' });
    expect(normalizePhoneNumber('US', '1'.repeat(41), ALL)).toEqual({ ok: false, error: '휴대폰 번호를 입력해주세요.' });
    expect(normalizePhoneNumber('US', '4155550123456789', ALL)).toEqual({ ok: false, error: '휴대폰 번호를 다시 확인해주세요.' });
    expect(normalizePhoneNumber('US', '   ', ALL)).toEqual({ ok: false, error: '휴대폰 번호를 입력해주세요.' });
  });
});

describe('parsePhoneAllowlist', () => {
  it('opens only Korea when unset', () => {
    expect(KOREA_ONLY).toEqual({ all: false, dialCodes: ['82'] });
    expect(parsePhoneAllowlist(' ')).toEqual({ all: false, dialCodes: ['82'] });
  });

  it("reads ISO codes from the list, calling codes with or without '+', and '*' for every country", () => {
    expect(parsePhoneAllowlist('us, kr ,JP,+44,971')).toEqual({ all: false, dialCodes: ['1', '82', '81', '44', '971'] });
    expect(parsePhoneAllowlist('KR,*')).toEqual({ all: true, dialCodes: [] });
  });

  /* 알 수 없는 값이 섞여도 기능 전체를 끄지 않는다. 받을 값이 하나도 없으면 한국만 연다. */
  it('skips unknown entries instead of closing the feature', () => {
    expect(parsePhoneAllowlist('KR,ZZ,+0,abc')).toEqual({ all: false, dialCodes: ['82'] });
    expect(parsePhoneAllowlist('ZZ')).toEqual({ all: false, dialCodes: ['82'] });
  });

  it('lists only open countries and offers international entry for open codes outside the list', () => {
    expect(allowedPhoneCountries(parsePhoneAllowlist('KR,JP')).map((country) => country.iso)).toEqual(['KR', 'JP']);
    expect(allowsInternationalEntry(parsePhoneAllowlist('KR,JP'))).toBe(false);
    expect(allowsInternationalEntry(parsePhoneAllowlist('KR,+351'))).toBe(true);
    expect(allowsInternationalEntry(ALL)).toBe(true);
    expect(allowedPhoneCountries(ALL)).toHaveLength(PHONE_COUNTRIES.length);
  });

  it('has unique ISO codes and dial codes only made of digits', () => {
    expect(new Set(PHONE_COUNTRIES.map((country) => country.iso)).size).toBe(PHONE_COUNTRIES.length);
    for (const country of PHONE_COUNTRIES) expect(country.dial).toMatch(/^[1-9]\d{0,2}$/);
  });
});

describe('maskPhoneNumber', () => {
  it('shows Korean numbers in domestic form, listed countries with the country code, others with the last four digits', () => {
    expect(maskPhoneNumber('+821012345678')).toBe('010-****-5678');
    expect(maskPhoneNumber('+82111234567')).toBe('011-****-4567');
    expect(maskPhoneNumber('+819012345678')).toBe('+81 ****5678');
    expect(maskPhoneNumber('+886912345678')).toBe('+886 ****5678');
    expect(maskPhoneNumber('+14155550123')).toBe('+1 ****0123');
    expect(maskPhoneNumber('+351912345678')).toBe('+ ****5678');
    expect(maskPhoneNumber('not-a-number')).toBe('');
  });
});
