import { describe, expect, it, vi } from 'vitest';
import { parsePhoneAllowlist } from './phone-number';
import {
  generatePhoneCode,
  maskedVerifiedPhone,
  phoneCodeDigest,
  phoneCodeMessage,
  phoneDigest,
  phoneVerificationConfig,
  phoneVerificationView,
  readMyVerifiedPhone,
  requestPhoneVerificationCode,
  verifyPhoneVerificationCode,
  type PhoneVerificationConfig,
} from './phone-verification.server';
import type { SmsMessage, SmsSender } from './sender.server';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('tests inject the service client');
  },
}));

const SECRET = 'phone-verification-test-secret-0123456789';
const USER_ID = '00000000-0000-4000-8000-000000000501';
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const ENABLED_ENV = {
  ICONS_PHONE_VERIFICATION_ENABLED: 'true',
  ICONS_PHONE_VERIFICATION_SECRET: SECRET,
  ICONS_SMS_PROVIDER: 'console',
};

function sender(result: Awaited<ReturnType<SmsSender['send']>> = { ok: true, providerMessageId: 'm-1' }) {
  const sent: SmsMessage[] = [];
  return {
    sent,
    sender: { provider: 'fake', send: vi.fn(async (message: SmsMessage) => { sent.push(message); return result; }) } satisfies SmsSender,
  };
}

function configWith(smsSender: SmsSender, allowlist = parsePhoneAllowlist('KR,JP')): PhoneVerificationConfig {
  return { sender: smsSender, secret: SECRET, allowlist };
}

function service(responses: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => responses[name] ?? { data: null, error: { message: 'unexpected' } });
  return { rpc, client: { rpc } as never };
}

describe('phoneVerificationConfig — 스위치 OFF 기본', () => {
  it('is null unless the switch is exactly true and the secret and sender are usable', () => {
    expect(phoneVerificationConfig({})).toBeNull();
    expect(phoneVerificationConfig({ ...ENABLED_ENV, ICONS_PHONE_VERIFICATION_ENABLED: '1' })).toBeNull();
    expect(phoneVerificationConfig({ ...ENABLED_ENV, ICONS_PHONE_VERIFICATION_SECRET: 'short' })).toBeNull();
    expect(phoneVerificationConfig({ ...ENABLED_ENV, ICONS_SMS_PROVIDER: '' })).toBeNull();
    expect(phoneVerificationConfig(ENABLED_ENV)?.allowlist).toEqual({ all: false, dialCodes: ['82'] });
  });

  /* 허용 목록에 모르는 값이 섞여도 기능을 끄지 않는다(F6). */
  it('keeps working with unknown country entries and opens every country with *', () => {
    expect(phoneVerificationConfig({ ...ENABLED_ENV, ICONS_PHONE_VERIFICATION_COUNTRIES: 'KR,ZZ' })?.allowlist).toEqual({ all: false, dialCodes: ['82'] });
    expect(phoneVerificationConfig({ ...ENABLED_ENV, ICONS_PHONE_VERIFICATION_COUNTRIES: '*' })?.allowlist).toEqual({ all: true, dialCodes: [] });
  });

  it('stays closed in production until the privacy revision takes effect, even with the switch on', () => {
    expect(phoneVerificationConfig({ ...ENABLED_ENV, VERCEL_ENV: 'production' })).toBeNull();
  });
});

