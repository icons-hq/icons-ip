import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestPasswordResetAction,
  signInWithSocialAction,
  signUpWithEmailAction,
} from './actions';

const AUTH_SIGNUP_RESEND_COOKIE_NAME = 'icons_auth_signup_resend';
const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
const AUTH_PASSWORD_RESET_COOKIE_NAME = 'icons_auth_password_reset';
const TEST_SIGNUP_RESEND_SECRET = 'test-signup-resend-secret-with-enough-entropy';
const ORIGINAL_SIGNUP_RESEND_SECRET = process.env.AUTH_SIGNUP_RESEND_SECRET;
const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

const mocks = vi.hoisted(() => ({
  isConfigured: true,
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
  cookieSetCalls: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.isConfigured }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithOAuth: mocks.signInWithOAuth,
      resend: mocks.resend,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
}));

vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/auth/recovery.server', async () => await import('../../lib/auth/recovery.server'));
vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/server', () => ({
  getProfileForUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => mocks.headers.get(name.toLowerCase()) ?? null,
  }),
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      mocks.cookieSetCalls.push({ name, value, options });
      if (options?.maxAge === 0) {
        mocks.cookies.delete(name);
        return;
      }
      mocks.cookies.set(name, value);
    },
  }),
}));

function formData(email = 'Fan@Icons.gg') {
  const data = new FormData();
  data.set('email', email);
  data.set('password', 'password1234');
  data.set('next', '/community?sort=hot');
  return data;
}

async function submitSignup(email = 'Fan@Icons.gg') {
  return await signUpWithEmailAction({}, formData(email));
}

function latestCookieSet(name: string) {
  return mocks.cookieSetCalls.findLast((call) => call.name === name);
}

function resetFormData(email = 'Fan@Icons.gg', next = '/community?sort=hot') {
  const data = new FormData();
  data.set('email', email);
  data.set('next', next);
  return data;
}

function socialFormData(provider: string, next = '/community?sort=hot') {
  const data = new FormData();
  data.set('provider', provider);
  data.set('next', next);
  return data;
}

