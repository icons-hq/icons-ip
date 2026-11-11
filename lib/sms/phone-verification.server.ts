import 'server-only';

import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { contactChannelsLegalGateOpen, envSwitchOn } from '@/lib/auth/contact-channels';
import { createServiceClient } from '@/lib/supabase/service';
import {
  DEFAULT_PHONE_COUNTRY_ISO,
  INTERNATIONAL_PHONE_OPTION,
  allowedPhoneCountries,
  allowsInternationalEntry,
  isKoreanPhoneNumber,
  maskPhoneNumber,
  normalizePhoneNumber,
  parsePhoneAllowlist,
  type PhoneAllowlist,
} from './phone-number';
import { smsSenderFromEnvironment, type SmsSender } from './sender.server';

/*
 * 휴대폰 번호 인증(10/14 회의 1014-005·006). 스위치 ICONS_PHONE_VERIFICATION_ENABLED=true가 아니면 설정이 null이고
 * 화면·서버 어디서도 이 흐름을 열지 않는다(기본 OFF).
 *
 * 인증번호는 서버에서 만들고(6자리, 5분), 원문 대신 HMAC만 DB에 남긴다. 키는 ICONS_PHONE_VERIFICATION_SECRET
 * (32자 이상)이고, 번호·IP 다이제스트와 인증번호 다이제스트를 다른 도메인으로 나눠 만든다. 동의·만 14세 확인 여부,
 * 한도·재발송 간격·5회 오입력 잠금, 번호 옮기기는 DB(service_issue/verify_member_phone_verification)가 판정한다.
 */

export const PHONE_CODE_LENGTH = 6;
export const PHONE_CODE_TTL_SECONDS = 5 * 60;
const DIGEST_DOMAIN = 'icons-member-phone-v1';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface PhoneVerificationConfig {
  sender: SmsSender;
  secret: string;
  allowlist: PhoneAllowlist;
}

export function phoneVerificationConfig(env: RuntimeEnvironment = process.env, now: Date = new Date()): PhoneVerificationConfig | null {
  if (!envSwitchOn(env, 'ICONS_PHONE_VERIFICATION_ENABLED')) return null;
  if (!contactChannelsLegalGateOpen(env, now)) return null;
  const secret = env.ICONS_PHONE_VERIFICATION_SECRET?.trim() ?? '';
  if (secret.length < 32) return null;
  const sender = smsSenderFromEnvironment(env);
  if (!sender) return null;
  return { sender, secret, allowlist: parsePhoneAllowlist(env.ICONS_PHONE_VERIFICATION_COUNTRIES) };
}

/** 화면에 넘기는 설정(비밀값 없음). 스위치가 꺼져 있으면 null — 화면은 아무것도 그리지 않는다. */
export interface PhoneVerificationView {
  countries: { iso: string; label: string }[];
  defaultCountry: string;
  verified: { maskedPhone: string } | null;
  /** 다른 계정이 같은 번호를 인증해 이 계정의 인증이 해제됐다 — 다시 인증해야 보호 액션을 쓸 수 있다. */
  reverificationRequired: boolean;
}

export function phoneVerificationCountries(config: PhoneVerificationConfig): PhoneVerificationView['countries'] {
  const countries = allowedPhoneCountries(config.allowlist).map((country) => ({ iso: country.iso, label: country.label }));
  return allowsInternationalEntry(config.allowlist)
    ? [...countries, { iso: INTERNATIONAL_PHONE_OPTION, label: '다른 나라 (+국가번호로 입력)' }]
    : countries;
}

export function defaultPhoneCountry(config: PhoneVerificationConfig): string {
  const countries = phoneVerificationCountries(config);
  return countries.some((country) => country.iso === DEFAULT_PHONE_COUNTRY_ISO)
    ? DEFAULT_PHONE_COUNTRY_ISO
    : countries[0]?.iso ?? INTERNATIONAL_PHONE_OPTION;
}

function digest(secret: string, kind: 'phone' | 'ip' | 'code', value: string) {
  return createHmac('sha256', secret).update(DIGEST_DOMAIN).update('\0').update(kind).update('\0').update(value).digest('base64url');
}

export function phoneDigest(secret: string, e164: string) {
  return digest(secret, 'phone', e164);
}