describe('requestPhoneVerificationCode', () => {
  it('records only digests, then sends a Korean code message to the normalized number', async () => {
    const fake = sender();
    const db = service({ service_issue_member_phone_verification: { data: { ok: true, expiresAt: '2026-11-11T00:05:00Z' }, error: null } });

    const result = await requestPhoneVerificationCode(
      { userId: USER_ID, countryIso: 'KR', phone: '010-1234-5678', ip: '203.0.113.7' },
      { config: configWith(fake.sender), service: db.client, newChallengeId: () => CHALLENGE_ID, newCode: () => '482913' },
    );

    expect(result).toEqual({ ok: true, challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678' });
    const [name, args] = db.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('service_issue_member_phone_verification');
    expect(args).toEqual({
      p_challenge_id: CHALLENGE_ID,
      p_user_id: USER_ID,
      p_phone_e164: '+821012345678',
      p_phone_digest: phoneDigest(SECRET, '+821012345678'),
      p_ip_digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      p_code_digest: phoneCodeDigest(SECRET, CHALLENGE_ID, '482913'),
      p_ttl_seconds: 300,
    });
    expect(JSON.stringify(args)).not.toContain('482913');
    expect(JSON.stringify(args)).not.toContain('203.0.113.7');
    expect(fake.sent).toEqual([{ to: '+821012345678', text: '[ICONS] 인증번호 [482913]를 5분 안에 입력해주세요.', purpose: 'phone_verification' }]);
  });

  it('does not touch the database for an invalid number or a country that is not open', async () => {
    const fake = sender();
    const db = service({});

    expect(await requestPhoneVerificationCode({ userId: USER_ID, countryIso: 'KR', phone: '02-123-4567', ip: null }, { config: configWith(fake.sender), service: db.client }))
      .toEqual({ ok: false, field: 'phone', error: '휴대폰 번호를 다시 확인해주세요. 예: 010-1234-5678' });
    expect((await requestPhoneVerificationCode({ userId: USER_ID, countryIso: 'US', phone: '4155550123', ip: null }, { config: configWith(fake.sender), service: db.client })).ok).toBe(false);
    expect((await requestPhoneVerificationCode({ userId: USER_ID, countryIso: 'INTL', phone: '+351 912 345 678', ip: null }, { config: configWith(fake.sender), service: db.client })).ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fake.sent).toEqual([]);
  });

  it.each([
    [{ ok: false, reason: 'cooldown', retryAfterSeconds: 42 }, '인증번호 요청이 너무 잦아요. 42초 후 다시 시도해주세요.'],
    [{ ok: false, reason: 'rate_limited', retryAfterSeconds: 3000 }, '인증번호 요청이 너무 잦아요. 50분 후 다시 시도해주세요.'],
    [{ ok: false, reason: 'account_unavailable' }, '지금은 이 계정으로 휴대폰 번호를 인증할 수 없어요.'],
    [{ ok: false, reason: 'onboarding_required' }, '생년월일과 약관 동의를 먼저 저장한 뒤 휴대폰 번호를 인증해주세요.'],
  ])('explains a refused request %o without sending', async (data, error) => {
    const fake = sender();
    const db = service({ service_issue_member_phone_verification: { data, error: null } });

    expect(await requestPhoneVerificationCode({ userId: USER_ID, countryIso: 'KR', phone: '01012345678', ip: null }, { config: configWith(fake.sender), service: db.client }))
      .toEqual({ ok: false, field: 'form', error });
    expect(fake.sent).toEqual([]);
  });

  it('closes the request when the provider does not accept the message', async () => {
    const fake = sender({ ok: false, reason: 'rejected' });
    const db = service({
      service_issue_member_phone_verification: { data: { ok: true }, error: null },
      service_fail_member_phone_verification: { data: true, error: null },
    });

    const result = await requestPhoneVerificationCode(
      { userId: USER_ID, countryIso: 'JP', phone: '090-1234-5678', ip: null },
      { config: configWith(fake.sender), service: db.client, newChallengeId: () => CHALLENGE_ID, newCode: () => '000111' },
    );

    expect(result).toEqual({ ok: false, field: 'form', error: '인증번호 문자를 보내지 못했어요. 번호를 확인하고 잠시 후 다시 시도해주세요.' });
    expect(fake.sent[0]?.text).toBe('[ICONS] Your verification code is 000111. It expires in 5 minutes.');
    expect(db.rpc).toHaveBeenLastCalledWith('service_fail_member_phone_verification', { p_challenge_id: CHALLENGE_ID, p_user_id: USER_ID });
  });
});

describe('verifyPhoneVerificationCode', () => {
  it('sends only the code digest bound to the challenge', async () => {
    const db = service({ service_verify_member_phone_verification: { data: { ok: true, replayed: false }, error: null } });

    expect(await verifyPhoneVerificationCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: ' 482 913 ' }, { config: configWith(sender().sender), service: db.client }))
      .toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith('service_verify_member_phone_verification', {
      p_challenge_id: CHALLENGE_ID,
      p_user_id: USER_ID,
      p_code_digest: phoneCodeDigest(SECRET, CHALLENGE_ID, '482913'),
    });
  });

  it('rejects malformed codes and challenge ids before the database', async () => {
    const db = service({});
    const deps = { config: configWith(sender().sender), service: db.client };

    expect(await verifyPhoneVerificationCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '12345' }, deps))
      .toEqual({ ok: false, field: 'code', error: '문자로 받은 6자리 숫자를 입력해주세요.', restart: false });
    expect(await verifyPhoneVerificationCode({ userId: USER_ID, challengeId: 'not-a-uuid', code: '123456' }, deps))
      .toEqual({ ok: false, field: 'form', error: '인증번호를 다시 받아주세요.', restart: true });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, reason: 'mismatch', remainingAttempts: 3 }, { field: 'code', error: '인증번호가 맞지 않아요. 3번 더 입력할 수 있어요.', restart: false }],
    [{ ok: false, reason: 'expired' }, { field: 'form', error: '인증번호 입력 시간이 지났어요. 인증번호를 다시 받아주세요.', restart: true }],
    [{ ok: false, reason: 'exhausted' }, { field: 'form', error: '인증번호를 여러 번 틀렸어요. 인증번호를 다시 받아주세요.', restart: true }],
    [{ ok: false, reason: 'superseded' }, { field: 'form', error: '인증번호를 다시 받아주세요.', restart: true }],
    [{ ok: false, reason: 'onboarding_required' }, { field: 'form', error: '생년월일과 약관 동의를 먼저 저장한 뒤 휴대폰 번호를 인증해주세요.', restart: true }],
  ])('maps %o', async (data, expected) => {
    const db = service({ service_verify_member_phone_verification: { data, error: null } });
    expect(await verifyPhoneVerificationCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '123456' }, { config: configWith(sender().sender), service: db.client }))
      .toEqual({ ok: false, ...expected });
  });
});

