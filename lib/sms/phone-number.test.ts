import { describe, expect, it } from 'vitest';
import {
  PHONE_COUNTRIES,
  maskPhoneNumber,
  normalizePhoneNumber,
  parseAllowedPhoneCountries,
} from './phone-number';

describe('normalizePhoneNumber (1014-005·006)', () => {
  it.each([
    ['010-1234-5678', '+821012345678'],
    ['01012345678', '+821012345678'],
    ['010 1234 5678', '+821012345678'],
    ['+82 10-1234-5678', '+821012345678'],
    ['0082 10 1234 5678', '+821012345678'],
    ['011-123-4567', '+82111234567'],
  ])('normalizes the Korean mobile number %s to E.164', (raw, e164) => {
    expect(normalizePhoneNumber('KR', raw)).toMatchObject({ ok: true, e164 });
  });

  it.each(['02-123-4567', '010-123', '0101234567890', '070-1234-5678'])('rejects the non-mobile or malformed Korean number %s', (raw) => {
    expect(normalizePhoneNumber('KR', raw)).toEqual({ ok: false, error: '휴대폰 번호를 다시 확인해주세요. 예: 010-1234-5678' });
  });

  it('accepts overseas numbers in national or international form and drops the trunk zero where the country uses one', () => {
    expect(normalizePhoneNumber('JP', '090-1234-5678')).toMatchObject({ ok: true, e164: '+819012345678' });
    expect(normalizePhoneNumber('US', '(415) 555-0123')).toMatchObject({ ok: true, e164: '+14155550123' });
    expect(normalizePhoneNumber('US', '+1 415 555 0123')).toMatchObject({ ok: true, e164: '+14155550123' });
    expect(normalizePhoneNumber('TW', '0912 345 678')).toMatchObject({ ok: true, e164: '+886912345678' });
  });

  it('refuses a country code that differs from the chosen country, letters, and over-long input', () => {
    expect(normalizePhoneNumber('KR', '+81 90 1234 5678')).toEqual({ ok: false, error: '고른 나라와 번호의 국가 번호가 달라요.' });
    expect(normalizePhoneNumber('US', '415-CALL-NOW')).toEqual({ ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' });
    expect(normalizePhoneNumber('US', '1'.repeat(41))).toEqual({ ok: false, error: '휴대폰 번호를 입력해주세요.' });
    expect(normalizePhoneNumber('US', '4155550123456789')).toEqual({ ok: false, error: '휴대폰 번호를 다시 확인해주세요.' });
    expect(normalizePhoneNumber('US', '   ')).toEqual({ ok: false, error: '휴대폰 번호를 입력해주세요.' });
  });

  it('only accepts countries opened by the operator allowlist', () => {
    const koreaOnly = parseAllowedPhoneCountries(undefined) ?? [];
    expect(normalizePhoneNumber('JP', '090-1234-5678', koreaOnly)).toEqual({
      ok: false,
      error: '인증할 수 없는 나라예요. 목록에서 나라를 다시 골라주세요.',
    });
    expect(normalizePhoneNumber('XX', '010-1234-5678')).toMatchObject({ ok: false });
  });
});

describe('parseAllowedPhoneCountries', () => {
  it('opens only Korea when unset and keeps catalog order for a list', () => {
    expect(parseAllowedPhoneCountries(undefined)?.map((country) => country.iso)).toEqual(['KR']);
    expect(parseAllowedPhoneCountries(' ')?.map((country) => country.iso)).toEqual(['KR']);
    expect(parseAllowedPhoneCountries('us, kr ,JP')?.map((country) => country.iso)).toEqual(['KR', 'JP', 'US']);
  });

  it('fails closed on an unknown code', () => {
    expect(parseAllowedPhoneCountries('KR,ZZ')).toBeNull();
  });

  it('has unique ISO codes and dial codes only made of digits', () => {
    expect(new Set(PHONE_COUNTRIES.map((country) => country.iso)).size).toBe(PHONE_COUNTRIES.length);
    for (const country of PHONE_COUNTRIES) expect(country.dial).toMatch(/^[1-9]\d{0,2}$/);
  });
});

describe('maskPhoneNumber', () => {
  it('shows Korean numbers in domestic form and others with the country code and last four digits', () => {
    expect(maskPhoneNumber('+821012345678')).toBe('010-****-5678');
    expect(maskPhoneNumber('+82111234567')).toBe('011-****-4567');
    expect(maskPhoneNumber('+819012345678')).toBe('+81 ****5678');
    expect(maskPhoneNumber('+886912345678')).toBe('+886 ****5678');
    expect(maskPhoneNumber('+14155550123')).toBe('+1 ****0123');
    expect(maskPhoneNumber('not-a-number')).toBe('');
  });
});