export function phoneCodeDigest(secret: string, challengeId: string, code: string) {
  return digest(secret, 'code', `${challengeId}\0${code}`);
}

function ipDigest(secret: string, ip: string | null) {
  return ip ? digest(secret, 'ip', ip) : null;
}

export function generatePhoneCode(random: (maxExclusive: number) => number = randomInt): string {
  let code = '';
  for (let index = 0; index < PHONE_CODE_LENGTH; index += 1) code += String(random(10));
  return code;
}

/** 인증번호 문자. 한국 번호는 한국어, 해외 번호는 영어로 보낸다. 광고가 아니라 (광고) 표시를 붙이지 않는다. */
export function phoneCodeMessage(code: string, e164: string): string {
  const minutes = Math.round(PHONE_CODE_TTL_SECONDS / 60);
  return isKoreanPhoneNumber(e164)
    ? `[ICONS] 인증번호 [${code}]를 ${minutes}분 안에 입력해주세요.`
    : `[ICONS] Your verification code is ${code}. It expires in ${minutes} minutes.`;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface PhoneVerificationDependencies {
  config: PhoneVerificationConfig;
  service?: ServiceClient;
  newChallengeId?: () => string;
  newCode?: () => string;
}

export type RequestPhoneCodeResult =
  | { ok: true; challengeId: string; maskedPhone: string }
  | { ok: false; field: 'phone' | 'form'; error: string };

const ONBOARDING_REQUIRED_MESSAGE = '생년월일과 약관 동의를 먼저 저장한 뒤 휴대폰 번호를 인증해주세요.';

function retryAfterWords(seconds: unknown) {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : null;
  if (value === null) return '잠시 후';
  return value < 60 ? `${value}초 후` : `${Math.ceil(value / 60)}분 후`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function requestPhoneVerificationCode(
  input: { userId: string; countryIso: unknown; phone: unknown; ip: string | null },
  deps: PhoneVerificationDependencies,
): Promise<RequestPhoneCodeResult> {
  const { config } = deps;
  const normalized = normalizePhoneNumber(input.countryIso, input.phone, config.allowlist);
  if (!normalized.ok) return { ok: false, field: 'phone', error: normalized.error };

  const service = deps.service ?? createServiceClient();
  const challengeId = (deps.newChallengeId ?? randomUUID)();
  const code = (deps.newCode ?? generatePhoneCode)();
  const { data, error } = await service.rpc('service_issue_member_phone_verification', {
    p_challenge_id: challengeId,
    p_user_id: input.userId,
    p_phone_e164: normalized.e164,
    p_phone_digest: phoneDigest(config.secret, normalized.e164),
    p_ip_digest: ipDigest(config.secret, input.ip),
    p_code_digest: phoneCodeDigest(config.secret, challengeId, code),
    p_ttl_seconds: PHONE_CODE_TTL_SECONDS,
  });
  const result = record(data);
  if (error || !result) return { ok: false, field: 'form', error: '인증번호를 보내지 못했어요. 잠시 후 다시 시도해주세요.' };
  if (result.ok !== true) {
    switch (result.reason) {
      case 'cooldown':
      case 'rate_limited':
        return { ok: false, field: 'form', error: `인증번호 요청이 너무 잦아요. ${retryAfterWords(result.retryAfterSeconds)} 다시 시도해주세요.` };
      case 'onboarding_required':
        return { ok: false, field: 'form', error: ONBOARDING_REQUIRED_MESSAGE };
      case 'account_unavailable':
        return { ok: false, field: 'form', error: '지금은 이 계정으로 휴대폰 번호를 인증할 수 없어요.' };
      default:
        return { ok: false, field: 'form', error: '인증번호를 보내지 못했어요. 잠시 후 다시 시도해주세요.' };
    }
  }

  const sent = await config.sender.send({ to: normalized.e164, text: phoneCodeMessage(code, normalized.e164), purpose: 'phone_verification' })
    .catch(() => ({ ok: false as const, reason: 'unavailable' as const }));
  if (!sent.ok) {
    await service.rpc('service_fail_member_phone_verification', { p_challenge_id: challengeId, p_user_id: input.userId });
    return { ok: false, field: 'form', error: '인증번호 문자를 보내지 못했어요. 번호를 확인하고 잠시 후 다시 시도해주세요.' };
  }
  return { ok: true, challengeId, maskedPhone: maskPhoneNumber(normalized.e164) };
}

export type VerifyPhoneCodeResult =
  | { ok: true }
  | { ok: false; field: 'code' | 'form'; error: string; restart: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyPhoneVerificationCode(
  input: { userId: string; challengeId: unknown; code: unknown },
  deps: PhoneVerificationDependencies,
): Promise<VerifyPhoneCodeResult> {
  if (typeof input.challengeId !== 'string' || !UUID.test(input.challengeId)) {
    return { ok: false, field: 'form', error: '인증번호를 다시 받아주세요.', restart: true };
  }
  const code = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
  if (!new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`).test(code)) {
    return { ok: false, field: 'code', error: '문자로 받은 6자리 숫자를 입력해주세요.', restart: false };
  }

  const service = deps.service ?? createServiceClient();
  const { data, error } = await service.rpc('service_verify_member_phone_verification', {
    p_challenge_id: input.challengeId,
    p_user_id: input.userId,
    p_code_digest: phoneCodeDigest(deps.config.secret, input.challengeId, code),
  });
  const result = record(data);
  if (error || !result) return { ok: false, field: 'form', error: '인증번호를 확인하지 못했어요. 잠시 후 다시 시도해주세요.', restart: false };
  if (result.ok === true) return { ok: true };
  switch (result.reason) {
    case 'mismatch':
      return {
        ok: false,
        field: 'code',
        error: `인증번호가 맞지 않아요.${typeof result.remainingAttempts === 'number' ? ` ${result.remainingAttempts}번 더 입력할 수 있어요.` : ''}`,
        restart: false,
      };
    case 'expired':
      return { ok: false, field: 'form', error: '인증번호 입력 시간이 지났어요. 인증번호를 다시 받아주세요.', restart: true };
    case 'exhausted':
      return { ok: false, field: 'form', error: '인증번호를 여러 번 틀렸어요. 인증번호를 다시 받아주세요.', restart: true };
    case 'onboarding_required':
      return { ok: false, field: 'form', error: ONBOARDING_REQUIRED_MESSAGE, restart: true };
    case 'account_unavailable':
      return { ok: false, field: 'form', error: '지금은 이 계정으로 휴대폰 번호를 인증할 수 없어요.', restart: true };
    default:
      return { ok: false, field: 'form', error: '인증번호를 다시 받아주세요.', restart: true };
  }
}

/** 본인 인증 번호 상태(가린 번호). 읽지 못하면 null — 화면은 미인증으로 그리고 서버가 다시 판정한다. */
export function maskedVerifiedPhone(value: unknown): { maskedPhone: string } | null {
  const result = record(value);
  if (!result || result.verified !== true || typeof result.phoneE164 !== 'string') return null;
  const maskedPhone = maskPhoneNumber(result.phoneE164);
  return maskedPhone ? { maskedPhone } : null;
}

export interface MyVerifiedPhone {
  verified: boolean;
  maskedPhone: string | null;
  /** 다른 계정이 같은 번호를 인증해 이 계정의 인증이 해제됐다(사용자 결정 '옮기고 재인증 요구'). */
  reverificationRequired: boolean;
}

type UserClient = { rpc: (name: string) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * 로그인한 본인의 인증 상태를 읽는다(my_member_phone_verification). 읽지 못하면 null이다 — 화면은 미인증으로 그리고,
 * 온보딩 완료는 인증 확인이 안 되면 막는다.
 */
export async function readMyVerifiedPhone(client: UserClient): Promise<MyVerifiedPhone | null> {
  try {
    const { data, error } = await client.rpc('my_member_phone_verification');
    if (error) return null;
    const result = record(data);
    if (!result || typeof result.verified !== 'boolean') return null;
    return {
      verified: result.verified,
      maskedPhone: maskedVerifiedPhone(result)?.maskedPhone ?? null,
      reverificationRequired: result.reverificationRequired === true,
    };
  } catch {
    return null;
  }
}

export function phoneVerificationView(config: PhoneVerificationConfig, verified: MyVerifiedPhone | null): PhoneVerificationView {
  return {
    countries: phoneVerificationCountries(config),
    defaultCountry: defaultPhoneCountry(config),
    verified: verified?.verified && verified.maskedPhone ? { maskedPhone: verified.maskedPhone } : null,
    reverificationRequired: verified?.reverificationRequired === true,
  };
}
