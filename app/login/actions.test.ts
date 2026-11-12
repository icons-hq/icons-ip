import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminSignOutAction,
  linkKakaoAccountAction,
  requestPasswordResetAction,
  resendSignupCodeAction,
  signOutAction,
  signInWithSocialAction,
  signUpWithEmailAction,
  verifySignupCodeAction,
} from './actions';

const AUTH_SIGNUP_RESEND_COOKIE_NAME = 'icons_auth_signup_resend';
const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
const AUTH_RECOVERY_NEXT_COOKIE_NAME = 'icons_auth_recovery_next';
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
  signOut: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  linkIdentity: vi.fn(),
  getProfileForUser: vi.fn(),
  cookieDeletes: [] as string[],
  createClientOptions: [] as unknown[],
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.isConfigured }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (options?: unknown) => (mocks.createClientOptions.push(options), {
    auth: {
      signUp: mocks.signUp,
      signInWithOAuth: mocks.signInWithOAuth,
      signOut: mocks.signOut,
      resend: mocks.resend,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      verifyOtp: mocks.verifyOtp,
      signInWithPassword: mocks.signInWithPassword,
      getUser: mocks.getUser,
      linkIdentity: mocks.linkIdentity,
    },
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  getProfileForUser: mocks.getProfileForUser,
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
    getAll: () => [...mocks.cookies.entries()].map(([name, value]) => ({ name, value })),
    delete: (name: string) => {
      mocks.cookieDeletes.push(name);
      mocks.cookies.delete(name);
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

  /* SHEET-005 '로그인 상태 유지'는 소셜 로그인에도 적용한다(오케스트레이터 결정 11/12). 화면이 숨은 칸(keepSignedIn=1|0)으로
     체크 상태를 보내고, 끄면 '유지하지 않음' 표시를 세션 쿠키로 남긴다 — 콜백(lib/auth/callback.server.ts)이 그 표시로 세션 쿠키를
     브라우저 세션 쿠키로 쓴다. PKCE 확인값 쿠키를 쓰는 이 요청의 클라이언트도 같은 선택이다. */
  describe("'로그인 상태 유지'", () => {
    function keepForm(keep: '1' | '0' | null) {
      const data = socialFormData('google');
      if (keep !== null) data.set('keepSignedIn', keep);
      return data;
    }

    beforeEach(() => {
      mocks.cookieDeletes.length = 0;
      mocks.createClientOptions.length = 0;
    });

    it('끄고(keepSignedIn=0) 소셜 버튼을 누르면 세션 표시를 남기고 이 요청을 세션 쿠키로 쓴다', async () => {
      await expect(signInWithSocialAction({}, keepForm('0'))).rejects.toThrow('NEXT_REDIRECT:https://accounts.google.com');

      expect(mocks.createClientOptions).toEqual([{ sessionOnly: true }]);
      const marker = latestCookieSet('icons_auth_session_only');
      expect(marker).toEqual({ name: 'icons_auth_session_only', value: '1', options: { path: '/', sameSite: 'lax', httpOnly: false, secure: true } });
      expect(marker?.options).not.toHaveProperty('maxAge');
      /* 표시는 OAuth 이동 직전, 서명된 next 쿠키와 함께 남는다. */
      expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)).toBeDefined();
    });

    it('켜 둔 채(keepSignedIn=1) 누르면 지금처럼 유지하고 이전 세션 표시를 걷는다', async () => {
      mocks.cookies.set('icons_auth_session_only', '1');

      await expect(signInWithSocialAction({}, keepForm('1'))).rejects.toThrow('NEXT_REDIRECT:https://accounts.google.com');

      expect(mocks.createClientOptions).toEqual([{ sessionOnly: false }]);
      expect(mocks.cookieDeletes).toEqual(['icons_auth_session_only']);
      expect(latestCookieSet('icons_auth_session_only')).toBeUndefined();
    });

    it('값이 없는 호출은 기본값(유지)이다 — 표시를 남기지 않는다', async () => {
      await expect(signInWithSocialAction({}, keepForm(null))).rejects.toThrow('NEXT_REDIRECT:https://accounts.google.com');

      expect(mocks.createClientOptions).toEqual([{ sessionOnly: false }]);
      expect(latestCookieSet('icons_auth_session_only')).toBeUndefined();
    });

    it('OAuth 를 시작하지 못하면 표시를 바꾸지 않는다', async () => {
      mocks.cookies.set('icons_auth_session_only', '1');
      mocks.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { code: 'provider_disabled' } });

      await signInWithSocialAction({}, keepForm('1'));

      expect(mocks.cookieDeletes).toEqual([]);
      expect(latestCookieSet('icons_auth_session_only')).toBeUndefined();
    });
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
      redirectTo: 'https://iconsip.com/auth/recovery/callback',
    });

    const nextCookie = latestCookieSet(AUTH_RECOVERY_NEXT_COOKIE_NAME);
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)).toBeUndefined();
    expect(nextCookie?.options).toMatchObject({
      httpOnly: true,
      maxAge: 60 * 60,
      path: '/auth/recovery/callback',
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
      redirectTo: 'https://iconsip.com/auth/recovery/callback',
    });
    expect(latestCookieSet(AUTH_RECOVERY_NEXT_COOKIE_NAME)?.options).toMatchObject({ secure: true });
  });

  it('accepts only the current platform-provided Vercel deployment origin for preview recovery', async () => {
    process.env.VERCEL_URL = 'icons-ip-feature-team.vercel.app';
    mocks.headers = new Map<string, string>([
      ['origin', 'https://icons-ip-feature-team.vercel.app'],
    ]);

    await requestPasswordResetAction({}, resetFormData());

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('fan@icons.gg', {
      redirectTo: 'https://icons-ip-feature-team.vercel.app/auth/recovery/callback',
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
      // 설정 화면(/settings)의 재설정 버튼도 이 action을 쓴다 — /login 경로로 묶으면 그 요청은 제한을 세지 않는다.
      path: '/',
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

describe('sign-out actions', () => {
  beforeEach(() => {
    mocks.isConfigured = true;
    mocks.signOut.mockReset();
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it('ends only the local session and returns an admin deep link to the shared login screen', async () => {
    const data = new FormData();
    data.set('next', '/admin/sales/coupons?status=active&page=2');

    await expect(adminSignOutAction({}, data)).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fcoupons%3Fstatus%3Dactive%26page%3D2',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('falls back to the admin home when the submitted return path is not an admin path', async () => {
    const data = new FormData();
    data.set('next', 'https://evil.example/account');

    await expect(adminSignOutAction({}, data)).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
  });

  it('keeps the admin screen available for retry when local sign-out fails', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { code: 'network_error', message: 'private detail' } });
    const data = new FormData();
    data.set('next', '/admin');

    const state = await adminSignOutAction({}, data);

    expect(state.errors?.form).toBe('로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.');
    expect(JSON.stringify(state)).not.toContain('private detail');
  });

  it('keeps public logout on the shared home destination', async () => {
    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  /* SHEET-005 — 세션이 끝나면 '로그인 상태 유지'를 끈 표시도 걷는다. 로그아웃이 실패하면 세션이 남으므로 표시도 남긴다. */
  it("clears the '로그인 상태 유지' marker only after the local session actually ends", async () => {
    mocks.cookies.set('icons_auth_session_only', '1');
    mocks.cookieDeletes.length = 0;
    mocks.signOut.mockResolvedValueOnce({ error: { code: 'network_error', message: 'private detail' } });
    const data = new FormData();
    data.set('next', '/admin');

    await adminSignOutAction({}, data);
    expect(mocks.cookies.get('icons_auth_session_only')).toBe('1');

    await expect(signOutAction()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(mocks.cookieDeletes).toEqual(['icons_auth_session_only']);
    expect(mocks.cookies.has('icons_auth_session_only')).toBe(false);
  });
});

/* 1014-004 — 가입 확인을 메일 링크 대신 같은 화면의 6자리 코드로 끝낸다. */
describe('signup confirmation code', () => {
  const ONBOARDED_PROFILE = {
    email: 'fan@icons.gg', nickname: 'fan_abcd1234', birth_date: '2000-01-01', avatar_path: null,
    consents: { terms: true, privacy: true }, onboarded_at: '2026-11-01T00:00:00.000Z', role: 'user', suspended_at: null,
  };

  function codeForm(code: string, email = 'Fan@Icons.gg', next = '/community?sort=hot', password: string | null = 'password1234') {
    const data = new FormData();
    data.set('email', email);
    data.set('code', code);
    data.set('next', next);
    if (password !== null) data.set('password', password);
    return data;
  }

  /* GoTrue가 돌려주는 access token 모양(서명은 보지 않는다). AMR이 세션을 어떻게 만들었는지 말한다. */
  function accessToken(methods: string[]) {
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1', amr: methods.map((method) => ({ method, timestamp: 1 })) })).toString('base64url');
    return `header.${payload}.signature`;
  }

  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.verifyOtp.mockReset();
    mocks.signOut.mockReset();
    mocks.signInWithPassword.mockReset();
    mocks.getProfileForUser.mockReset();
    mocks.cookieDeletes.length = 0;
    mocks.signUp.mockResolvedValue({ data: { user: { id: 'user-1' }, session: null }, error: null });
    mocks.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg' }, session: { access_token: accessToken(['otp']) } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg' }, session: { access_token: accessToken(['password']) } },
      error: null,
    });
    mocks.getProfileForUser.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) {
      delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    } else {
      process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
    }
  });

  it('hands the normalized email to the code step whenever a confirmation mail was sent', async () => {
    expect(await submitSignup('Fan@Icons.gg')).toMatchObject({ pendingSignupEmail: 'fan@icons.gg' });
    expect(await submitSignup('Fan@Icons.gg')).toMatchObject({ pendingSignupEmail: 'fan@icons.gg' });

    mocks.cookies.clear();
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    });
    expect(await submitSignup('Fan@Icons.gg')).toMatchObject({ pendingSignupEmail: 'fan@icons.gg' });
  });

  it('does not open the code step for validation errors', async () => {
    mocks.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'weak_password', message: 'weak' } });

    const state = await submitSignup('Fan@Icons.gg');
    expect(state.pendingSignupEmail).toBeUndefined();
    expect(state.errors?.form).toContain('비밀번호가 보안 조건을 충족하지 않습니다');
  });

  /* 리뷰 F1 — 코드 확인 세션(AMR otp)은 '현재 비밀번호 요구' 가드를 면제받는다. 바로 닫고 비밀번호 로그인 세션으로 바꾼다. */
  it('closes the code session and continues with a password session to onboarding', async () => {
    await expect(verifySignupCodeAction({}, codeForm(' 123 456 '))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: 'fan@icons.gg', token: '123456', type: 'email' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'fan@icons.gg', password: 'password1234' });
    expect(mocks.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.signInWithPassword.mock.invocationCallOrder[0]);
  });

  it('sends the member to the sign-in screen when the password is not in screen memory (reload)', async () => {
    await expect(verifySignupCodeAction({}, codeForm('123456', 'Fan@Icons.gg', '/community?sort=hot', null))).rejects.toThrow(
      'NEXT_REDIRECT:/login?mode=signin&signup_confirmed=1&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('never keeps a session whose AMR is not a password sign-in', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'fan@icons.gg' }, session: { access_token: accessToken(['password', 'otp']) } },
      error: null,
    });

    await expect(verifySignupCodeAction({}, codeForm('123456'))).rejects.toThrow('NEXT_REDIRECT:/login?mode=signin&signup_confirmed=1');
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });

  it('sends the member to the sign-in screen when the password sign-in fails', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'invalid_credentials', message: 'nope' } });

    await expect(verifySignupCodeAction({}, codeForm('123456'))).rejects.toThrow('NEXT_REDIRECT:/login?mode=signin&signup_confirmed=1');
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('removes the session cookies itself when signing out the code session fails', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { status: 500, message: 'auth unavailable' } });
    mocks.cookies.set('sb-local-auth-token', 'otp-session');
    mocks.cookies.set('sb-local-auth-token.1', 'otp-session-part');
    mocks.cookies.set('icons_auth_next', 'keep');

    await expect(verifySignupCodeAction({}, codeForm('123456', 'Fan@Icons.gg', '/', null))).rejects.toThrow('NEXT_REDIRECT:/login?mode=signin&signup_confirmed=1');
    expect(mocks.cookieDeletes.sort()).toEqual(['sb-local-auth-token', 'sb-local-auth-token.1']);
  });

  it('does not touch the session when the code itself is wrong', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'otp_expired', message: 'Token has expired or is invalid' } });

    await verifySignupCodeAction({}, codeForm('123456'));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('goes straight to next for an already onboarded account and to the suspended page for a suspended one', async () => {
    mocks.getProfileForUser.mockResolvedValueOnce(ONBOARDED_PROFILE);
    await expect(verifySignupCodeAction({}, codeForm('123456'))).rejects.toThrow('NEXT_REDIRECT:/community?sort=hot');

    mocks.getProfileForUser.mockResolvedValueOnce({ ...ONBOARDED_PROFILE, suspended_at: '2026-11-01T00:00:00.000Z' });
    await expect(verifySignupCodeAction({}, codeForm('123456'))).rejects.toThrow('NEXT_REDIRECT:/account-suspended');
  });

  it.each(['12345', '1234567', 'abcdef', ''])('rejects %j as a code before calling Supabase', async (code) => {
    await expect(verifySignupCodeAction({}, codeForm(code))).resolves.toEqual({
      errors: { code: '메일로 받은 6자리 숫자를 입력해주세요.' },
      pendingSignupEmail: 'fan@icons.gg',
    });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('maps a wrong or expired code to one message without exposing Supabase details', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'otp_expired', message: 'Token has expired or is invalid' } });

    const state = await verifySignupCodeAction({}, codeForm('123456'));
    expect(state).toEqual({
      errors: { code: '확인 코드가 맞지 않거나 만료됐어요. 가장 최근 메일의 코드를 확인하거나 코드를 다시 받아주세요.' },
      pendingSignupEmail: 'fan@icons.gg',
    });
    expect(JSON.stringify(state)).not.toContain('Token has expired');

    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'over_request_rate_limit', message: 'rate' } });
    expect((await verifySignupCodeAction({}, codeForm('123456'))).errors?.code).toBe('확인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');
  });

  it('requires an email and a configured backend', async () => {
    expect(await verifySignupCodeAction({}, codeForm('123456', ''))).toEqual({
      errors: { form: '확인할 이메일을 찾지 못했습니다. 회원가입을 다시 시작해주세요.' },
    });
    mocks.isConfigured = false;
    expect((await verifySignupCodeAction({}, codeForm('123456'))).errors?.form).toContain('Supabase 환경변수');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('resends from the code step through the same 10-minute window as resubmitting the signup form', async () => {
    const resendForm = () => {
      const data = new FormData();
      data.set('email', 'Fan@Icons.gg');
      data.set('next', '/community?sort=hot');
      return data;
    };

    await submitSignup('Fan@Icons.gg');
    expect(await resendSignupCodeAction({}, resendForm())).toEqual({
      message: '새 확인 메일을 보냈습니다. 가장 최근에 받은 메일의 6자리 확인 코드를 입력해주세요.',
      pendingSignupEmail: 'fan@icons.gg',
    });
    expect(mocks.resend).toHaveBeenLastCalledWith({
      type: 'signup',
      email: 'fan@icons.gg',
      options: { emailRedirectTo: 'https://iconsip.com/auth/callback' },
    });
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({
      next: '/community?sort=hot',
      purpose: 'signup',
    });

    await resendSignupCodeAction({}, resendForm());
    await submitSignup('Fan@Icons.gg');
    mocks.resend.mockClear();
    expect(await resendSignupCodeAction({}, resendForm())).toEqual({
      errors: { form: '확인 메일 재요청이 너무 많습니다. 10분 후 다시 시도해주세요.' },
      pendingSignupEmail: 'fan@icons.gg',
    });
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  /* 이 브라우저에서 그 이메일로 가입을 시작한 창이 없으면 보내지 않는다 — 아무 이메일로나 확인 메일을 보내는 통로가 되지 않게. */
  it('refuses a code-step resend for an email this browser did not sign up with', async () => {
    await submitSignup('Fan@Icons.gg');
    mocks.resend.mockClear();
    const data = new FormData();
    data.set('email', 'other@icons.gg');

    expect(await resendSignupCodeAction({}, data)).toEqual({
      errors: { form: '코드를 다시 받으려면 [다른 이메일로 가입하기]를 눌러 같은 이메일로 회원가입을 다시 제출해주세요.' },
      pendingSignupEmail: 'other@icons.gg',
    });
    mocks.cookies.clear();
    data.set('email', 'Fan@Icons.gg');
    expect((await resendSignupCodeAction({}, data)).errors?.form).toContain('회원가입을 다시 제출해주세요');
    expect(mocks.resend).not.toHaveBeenCalled();
  });
});

/* 1014-014 — 카카오톡 채널 스위치가 켜졌을 때만 카카오 로그인에 채널 관계 동의항목(plusfriends)을 더한다. */
describe('signInWithSocialAction kakao channel scope', () => {
  const KAKAO_ENV = {
    ICONS_KAKAO_CHANNEL_ENABLED: 'true',
    KAKAO_CHANNEL_PUBLIC_ID: '_IconsTest',
    KAKAO_ADMIN_KEY: '0123456789abcdef0123456789abcdef',
  } as const;
  const original = Object.fromEntries(Object.keys(KAKAO_ENV).map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.signInWithOAuth.mockReset();
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.example/start' }, error: null });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
  });

  it('asks Kakao for the plusfriends consent only while the switch is on', async () => {
    Object.assign(process.env, KAKAO_ENV);

    await expect(signInWithSocialAction({}, socialFormData('kakao'))).rejects.toThrow('NEXT_REDIRECT:https://provider.example/start');
    expect(mocks.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'kakao',
      options: { redirectTo: 'https://iconsip.com/auth/callback', scopes: 'plusfriends' },
    });

    await expect(signInWithSocialAction({}, socialFormData('google'))).rejects.toThrow('NEXT_REDIRECT:https://provider.example/start');
    expect(mocks.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://iconsip.com/auth/callback' },
    });
  });

  it('keeps the Kakao request unchanged while the switch is off', async () => {
    for (const key of Object.keys(KAKAO_ENV)) delete process.env[key];

    await expect(signInWithSocialAction({}, socialFormData('kakao'))).rejects.toThrow('NEXT_REDIRECT:https://provider.example/start');
    expect(mocks.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'kakao',
      options: { redirectTo: 'https://iconsip.com/auth/callback' },
    });
  });
});

