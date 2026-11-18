import { describe, expect, it, vi } from 'vitest';
import { smsSenderFromEnvironment } from './sender.server';
import { createTwilioVerifySender, twilioVerifyConfigFromEnvironment, twilioVerifyLocale } from './twilio-verify.server';

const SK = `SK${'a'.repeat(32)}`;
const VA = `VA${'b'.repeat(32)}`;
const SECRET = 'secret-value-that-is-long';
const CONFIG = { apiKeySid: SK, apiKeySecret: SECRET, serviceSid: VA };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('twilioVerifyConfigFromEnvironment', () => {
  it('needs an API key SID, a secret and a Verify service SID in the expected shapes', () => {
    expect(twilioVerifyConfigFromEnvironment({ TWILIO_API_KEY_SID: SK, TWILIO_API_KEY_SECRET: SECRET, TWILIO_VERIFY_SERVICE_SID: VA }))
      .toEqual(CONFIG);
    expect(twilioVerifyConfigFromEnvironment({ TWILIO_API_KEY_SID: SK, TWILIO_VERIFY_SERVICE_SID: VA })).toBeNull();
    expect(twilioVerifyConfigFromEnvironment({ TWILIO_API_KEY_SID: `AC${'a'.repeat(32)}`, TWILIO_API_KEY_SECRET: SECRET, TWILIO_VERIFY_SERVICE_SID: VA })).toBeNull();
    expect(twilioVerifyConfigFromEnvironment({ TWILIO_API_KEY_SID: SK, TWILIO_API_KEY_SECRET: SECRET, TWILIO_VERIFY_SERVICE_SID: 'VA123' })).toBeNull();
  });

  it('is what ICONS_SMS_PROVIDER=twilio_verify builds, on Vercel too, and nothing without keys', () => {
    const env = { ICONS_SMS_PROVIDER: 'twilio_verify', TWILIO_API_KEY_SID: SK, TWILIO_API_KEY_SECRET: SECRET, TWILIO_VERIFY_SERVICE_SID: VA, VERCEL_ENV: 'production' };
    expect(smsSenderFromEnvironment(env)?.provider).toBe('twilio_verify');
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'twilio_verify' })).toBeNull();
  });
});

describe('createTwilioVerifySender', () => {
  it('sends our own code as a Verify custom code with the Korean template for Korean numbers', async () => {
    const fetch = vi.fn(async () => jsonResponse(201, { sid: `VE${'c'.repeat(32)}`, status: 'pending' }));
    const sender = createTwilioVerifySender(CONFIG, { fetch });

    await expect(sender.send({ to: '+821012345678', text: 'ignored', purpose: 'phone_verification', code: '123456' }))
      .resolves.toEqual({ ok: true, providerMessageId: `VE${'c'.repeat(32)}` });

    /* 먼저 같은 번호의 진행 중 Verification을 취소해 이전 코드가 다시 가지 않게 한다. */
    const [cancelUrl, cancelInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(cancelUrl).toBe(`https://verify.twilio.com/v2/Services/${VA}/Verifications/%2B821012345678`);
    expect(String(cancelInit.body)).toBe('Status=canceled');
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${VA}/Verifications`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${SK}:${SECRET}`).toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      To: '+821012345678', Channel: 'sms', CustomCode: '123456', Locale: 'ko',
    });
  });

  it('uses English outside Korea', () => {
    expect(twilioVerifyLocale('+821012345678')).toBe('ko');
    expect(twilioVerifyLocale('+447700900123')).toBe('en');
  });

  it('never sends anything other than a verification code', async () => {
    const fetch = vi.fn();
    const sender = createTwilioVerifySender(CONFIG, { fetch });

    await expect(sender.send({ to: '+821012345678', text: '배송 안내', purpose: 'transactional' })).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(sender.send({ to: '+821012345678', text: '(광고)', purpose: 'advertising' })).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(sender.send({ to: '+821012345678', text: 'no code', purpose: 'phone_verification' })).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('separates a refused number from our own setup problems and logs neither the number nor the code', async () => {
    const log = vi.fn();
    /* 취소 호출(404 — 진행 중 Verification 없음)은 로그를 남기지 않고, 발송 응답만 결과를 정한다. */
    const sendOnly = (status: number, code: number) => async (input: string) => input.endsWith('/Verifications') ? jsonResponse(status, { code }) : jsonResponse(404, { code: 20404 });
    const refused = createTwilioVerifySender(CONFIG, { fetch: sendOnly(400, 60200), log });
    await expect(refused.send({ to: '+821012345678', text: '', purpose: 'phone_verification', code: '654321' }))
      .resolves.toEqual({ ok: false, reason: 'rejected' });

    const misconfigured = createTwilioVerifySender(CONFIG, { fetch: sendOnly(403, 60204), log });
    await expect(misconfigured.send({ to: '+821012345678', text: '', purpose: 'phone_verification', code: '654321' }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });

    const offline = createTwilioVerifySender(CONFIG, { fetch: async () => { throw new Error('socket hang up'); }, log });
    await expect(offline.send({ to: '+821012345678', text: '', purpose: 'phone_verification', code: '654321' }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '[sms:twilio_verify] send failed status=400 code=60200',
      '[sms:twilio_verify] send failed status=403 code=60204',
      '[sms:twilio_verify] send failed status=network',
    ]);
    for (const [line] of log.mock.calls) {
      expect(line).not.toContain('1012345678');
      expect(line).not.toContain('654321');
      expect(line).not.toContain(SECRET);
    }
  });

  it('approves the pending verification of the number after our DB verified it', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { status: 'approved' }));
    const sender = createTwilioVerifySender(CONFIG, { fetch });

    await expect(sender.confirmVerification?.('+821012345678')).resolves.toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${VA}/Verifications/%2B821012345678`);
    expect(String(init.body)).toBe('Status=approved');

    const log = vi.fn();
    const failing = createTwilioVerifySender(CONFIG, { fetch: async () => jsonResponse(404, { code: 20404 }), log });
    await expect(failing.confirmVerification?.('+821012345678')).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith('[sms:twilio_verify] approve failed status=404 code=20404');
  });
});
