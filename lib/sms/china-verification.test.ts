import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHINA_SMS_PRIVACY_EFFECTIVE_DATE } from '@/lib/auth/contact-channels';
import { phoneCodeDigest, phoneVerificationConfig, requestPhoneVerificationCode, verifyPhoneVerificationCode } from './phone-verification.server';

const env = {
  ICONS_PHONE_VERIFICATION_ENABLED: 'true',
  ICONS_PHONE_VERIFICATION_SECRET: 'phone-verification-test-secret-0123456789',
  ICONS_PHONE_VERIFICATION_COUNTRIES: '*',
  ICONS_SMS_PROVIDER: 'twilio_verify',
  TWILIO_API_KEY_SID: 'SK' + 'a'.repeat(32),
  TWILIO_API_KEY_SECRET: 'test-twilio-secret',
  TWILIO_VERIFY_SERVICE_SID: 'VA' + 'b'.repeat(32),
  ICONS_SMS_CN_PROVIDER: 'sens',
  NCP_SENS_ACCESS_KEY: 'test-access-key',
  NCP_SENS_SECRET_KEY: 'test-secret-key',
  NCP_SENS_SMS_SERVICE_ID: 'ncp:sms:kr:123456:test-otp',
  NCP_SENS_SMS_FROM: '0212345678',
};
const challengeId = '11111111-1111-4111-8111-111111111111';
const userId = '00000000-0000-4000-8000-000000000501';
const phone = '+8613800138000';
const path = '/sms/v2/services/' + env.NCP_SENS_SMS_SERVICE_ID + '/messages';
const message = { to: phone, code: '012345', text: '', purpose: 'phone_verification' as const };
type Transport = (url: string, init: RequestInit) => Promise<Response>;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('중국 본토 인증문자', () => {
  it('routes an international-entry +86 request to SENS once with the same DB challenge code', async () => {
    const send = vi.fn<Transport>().mockResolvedValue(
      Response.json({ statusCode: '202', statusName: 'success', requestId: 'test-request-id' }, { status: 202 }));
    vi.stubGlobal('fetch', send);
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const config = phoneVerificationConfig(env)!;
    const result = await requestPhoneVerificationCode({ userId, countryIso: 'INTL', phone, ip: null },
      { config, service: { rpc } as never, newChallengeId: () => challengeId, newCode: () => '012345' });
    expect(result).toMatchObject({ ok: true, challengeId });
    await config.sender.confirmVerification?.(phone);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://sens.apigw.ntruss.com' + path);
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'SMS', contentType: 'COMM', countryCode: '86', from: env.NCP_SENS_SMS_FROM,
      content: '[ICONS] verification: 012345', messages: [{ to: '13800138000' }],
    });
    const headers = new Headers(init.headers);
    const timestamp = headers.get('x-ncp-apigw-timestamp');
    expect(timestamp).toMatch(/^\d{13}$/);
    expect(headers.get('x-ncp-iam-access-key')).toBe(env.NCP_SENS_ACCESS_KEY);
    expect(headers.get('x-ncp-apigw-signature-v2')).toBe(createHmac('sha256', env.NCP_SENS_SECRET_KEY)
      .update(['POST ' + path, timestamp, env.NCP_SENS_ACCESS_KEY].join('\n')).digest('base64'));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('service_issue_member_phone_verification',
      expect.objectContaining({ p_phone_e164: phone, p_code_digest: phoneCodeDigest(config.secret, challengeId, message.code) }));
  });

  it.each(['+821012345678', '+85251234567', '+85366123456', '+886912345678'])('keeps Twilio send and approval for %s', async to => {
    const send = vi.fn<Transport>().mockImplementation(async () => Response.json({ sid: 'test-twilio' }));
    vi.stubGlobal('fetch', send);
    const { sender } = phoneVerificationConfig(env)!;
    expect((await sender.send({ ...message, to })).ok).toBe(true);
    expect(await sender.confirmVerification?.(to)).toBe(true);
    expect(send.mock.calls).toHaveLength(3);
    expect(send.mock.calls.every(([url]) => new URL(url).host === 'verify.twilio.com')).toBe(true);
  });

  it('isolates invalid SENS settings to China and refuses non-OTP text or invalid mobile numbers', async () => {
    const send = vi.fn<Transport>().mockImplementation(async () => Response.json({ sid: 'test-twilio' }));
    vi.stubGlobal('fetch', send);
    for (const change of [{ NCP_SENS_SECRET_KEY: '' }, { ICONS_SMS_CN_PROVIDER: 'mistyped' }]) {
      const { sender } = phoneVerificationConfig({ ...env, ...change })!;
      expect((await sender.send(message)).ok).toBe(false);
      await sender.confirmVerification?.(phone);
    }
    const { sender } = phoneVerificationConfig(env)!;
    for (const change of [{ purpose: 'advertising' as const }, { purpose: 'transactional' as const },
      { code: '12abc6' }, { to: '+8612345' }, { to: '+862112345678' }]) {
      expect((await sender.send({ ...message, ...change })).ok).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
    const incomplete = phoneVerificationConfig({ ...env, NCP_SENS_SECRET_KEY: '' })!;
    expect((await incomplete.sender.send({ ...message, to: '+821012345678' })).ok).toBe(true);
  });

  it.each([
    ['network', null, true], ['timeout', 408, true], ['upstream', 503, true],
    ['malformed receipt', 202, true], ['unexpected status', 200, true], ['explicit rejection', 403, false],
  ] as const)('%s preserves only challenges which might have been sent', async (_name, status, uncertain) => {
    const send = vi.fn<Transport>().mockImplementation(async () => {
      if (status === null) throw new TypeError('network');
      return Response.json({ statusCode: String(status) }, { status });
    });
    vi.stubGlobal('fetch', send);
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const config = phoneVerificationConfig(env)!;
    const deps = { config, service: { rpc } as never, newChallengeId: () => challengeId, newCode: () => message.code };
    const result = await requestPhoneVerificationCode({ userId, countryIso: 'CN', phone, ip: null }, deps);
    expect(result.ok).toBe(uncertain);
    if (uncertain) {
      expect(result).toMatchObject({ challengeId, deliveryUncertain: true });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect((await verifyPhoneVerificationCode({ userId, challengeId, code: '012345' }, deps)).ok).toBe(true);
      expect(rpc).toHaveBeenLastCalledWith('service_verify_member_phone_verification',
        { p_challenge_id: challengeId, p_user_id: userId, p_code_digest: phoneCodeDigest(config.secret, challengeId, message.code) });
    } else {
      expect(rpc).toHaveBeenLastCalledWith('service_fail_member_phone_verification', { p_user_id: userId, p_challenge_id: challengeId });
    }
    expect(send.mock.calls.map(([url]) => new URL(url).host)).toEqual(['sens.apigw.ntruss.com']);
  });

  it('uses Twilio before the published date and after an explicit rollback', async () => {
    const send = vi.fn<Transport>().mockImplementation(async () => Response.json({ sid: 'test-twilio' }));
    vi.stubGlobal('fetch', send);
    const release = new Date(CHINA_SMS_PRIVACY_EFFECTIVE_DATE + 'T00:00:00+09:00');
    const prod = { ...env, VERCEL_ENV: 'production' };
    for (const config of [
      phoneVerificationConfig(prod, new Date(release.getTime() - 1)),
      phoneVerificationConfig({ ...prod, ICONS_SMS_CN_PROVIDER: 'twilio' }, release),
      phoneVerificationConfig({ ...prod, ICONS_SMS_CN_PROVIDER: undefined }, release),
    ]) expect((await config!.sender.send(message)).ok).toBe(true);
    expect(send.mock.calls.every(([url]) => new URL(url).host === 'verify.twilio.com')).toBe(true);
    send.mockClear();
    await phoneVerificationConfig(prod, release)!.sender.send(message);
    expect(send.mock.calls.map(([url]) => new URL(url).host)).toEqual(['sens.apigw.ntruss.com']);
  });
});