/* 리뷰 F10 — 설정의 [카카오 계정 연결]. 가입 수단과 무관하게 카카오 identity를 붙이며 같은 동의 화면에서 채널을 추가한다. */
describe('linkKakaoAccountAction', () => {
  const KAKAO_ENV = {
    ICONS_KAKAO_CHANNEL_ENABLED: 'true',
    KAKAO_CHANNEL_PUBLIC_ID: '_IconsTest',
    KAKAO_ADMIN_KEY: '0123456789abcdef0123456789abcdef',
  } as const;
  const original = Object.fromEntries(Object.keys(KAKAO_ENV).map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = TEST_SIGNUP_RESEND_SECRET;
    Object.assign(process.env, KAKAO_ENV);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
    mocks.isConfigured = true;
    mocks.headers = new Map<string, string>([['origin', 'https://iconsip.com']]);
    mocks.cookies.clear();
    mocks.cookieSetCalls.length = 0;
    mocks.getUser.mockReset();
    mocks.linkIdentity.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg', identities: [{ provider: 'email' }] } }, error: null });
    mocks.linkIdentity.mockResolvedValue({ data: { provider: 'kakao', url: 'https://kauth.kakao.com/oauth/authorize?state=safe' }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (ORIGINAL_SIGNUP_RESEND_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SIGNUP_RESEND_SECRET;
  });

  it('links Kakao with the channel consent and returns the result to settings through a signed link state', async () => {
    await expect(linkKakaoAccountAction()).rejects.toThrow('NEXT_REDIRECT:https://kauth.kakao.com/oauth/authorize?state=safe');
    expect(mocks.linkIdentity).toHaveBeenCalledWith({
      provider: 'kakao',
      options: { redirectTo: 'https://iconsip.com/auth/callback', scopes: 'plusfriends' },
    });
    expect(decodeSignedCookiePayload(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.value ?? '')).toMatchObject({ next: '/settings', purpose: 'link' });
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)?.options).toMatchObject({ httpOnly: true, maxAge: 10 * 60, path: '/auth/callback' });
  });

  it('does nothing while the kakao channel switch is off', async () => {
    for (const key of Object.keys(KAKAO_ENV)) delete process.env[key];

    expect(await linkKakaoAccountAction()).toEqual({
      errors: { form: '지금은 카카오 계정을 연결할 수 없어요. 잠시 후 다시 시도해주세요.' },
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in and back to settings', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'session_not_found' } });

    await expect(linkKakaoAccountAction()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fsettings');
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
  });

  it('does not link a second Kakao identity', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1', identities: [{ provider: 'kakao' }] } }, error: null });

    expect(await linkKakaoAccountAction()).toEqual({ message: '이미 카카오 계정이 연결돼 있어요.' });
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
  });

  /* manual linking이 꺼진 운영(사람 게이트 전)에서는 GoTrue가 거절한다 — 안내만 하고 상태를 남기지 않는다. */
  it('fails closed without auth-next state when Supabase refuses the link', async () => {
    mocks.linkIdentity.mockResolvedValueOnce({ data: { provider: 'kakao', url: null }, error: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' } });

    const state = await linkKakaoAccountAction();
    expect(state).toEqual({ errors: { form: '지금은 카카오 계정을 연결할 수 없어요. 잠시 후 다시 시도해주세요.' } });
    expect(JSON.stringify(state)).not.toContain('Manual linking');
    expect(latestCookieSet(AUTH_NEXT_COOKIE_NAME)).toBeUndefined();
  });
});