describe('verified phone state', () => {
  it('reads only a well-formed verified number and masks it for the screen', async () => {
    expect(await readMyVerifiedPhone({ rpc: async () => ({ data: { verified: true, phoneE164: '+821012345678', verifiedAt: '2026-11-11T00:00:00Z', reverificationRequired: false }, error: null }) }))
      .toEqual({ verified: true, maskedPhone: '010-****-5678', reverificationRequired: false });
    expect(await readMyVerifiedPhone({ rpc: async () => ({ data: { verified: false, phoneE164: null }, error: null }) }))
      .toEqual({ verified: false, maskedPhone: null, reverificationRequired: false });
    expect(await readMyVerifiedPhone({ rpc: async () => ({ data: { verified: false, phoneE164: null, reverificationRequired: true }, error: null }) }))
      .toEqual({ verified: false, maskedPhone: null, reverificationRequired: true });
    expect(await readMyVerifiedPhone({ rpc: async () => ({ data: null, error: { message: 'nope' } }) })).toBeNull();
    expect(maskedVerifiedPhone({ verified: true, phoneE164: 'garbage' })).toBeNull();
  });

  it('builds the screen view without secrets', () => {
    const view = phoneVerificationView(configWith(sender().sender), { verified: true, maskedPhone: '010-****-5678', reverificationRequired: false });
    expect(view).toEqual({
      countries: [{ iso: 'KR', label: '대한민국 (+82)' }, { iso: 'JP', label: '일본 (+81)' }],
      defaultCountry: 'KR',
      verified: { maskedPhone: '010-****-5678' },
      reverificationRequired: false,
    });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(phoneVerificationView(configWith(sender().sender, parsePhoneAllowlist('*')), null).countries.at(-1))
      .toEqual({ iso: 'INTL', label: '다른 나라 (+국가번호로 입력)' });
    expect(phoneVerificationView(configWith(sender().sender), { verified: false, maskedPhone: null, reverificationRequired: true }).reverificationRequired).toBe(true);
  });
});

describe('codes', () => {
  it('draws six digits from the random source', () => {
    expect(generatePhoneCode(() => 7)).toBe('777777');
    for (let index = 0; index < 20; index += 1) expect(generatePhoneCode()).toMatch(/^\d{6}$/);
  });

  it('does not mark the verification message as advertising', () => {
    expect(phoneCodeMessage('123456', '+821012345678')).not.toContain('(광고)');
    expect(phoneCodeMessage('123456', '+351912345678')).toBe('[ICONS] Your verification code is 123456. It expires in 5 minutes.');
  });
});