function decodeSignedCookiePayload(value: string) {
  const parts = value.split('.');
  expect(parts).toHaveLength(2);
  expect(parts[0]).toBeTruthy();
  expect(parts[1]).toBeTruthy();
  return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('signInWithSocialAction', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signInWithOAuth.mockReset();
    mocks.signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=safe' },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) {
      delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    } else {
      process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
    }
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it.each(['google', 'apple', 'kakao'])('starts %s OAuth with the trusted callback', async (provider) => {
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { provider, url: `https://provider.example/${provider}` },
      error: null,
    });

    await expect(signInWithSocialAction({}, socialFormData(provider))).rejects.toThrow(
      `NEXT_REDIRECT:https://provider.example/${provider}`,
    );
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: { redirectTo: 'https://iconsip.com/auth/callback' },
    });
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({
      next: '/community?sort=hot',
      purpose: 'oauth',
    });
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.options).toMatchObject({
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/auth/callback',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('rejects an unknown provider before calling Supabase', async () => {
    const state = await signInWithSocialAction({}, socialFormData('github'));

    expect(state.errors?.form).toBe('현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('normalizes an unsafe next path before signing it', async () => {
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://provider.example/google' },
      error: null,
    });

    await expect(
      signInWithSocialAction({}, socialFormData('google', 'https://evil.example')),
    ).rejects.toThrow('NEXT_REDIRECT:https://provider.example/google');
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({
      next: '/',
    });
  });

  it('does not expose provider errors or set auth-next state when OAuth cannot start', async () => {
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: null },
      error: { code: 'provider_disabled', message: 'private provider detail' },
    });

    const state = await signInWithSocialAction({}, socialFormData('google'));

    expect(state).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });
    expect(JSON.stringify(state)).not.toContain('private provider detail');
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)).toBeUndefined();
  });

  it('fails closed when Supabase or the signing secret is unavailable', async () => {
    mocks.isConfigured = false;
    expect(await signInWithSocialAction({}, socialFormData('google'))).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });

    mocks.isConfigured = true;
    delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    expect(await signInWithSocialAction({}, socialFormData('google'))).toEqual({
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    });
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe('signUpWithEmailAction signup confirmation resend', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: null }, error: null });
    mocks.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) {
      delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    } else {
      process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
    }
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it('starts the resend window with a signed cookie after the initial signup without storing the raw email', async () => {
    const state = await submitSignup('Fan@Icons.gg');

    expect(state.message).toContain('가입 확인 메일');
    expect(mocks.signUp).toHaveBeenCalledOnce();
    expect(mocks.resend).not.toHaveBeenCalled();

    const resendCookie = latestCookieSet(AUTH_SIGNUP_RESEND_COOKIE_NAME);
    expect(resendCookie?.value).toBeTruthy();
    expect(resendCookie?.options).toMatchObject({
      httpOnly: true,
      maxAge: 24 * 60 * 60,
      path: '/login',
      sameSite: 'lax',
      secure: true,
    });

    const payload = decodeSignedCookiePayload(resendCookie?.value ?? '');
    expect(Object.keys(payload).sort()).toEqual(['emailHash', 'resendCount', 'windowStartedAt']);
    expect(payload.emailHash).toEqual(expect.any(String));
    expect(payload.emailHash).not.toBe('fan@icons.gg');
    expect(payload.resendCount).toBe(0);
    expect(payload.windowStartedAt).toBe(Date.now());
    expect(JSON.stringify(payload)).not.toContain('Fan@Icons.gg');
    expect(JSON.stringify(payload)).not.toContain('fan@icons.gg');
  });

  it('resends the signup confirmation for the same email inside the resend window', async () => {
    await submitSignup('Fan@Icons.gg');
    mocks.signUp.mockClear();

    const state = await submitSignup('fan@icons.gg');

    expect(state.message).toContain('새 확인 메일');
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'fan@icons.gg',
      options: {
        emailRedirectTo: 'https://iconsip.com/auth/callback',
      },
    });

    const nextCookie = latestCookieSet(AUTH_NEXT_COOKIE_NAME);
    expect(nextCookie).toMatchObject({
      name: AUTH_NEXT_COOKIE_NAME,
      options: expect.objectContaining({
        httpOnly: true,
        maxAge: 10 * 60,
        path: '/auth/callback',
        sameSite: 'lax',
        secure: true,
      }),
    });
    expect(decodeSignedCookiePayload(nextCookie?.value ?? '')).toMatchObject({
      issuedAt: Date.now(),
      next: '/community?sort=hot',
      purpose: 'signup',
    });
  });

  it('blocks further resend attempts for 10 minutes after three resends', async () => {
    await submitSignup();
    await submitSignup();
    await submitSignup();
    await submitSignup();
    mocks.signUp.mockClear();
    mocks.resend.mockClear();

    const state = await submitSignup();

    expect(state.errors?.form).toContain('10분 후');
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('resends instead of calling signup again after the 10 minute cooldown expires', async () => {
    await submitSignup();
    await submitSignup();
    await submitSignup();
    await submitSignup();
    mocks.signUp.mockClear();
    mocks.resend.mockClear();

    vi.advanceTimersByTime(10 * 60 * 1000);

    const state = await submitSignup();

    expect(state.message).toContain('새 확인 메일');
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.resend).toHaveBeenCalledOnce();
    const payload = decodeSignedCookiePayload(latestCookieSet(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value ?? '');
    expect(payload.resendCount).toBe(1);
    expect(payload.windowStartedAt).toBe(Date.now());
  });

  it('ignores a tampered resend cookie and falls back to the signup path', async () => {
    await submitSignup();
    const validCookie = latestCookieSet(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value;
    expect(validCookie).toBeTruthy();
    mocks.cookies.set(AUTH_SIGNUP_RESEND_COOKIE_NAME, `${validCookie}tampered`);
    mocks.signUp.mockClear();
    mocks.resend.mockClear();

    const state = await submitSignup();

    expect(state.message).toContain('가입 확인 메일');
    expect(mocks.signUp).toHaveBeenCalledOnce();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('maps resend rate-limit errors to the existing Korean signup guidance', async () => {
    await submitSignup();
    mocks.signUp.mockClear();
    mocks.resend.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'over_email_send_rate_limit', message: 'rate limit' },
    });

    const state = await submitSignup();

    expect(state.errors?.form).toContain('확인 메일 요청이 너무 많습니다');
    expect(mocks.signUp).not.toHaveBeenCalled();
    const payload = decodeSignedCookiePayload(latestCookieSet(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value ?? '');
    expect(payload.resendCount).toBe(1);
  });

  it('blocks locally after three resend attempts even when Supabase returns resend errors', async () => {
    await submitSignup();
    mocks.signUp.mockClear();
    mocks.resend.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'over_email_send_rate_limit', message: 'rate limit' },
    });

    await submitSignup();
    await submitSignup();
    await submitSignup();
    mocks.resend.mockClear();

    const state = await submitSignup();

    expect(state.errors?.form).toContain('10분 후');
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it('attempts a resend and returns a success-like message for existing-account signup errors', async () => {
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    });

    const state = await submitSignup('Fan@Icons.gg');

    expect(state.message).toContain('확인 메일');
    expect(state.errors).toBeUndefined();
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'fan@icons.gg',
      options: {
        emailRedirectTo: 'https://iconsip.com/auth/callback',
      },
    });
    const payload = decodeSignedCookiePayload(latestCookieSet(AUTH_SIGNUP_RESEND_COOKIE_NAME)?.value ?? '');
    expect(payload.resendCount).toBe(1);
  });
});

