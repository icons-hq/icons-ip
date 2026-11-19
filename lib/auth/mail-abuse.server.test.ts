import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: vi.fn() }) }));

import {
  authMailDigest,
  authMailLimitedWait,
  consumeAuthMailAttempt,
  turnstileSecretFromEnvironment,
  verifyTurnstileToken,
} from './mail-abuse.server';

const SECRET = 'test-signup-resend-secret-with-enough-entropy';

describe('authMailLimitedWait', () => {
  it('모르면 10분, 10분 이하도 10분(앱 쿠키 한도와 같은 문구), 그 이상은 올림한다', () => {
    expect(authMailLimitedWait(null)).toBe('10분 후');
    expect(authMailLimitedWait(1)).toBe('10분 후');
    expect(authMailLimitedWait(600)).toBe('10분 후');
    expect(authMailLimitedWait(601)).toBe('11분 후');
    expect(authMailLimitedWait(3599)).toBe('60분 후');
    expect(authMailLimitedWait(3600)).toBe('1시간 후');
    expect(authMailLimitedWait(86_400)).toBe('24시간 후');
  });
});

describe('authMailDigest', () => {
  it('base64url 43자이고 종류·값·비밀값이 다르면 달라진다', () => {
    const digest = authMailDigest(SECRET, 'ip', '203.0.113.7');
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authMailDigest(SECRET, 'email', '203.0.113.7')).not.toBe(digest);
    expect(authMailDigest(SECRET, 'ip', '203.0.113.8')).not.toBe(digest);
    expect(authMailDigest(`${SECRET}x`, 'ip', '203.0.113.7')).not.toBe(digest);
    expect(authMailDigest(SECRET, 'ip', '203.0.113.7')).toBe(digest);
  });
});

describe('turnstileSecretFromEnvironment', () => {
  it('두 키가 모두 있을 때만 비밀 키를 돌려준다', () => {
    expect(turnstileSecretFromEnvironment({})).toBeNull();
    expect(turnstileSecretFromEnvironment({ TURNSTILE_SECRET_KEY: 's' })).toBeNull();
    expect(turnstileSecretFromEnvironment({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' })).toBeNull();
    expect(turnstileSecretFromEnvironment({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' ', TURNSTILE_SECRET_KEY: 's' })).toBeNull();
    expect(turnstileSecretFromEnvironment({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: ' s ' })).toBe('s');
  });
});

describe('verifyTurnstileToken', () => {
  const env = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: 's' };
  const form = (token?: string) => {
    const data = new FormData();
    if (token !== undefined) data.set('cf-turnstile-response', token);
    return data;
  };

  it('꺼져 있으면 토큰 없이 통과하고 fetch를 부르지 않는다', async () => {
    const fetchMock = vi.fn();
    expect(await verifyTurnstileToken(form(), null, { env: {}, fetch: fetchMock })).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('IP가 없으면 remoteip를 보내지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    expect(await verifyTurnstileToken(form('t'), null, { env, fetch: fetchMock })).toBe(true);
    expect(Object.fromEntries((fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams)).toEqual({ secret: 's', response: 't' });
  });

  it('토큰이 비었거나 너무 길면 Cloudflare를 부르지 않고 거절한다', async () => {
    const fetchMock = vi.fn();
    expect(await verifyTurnstileToken(form(''), null, { env, fetch: fetchMock })).toBe(false);
    expect(await verifyTurnstileToken(form('x'.repeat(2049)), null, { env, fetch: fetchMock })).toBe(false);
    expect(await verifyTurnstileToken(form(), null, { env, fetch: fetchMock })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success가 정확히 true일 때만 통과한다', async () => {
    for (const body of [{}, { success: 'true' }, { success: 1 }, null]) {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
      expect(await verifyTurnstileToken(form('t'), null, { env, fetch: fetchMock })).toBe(false);
    }
  });
});

describe('consumeAuthMailAttempt', () => {
  it('이메일은 앞뒤 공백·대소문자를 정규화한 뒤 다이제스트로 보낸다', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    await consumeAuthMailAttempt({ action: 'reset', email: ' Fan@Icons.GG ', ip: null }, { secret: SECRET, service: { rpc } as never });
    expect(rpc).toHaveBeenCalledWith('service_consume_auth_mail_attempt', {
      p_action: 'reset',
      p_ip_digest: null,
      p_email_digest: authMailDigest(SECRET, 'email', 'fan@icons.gg'),
    });
  });

  it('이해할 수 없는 응답은 열어 두되 거절 응답은 거절로 돌려준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const call = (data: unknown) => consumeAuthMailAttempt(
      { action: 'signup', email: 'a@b.cc', ip: '1.1.1.1' },
      { secret: SECRET, service: { rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never },
    );
    expect(await call(null)).toEqual({ ok: true });
    expect(await call({ ok: false, reason: 'rate_limited', retryAfterSeconds: 90 })).toEqual({ ok: false, retryAfterSeconds: 90 });
    expect(await call({ ok: false, reason: 'rate_limited' })).toEqual({ ok: false, retryAfterSeconds: null });
  });
});
