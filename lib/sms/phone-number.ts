/*
 * 휴대폰 번호 인증(1014-005·006, 해외 번호 포함)의 번호 정규화.
 *
 * 화면은 나라(국가 번호)와 그 나라에서 쓰는 번호를 따로 받고, 서버가 E.164(+국가번호 + 번호, 최대 15자리)로
 * 합친다. 한국 번호만 휴대폰 번호 형식(010 등)까지 확인하고, 다른 나라는 국가별 자리 규칙을 지어내지 않고
 * E.164 길이만 본다 — 실제 도달은 발송사가 판정한다. 어느 나라를 열지는 운영값이다
 * (ICONS_PHONE_VERIFICATION_COUNTRIES, 기본은 한국만 — 해외 SMS 단가·도달률·펌핑 위험은 발송사 계약에서 정한다).
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

/** 한국 휴대폰 번호(0 뗀 국내 번호): 10·11·16·17·18·19로 시작하는 9~10자리. */
const KR_MOBILE = /^1[016789]\d{7,8}$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export type PhoneNumberResult =
  | { ok: true; e164: string; country: PhoneCountry }
  | { ok: false; error: string };

export function phoneCountryByIso(iso: unknown): PhoneCountry | null {
  return typeof iso === 'string' ? PHONE_COUNTRIES.find((country) => country.iso === iso) ?? null : null;
}

export function normalizePhoneNumber(countryIso: unknown, raw: unknown, allowed: readonly PhoneCountry[] = PHONE_COUNTRIES): PhoneNumberResult {
  const country = phoneCountryByIso(countryIso);
  if (!country || !allowed.some((candidate) => candidate.iso === country.iso)) {
    return { ok: false, error: '인증할 수 없는 나라예요. 목록에서 나라를 다시 골라주세요.' };
  }
  if (typeof raw !== 'string' || raw.length > 40) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };

  let digits = raw.replace(/[\s().-]/g, '');
  if (!digits) return { ok: false, error: '휴대폰 번호를 입력해주세요.' };
  /* 국가 번호까지 붙여 쓴 입력(+82 10…, 0082 10…)은 고른 나라와 같을 때만 받아 준다. */
  if (digits.startsWith('+')) {
    if (!digits.startsWith(`+${country.dial}`)) return { ok: false, error: '고른 나라와 번호의 국가 번호가 달라요.' };
    digits = digits.slice(country.dial.length + 1);
  } else if (digits.startsWith(`00${country.dial}`)) {
    digits = digits.slice(country.dial.length + 2);
  }
  if (!/^\d+$/.test(digits)) return { ok: false, error: '휴대폰 번호는 숫자로 입력해주세요.' };
  if (country.trunkZero && digits.startsWith('0')) digits = digits.slice(1);

  if (country.iso === 'KR' && !KR_MOBILE.test(digits)) {
    return { ok: false, error: '휴대폰 번호를 다시 확인해주세요. 예: 010-1234-5678' };
  }
  const e164 = `+${country.dial}${digits}`;
  if (!E164.test(e164) || digits.length < 6) return { ok: false, error: '휴대폰 번호를 다시 확인해주세요.' };
  return { ok: true, e164, country };
}

/** 화면 표시용으로 가린 번호. 한국 번호는 국내 형식(010-****-5678), 그 밖은 +국가번호와 끝 4자리만 남긴다. */
export function maskPhoneNumber(e164: string): string {
  if (!E164.test(e164)) return '';
  const country = [...PHONE_COUNTRIES]
    .sort((left, right) => right.dial.length - left.dial.length)
    .find((candidate) => e164.startsWith(`+${candidate.dial}`));
  if (country?.iso === 'KR') {
    const national = `0${e164.slice(3)}`;
    return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
  }
  const dial = country?.dial ?? '';
  return `+${dial} ****${e164.slice(-4)}`;
}

/** 운영값 ICONS_PHONE_VERIFICATION_COUNTRIES(쉼표 구분 ISO 코드). 비면 한국만 연다. 모르는 코드가 섞이면 닫는다. */
export function parseAllowedPhoneCountries(value: string | undefined): PhoneCountry[] | null {
  const codes = (value ?? '').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return PHONE_COUNTRIES.filter((country) => country.iso === DEFAULT_PHONE_COUNTRY_ISO);
  const countries = codes.map((code) => phoneCountryByIso(code));
  if (countries.some((country) => country === null)) return null;
  return PHONE_COUNTRIES.filter((country) => codes.includes(country.iso));
}
