import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: vi.fn() }) }));

import {
  authMailDigest,
  authMailLimitedWait,
  consumeAuthMailAttempt,
  captchaFailedMessage,
  captchaTokenFromForm,
  isCaptchaError,
  logAuthMailLimit,
  turnstileEnabled,
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

describe('Turnstile(토큰은 GoTrue가 검증한다)', () => {
  const on = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'k' };
  const form = (token?: string) => {
    const data = new FormData();
    if (token !== undefined) data.set('cf-turnstile-response', token);
    return data;
  };

  it('사이트 키가 있을 때만 켜진다(비밀 키는 앱이 읽지 않는다)', () => {
    expect(turnstileEnabled({})).toBe(false);
    expect(turnstileEnabled({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: ' ' })).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SECRET_KEY: 's' })).toBe(false);
    expect(turnstileEnabled(on)).toBe(true);
  });

  it('꺼져 있으면 토큰이 있어도 undefined(GoTrue에 보내지 않는다)', () => {
    expect(captchaTokenFromForm(form('t'), {})).toBeUndefined();
    expect(captchaTokenFromForm(form(), {})).toBeUndefined();
  });

  it('켜져 있으면 토큰을 돌려주고, 없거나 비었거나 너무 길면 null이다', () => {
    expect(captchaTokenFromForm(form('t'), on)).toBe('t');
    expect(captchaTokenFromForm(form(), on)).toBeNull();
    expect(captchaTokenFromForm(form(''), on)).toBeNull();
    expect(captchaTokenFromForm(form('x'.repeat(2049)), on)).toBeNull();
  });

  it('GoTrue의 captcha_failed만 CAPTCHA 오류로 본다', () => {
    expect(isCaptchaError({ code: 'captcha_failed' })).toBe(true);
    expect(isCaptchaError({ code: 'over_request_rate_limit' })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });

  it('안내 문구가 화면별로 다르다', () => {
    expect(captchaFailedMessage('signup')).toContain('가입');
    expect(captchaFailedMessage('reset')).not.toContain('가입');
    expect(captchaFailedMessage('signin')).toContain('로그인');
  });
});

describe('logAuthMailLimit', () => {
  it('프로젝트 메일 한도 오류만 태그 로그를 남기고 이메일·IP는 싣지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAuthMailLimit({ code: 'over_request_rate_limit' }, 'signup');
    logAuthMailLimit(null, 'signup');
    expect(spy).not.toHaveBeenCalled();
    logAuthMailLimit({ code: 'over_email_send_rate_limit', status: 429 }, 'reset');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('[auth-mail-limit]');
    expect(JSON.stringify(spy.mock.calls[0])).toContain('reset');
    spy.mockRestore();
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
    expect(await call({ ok: false, reason: 'rate_limited', retryAfterSeconds: 90 })).toEqual({ ok: false, retryAfterSeconds: 90, scope: null });
    expect(await call({ ok: false, reason: 'rate_limited', scope: 'email', retryAfterSeconds: 5 })).toEqual({ ok: false, retryAfterSeconds: 5, scope: 'email' });
    expect(await call({ ok: false, reason: 'rate_limited' })).toEqual({ ok: false, retryAfterSeconds: null, scope: null });
  });
});
