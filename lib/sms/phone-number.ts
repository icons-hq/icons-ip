/*
 * 휴대폰 번호 인증(1014-005·006, 해외 번호 포함)의 번호 정규화.
 *
 * 화면은 나라를 고르고 그 나라에서 쓰는 번호를 받거나, '+국가번호'로 시작하는 국제 형식을 그대로 받는다. 서버가
 * E.164(+국가번호 + 번호, 최대 15자리)로 합친다. 한국 번호만 휴대폰 번호 형식(010 등)까지 확인하고, 다른 나라는
 * 국가별 자리 규칙을 지어내지 않고 E.164 길이만 본다 — 실제 도달은 발송사가 판정한다.
 *
 * 어느 나라 번호를 받을지는 운영값 ICONS_PHONE_VERIFICATION_COUNTRIES다. 목록의 나라 코드(KR·JP …)나 국가 번호
 * (+44·852 …)를 쉼표로 적고, '*'는 모든 나라다. 비우면 한국만 연다 — 해외 SMS는 단가·도달률이 발송사 계약(H4)
 * 전이고 국제 SMS 펌핑 위험이 있어 연 나라만 받는다(근거: docs/runbooks/signup-contact-channels.md §4). 알 수 없는
 * 값은 건너뛰고 기능을 끄지 않는다.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 */
  iso: string;
  /** 국가 번호(+ 없이) */
  dial: string;
  label: string;
  /** 국내에서 번호 앞에 붙이는 0(trunk prefix)을 쓰는 나라. 국제 형식으로 바꿀 때 한 번 뗀다. */
  trunkZero: boolean;
}

/** 화면에서 고를 수 있게 이름을 붙여 둔 나라들. 여기 없는 나라도 '+국가번호' 국제 형식으로 받는다. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: 'KR', dial: '82', label: '대한민국 (+82)', trunkZero: true },
  { iso: 'JP', dial: '81', label: '일본 (+81)', trunkZero: true },
  { iso: 'CN', dial: '86', label: '중국 (+86)', trunkZero: false },
  { iso: 'TW', dial: '886', label: '대만 (+886)', trunkZero: true },
  { iso: 'HK', dial: '852', label: '홍콩 (+852)', trunkZero: false },
  { iso: 'MO', dial: '853', label: '마카오 (+853)', trunkZero: false },
  { iso: 'SG', dial: '65', label: '싱가포르 (+65)', trunkZero: false },
  { iso: 'TH', dial: '66', label: '태국 (+66)', trunkZero: true },
  { iso: 'VN', dial: '84', label: '베트남 (+84)', trunkZero: true },
  { iso: 'PH', dial: '63', label: '필리핀 (+63)', trunkZero: true },
  { iso: 'ID', dial: '62', label: '인도네시아 (+62)', trunkZero: true },
  { iso: 'MY', dial: '60', label: '말레이시아 (+60)', trunkZero: true },
  { iso: 'US', dial: '1', label: '미국·캐나다 (+1)', trunkZero: false },
  { iso: 'GB', dial: '44', label: '영국 (+44)', trunkZero: true },
  { iso: 'FR', dial: '33', label: '프랑스 (+33)', trunkZero: true },
  { iso: 'DE', dial: '49', label: '독일 (+49)', trunkZero: true },
  { iso: 'AU', dial: '61', label: '호주 (+61)', trunkZero: true },
];

export const DEFAULT_PHONE_COUNTRY_ISO = 'KR';
/** 목록에 없는 나라를 '+국가번호'로 입력하는 선택지의 값. */
export const INTERNATIONAL_PHONE_OPTION = 'INTL';

/** 한국 휴대폰 번호(0 뗀 국내 번호): 10·11·16·17·18·19로 시작하는 9~10자리. */
const KR_MOBILE = /^1[016789]\d{7,8}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const DIAL_CODE = /^\+?([1-9]\d{0,2})$/;

/** 운영값으로 연 범위. all이면 모든 나라, 아니면 국가 번호 앞자리 목록이다. */
export interface PhoneAllowlist {
  all: boolean;
  dialCodes: string[];
}

export type PhoneNumberResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

export function phoneCountryByIso(iso: unknown): PhoneCountry | null {
  return typeof iso === 'string' ? PHONE_COUNTRIES.find((country) => country.iso === iso) ?? null : null;
}

/** 국가 번호가 가장 길게 맞는 목록의 나라. 목록 밖 나라면 null. */
function catalogCountryForDigits(digits: string): PhoneCountry | null {
  return [...PHONE_COUNTRIES]
    .sort((left, right) => right.dial.length - left.dial.length)
    .find((country) => digits.startsWith(country.dial)) ?? null;
}

/**
 * ICONS_PHONE_VERIFICATION_COUNTRIES를 읽는다. 비우면 한국만, '*'는 모든 나라다. 목록의 나라 코드와 국가 번호를
 * 받고, 알 수 없는 값은 건너뛴다(기능을 끄지 않는다). 받을 수 있는 값이 하나도 없으면 한국만 연다.
 */