describe('requestPasswordResetAction', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) {
      delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    } else {
      process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
    }
    if (ORIGINAL_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  });

  it('validates the email before calling Supabase', async () => {
    const empty = await requestPasswordResetAction({}, resetFormData(''));
    const invalid = await requestPasswordResetAction({}, resetFormData('not-an-email'));

    expect(empty.errors?.email).toBe('이메일을 입력해주세요.');
    expect(invalid.errors?.email).toContain('이메일 주소 형식');
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('stores signed recovery state and sends a queryless callback URL', async () => {
    const state = await requestPasswordResetAction({}, resetFormData());

    expect(state).toEqual({
      message: '해당 이메일로 가입한 계정이 있다면 재설정 메일을 보냈습니다. 요청한 브라우저에서 최신 링크를 열어주세요.',
    });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('fan@icons.gg', {
      redirectTo: 'https://iconsip.com/auth/callback',
    });

    const nextCookie = latestCookieSet(AUTH_NEXT_COOKIE_NAME);
    expect(nextCookie?.options).toMatchObject({
      httpOnly: true,
      maxAge: 60 * 60,
      path: '/auth/callback',
      sameSite: 'lax',
      secure: true,
    });
    expect(decodeSignedCookiePayload(nextCookie?.value ?? '')).toMatchObject({
      issuedAt: Date.now(),
      next: '/community?sort=hot',
      purpose: 'recovery',
    });
    expect(JSON.stringify(mocks.cookieSetCalls)).not.toContain('Fan@Icons.gg');
    expect(JSON.stringify(mocks.cookieSetCalls)).not.toContain('fan@icons.gg');
  });

  it('does not trust an unrecognized request origin for the recovery redirect', async () => {
    mocks.headers = new Map<string, string>([
      ['origin', 'https://evil.example'],
      ['host', 'evil.example'],
    ]);

    await requestPasswordResetAction({}, resetFormData());

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('fan@icons.gg', {
      redirectTo: 'https://iconsip.com/auth/callback',
    });
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.options).toMatchObject({ secure: true });
  });

  it('accepts only the current platform-provided Vercel deployment origin for preview recovery', async () => {
    process.env.VERCEL_URL = 'icons-ip-feature-team.vercel.app';
    mocks.headers = new Map<string, string>([
      ['origin', 'https://icons-ip-feature-team.vercel.app'],
    ]);

    await requestPasswordResetAction({}, resetFormData());

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('fan@icons.gg', {
      redirectTo: 'https://icons-ip-feature-team.vercel.app/auth/callback',
    });
  });

  it('consumes and stores the browser rate limit before calling Supabase', async () => {
    mocks.resetPasswordForEmail.mockImplementationOnce(async () => {
      expect(latestCookieSet(AUTH_PASSWORD_RESET_COOKIE_NAME)?.value).toBeTruthy();
      return { data: {}, error: { code: 'user_not_found' } };
    });

    const state = await requestPasswordResetAction({}, resetFormData());

    expect(state.message).toContain('계정이 있다면');
    expect(latestCookieSet(AUTH_PASSWORD_RESET_COOKIE_NAME)?.options).toMatchObject({
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/login',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('allows three attempts per normalized email and blocks the fourth before Supabase', async () => {
    await requestPasswordResetAction({}, resetFormData('Fan@Icons.gg'));
    await requestPasswordResetAction({}, resetFormData(' fan@icons.gg '));
    await requestPasswordResetAction({}, resetFormData('FAN@ICONS.GG'));
    const blocked = await requestPasswordResetAction({}, resetFormData('fan@icons.gg'));

    expect(blocked.errors?.form).toContain('10분 후');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(3);
  });

  it.each(['user_not_found', 'email_not_found'])('keeps %s indistinguishable from success', async (code) => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code } });

    const state = await requestPasswordResetAction({}, resetFormData());

    expect(state).toEqual({
      message: '해당 이메일로 가입한 계정이 있다면 재설정 메일을 보냈습니다. 요청한 브라우저에서 최신 링크를 열어주세요.',
    });
  });

  it.each([
    ['over_email_send_rate_limit', '요청이 너무 많습니다'],
    ['over_request_rate_limit', '요청이 너무 많습니다'],
    ['email_provider_disabled', '현재 비밀번호 재설정 메일을 보낼 수 없습니다'],
    ['email_address_not_authorized', '현재 비밀번호 재설정 메일을 보낼 수 없습니다'],
    ['unexpected_failure', '현재 비밀번호 재설정 요청을 처리할 수 없습니다'],
    ['request_timeout', '현재 비밀번호 재설정 요청을 처리할 수 없습니다'],
  ])('reports the operational error %s without exposing account existence', async (code, message) => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code } });

    const state = await requestPasswordResetAction({}, resetFormData());

    expect(state.errors?.form).toContain(message);
  });
});
