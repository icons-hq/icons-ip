import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { findCountryName } from '@/lib/country-names';

export interface PhoneCountry {
  iso: CountryCode;
  dial: string;
  label: string;
}

const regionNames = new Intl.DisplayNames('ko', { type: 'region' });
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries().map(iso => ({
  iso,
  dial: getCountryCallingCode(iso),
  label: findCountryName(iso)?.name ?? regionNames.of(iso) ?? iso,
})).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
const countriesByIso = new Map<string, PhoneCountry>(PHONE_COUNTRIES.map(country => [country.iso, country]));
const callingCodes = new Set(PHONE_COUNTRIES.map(country => country.dial));

export const DEFAULT_PHONE_COUNTRY_ISO = 'KR';
export const INTERNATIONAL_PHONE_OPTION = 'INTL';

const KR_MOBILE = /^1[016789]\d{7,8}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const DIAL_CODE = /^\+?([1-9]\d{0,2})$/;

export interface PhoneAllowlist {
  all: boolean;
  dialCodes: string[];
}

export type PhoneNumberResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

/** 운영값은 국가번호 단위다. 같은 번호를 공유하는 국가·지역은 함께 열리고, 빈 설정은 한국만 연다. */
export function parsePhoneAllowlist(value: string | undefined): PhoneAllowlist {
  const entries = (value ?? '').split(',').map(entry => entry.trim().toUpperCase()).filter(Boolean);
  if (entries.includes('*')) return { all: true, dialCodes: [] };
  const dialCodes = new Set<string>();
  for (const entry of entries) {
    const dial = countriesByIso.get(entry)?.dial ?? DIAL_CODE.exec(entry)?.[1];
    if (dial) dialCodes.add(dial);
  }
  if (!dialCodes.size) dialCodes.add(getCountryCallingCode(DEFAULT_PHONE_COUNTRY_ISO));
  return { all: false, dialCodes: [...dialCodes] };
}

export function phoneAllowlistAllows(allowlist: PhoneAllowlist, e164: string): boolean {
  const digits = e164.slice(1);
  return allowlist.all || allowlist.dialCodes.some(dial => digits.startsWith(dial));
}

export function allowedPhoneCountries(allowlist: PhoneAllowlist): PhoneCountry[] {
  return PHONE_COUNTRIES.filter(country => allowlist.all || allowlist.dialCodes.includes(country.dial));
}

export function allowsInternationalEntry(allowlist: PhoneAllowlist): boolean {
  return allowlist.all || allowlist.dialCodes.some(dial => !callingCodes.has(dial));
}

export function normalizePhoneNumber(countryOption: unknown, raw: unknown, allowlist: PhoneAllowlist): PhoneNumberResult {
  if (typeof raw !== 'string' || raw.length > 40) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };
  const input = raw.replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!input) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };
  if (!/^\+?\d+$/.test(input)) return { ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' };

  const international = input.startsWith('+');
  const country = typeof countryOption === 'string' ? countriesByIso.get(countryOption) : undefined;
  if (!international && !country) {
    return { ok: false, error: countryOption === INTERNATIONAL_PHONE_OPTION
      ? '국가 번호를 포함해 +로 시작하게 입력해주세요. 예: +44 7700 900123'
      : '인증할 수 없는 나라예요. 목록에서 나라를 다시 골라주세요.' };
  }

  // 국가별 국내 접두사 제거·보존은 번호 메타데이터에 맡긴다. 국제번호를 붙여넣으면 그 번호가 우선한다.
  const parsed = parsePhoneNumberFromString(input, { defaultCountry: country?.iso, extract: false });
  // 메타데이터 밖의 국제번호도 운영에서 연 범위 안에서는 기존의 직접 입력을 받는다.
  const e164 = parsed?.number ?? (international ? input : '');
  if (!E164.test(e164)) return { ok: false, error: '휴대폰 번호를 다시 확인해주세요.' };
  if (!phoneAllowlistAllows(allowlist, e164)) {
    return { ok: false, error: '아직 이 나라 번호는 인증할 수 없어요. 다른 번호로 인증해주세요.' };
  }
  if (isKoreanPhoneNumber(e164) && !KR_MOBILE.test(e164.slice(3))) {
    return { ok: false, error: '휴대폰 번호를 다시 확인해주세요. 예: 010-1234-5678' };
  }
  if (parsed && !parsed.isPossible()) return { ok: false, error: '휴대폰 번호를 다시 확인해주세요.' };
  return { ok: true, e164 };
}

export function maskPhoneNumber(e164: string): string {
  if (!E164.test(e164)) return '';
  if (isKoreanPhoneNumber(e164)) {
    const national = `0${e164.slice(3)}`;
    return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
  }
  const dial = parsePhoneNumberFromString(e164)?.countryCallingCode ?? '';
  return `+${dial} ****${e164.slice(-4)}`;
}

export function isKoreanPhoneNumber(e164: string): boolean {
  return e164.startsWith('+82');
}