export function parsePhoneAllowlist(value: string | undefined): PhoneAllowlist {
  const entries = (value ?? '').split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean);
  if (entries.includes('*')) return { all: true, dialCodes: [] };
  const dialCodes = new Set<string>();
  for (const entry of entries) {
    const country = phoneCountryByIso(entry);
    if (country) {
      dialCodes.add(country.dial);
      continue;
    }
    const dial = DIAL_CODE.exec(entry);
    if (dial) dialCodes.add(dial[1]);
  }
  if (dialCodes.size === 0) dialCodes.add(phoneCountryByIso(DEFAULT_PHONE_COUNTRY_ISO)?.dial ?? '82');
  return { all: false, dialCodes: [...dialCodes] };
}

export function phoneAllowlistAllows(allowlist: PhoneAllowlist, e164: string): boolean {
  const digits = e164.slice(1);
  return allowlist.all || allowlist.dialCodes.some((dial) => digits.startsWith(dial));
}

/** 화면의 나라 선택지: 연 범위에 드는 목록의 나라. */
export function allowedPhoneCountries(allowlist: PhoneAllowlist): PhoneCountry[] {
  return PHONE_COUNTRIES.filter((country) => allowlist.all || allowlist.dialCodes.includes(country.dial));
}

/** 목록에 없는 나라를 '+국가번호'로 받아야 하는지('*'이거나 목록 밖 국가 번호를 열었을 때). */
export function allowsInternationalEntry(allowlist: PhoneAllowlist): boolean {
  return allowlist.all || allowlist.dialCodes.some((dial) => !PHONE_COUNTRIES.some((country) => country.dial === dial));
}

function normalizedInternational(digits: string): string {
  const country = catalogCountryForDigits(digits);
  /* '+82 010…'처럼 국제 형식에 국내 앞자리 0을 남긴 입력은 그 0을 뗀다. */
  if (country?.trunkZero && digits.slice(country.dial.length).startsWith('0')) {
    return `${country.dial}${digits.slice(country.dial.length + 1)}`;
  }
  return digits;
}

export function normalizePhoneNumber(countryOption: unknown, raw: unknown, allowlist: PhoneAllowlist): PhoneNumberResult {
  if (typeof raw !== 'string' || raw.length > 40) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };
  let digits = raw.replace(/[\s().-]/g, '');
  if (!digits) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };

  const international = digits.startsWith('+') || digits.startsWith('00');
  if (international) {
    digits = digits.startsWith('+') ? digits.slice(1) : digits.slice(2);
    if (!/^\d+$/.test(digits)) return { ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' };
    digits = normalizedInternational(digits);
  } else {
    if (countryOption === INTERNATIONAL_PHONE_OPTION) {
      return { ok: false, error: '국가 번호를 포함해 +로 시작하게 입력해주세요. 예: +44 7700 900123' };
    }
    const country = phoneCountryByIso(countryOption);
    if (!country) return { ok: false, error: '인증할 수 없는 나라예요. 목록에서 나라를 다시 골라주세요.' };
    if (!/^\d+$/.test(digits)) return { ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' };
    if (country.trunkZero && digits.startsWith('0')) digits = digits.slice(1);
    digits = `${country.dial}${digits}`;
  }

  const e164 = `+${digits}`;
  if (!E164.test(e164)) return { ok: false, error: '휴대폰 번호를 다시 확인해주세요.' };
  if (!phoneAllowlistAllows(allowlist, e164)) {
    return { ok: false, error: '아직 이 나라 번호는 인증할 수 없어요. 다른 번호로 인증해주세요.' };
  }
  if (digits.startsWith('82') && !KR_MOBILE.test(digits.slice(2))) {
    return { ok: false, error: '휴대폰 번호를 다시 확인해주세요. 예: 010-1234-5678' };
  }
  const country = catalogCountryForDigits(digits);
  if (country && digits.length - country.dial.length < 6) return { ok: false, error: '휴대폰 번호를 다시 확인해주세요.' };
  return { ok: true, e164 };
}

/** 화면 표시용으로 가린 번호. 한국 번호는 국내 형식(010-****-5678), 목록의 나라는 +국가번호와 끝 4자리, 그 밖은 끝 4자리만. */
export function maskPhoneNumber(e164: string): string {
  if (!E164.test(e164)) return '';
  const digits = e164.slice(1);
  const country = catalogCountryForDigits(digits);
  if (country?.iso === 'KR') {
    const national = `0${digits.slice(2)}`;
    return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
  }
  return country ? `+${country.dial} ****${digits.slice(-4)}` : `+ ****${digits.slice(-4)}`;
}

/** 인증번호 문자를 한국어로 보낼지(한국 번호) 영어로 보낼지. */
export function isKoreanPhoneNumber(e164: string): boolean {
  return e164.startsWith('+82');
}
