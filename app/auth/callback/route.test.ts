import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signedAuthNextCookieValue } from '../../../lib/auth/recovery.server';
import { GET } from './route';

const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
const SECRET = 'test-signup-resend-secret-with-enough-entropy';
const ORIGINAL_SECRET = process.env.AUTH_SIGNUP_RESEND_SECRET;

const completeProfile = {
  email: 'fan@icons.gg',
  nickname: 'fan',
  birth_date: '2000-01-01',
  consents: { terms: true, privacy: true, marketing: false },
  onboarded_at: '2026-06-23T00:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  configured: true,
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  getProfileForUser: vi.fn(),
  setAll: null as null | ((cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>, headers: Record<string, string>) => void),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../../lib/auth/onboarding'));
vi.mock('@/lib/auth/recovery.server', async () => await import('../../../lib/auth/recovery.server'));
vi.mock('@/lib/auth/server', () => ({
  getProfileForUser: mocks.getProfileForUser,
}));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({
    isConfigured: mocks.configured,
    url: mocks.configured ? 'http://127.0.0.1:54321' : undefined,
    key: mocks.configured ? 'publishable-key' : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
    },
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: {
      setAll: typeof mocks.setAll;
    };
  }) => {
    mocks.setAll = options.cookies.setAll;
    return {
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        getUser: mocks.getUser,
        signOut: mocks.signOut,
      },
    };
  },
}));

function request(path: string, cookieValue?: string) {
  return new NextRequest(new URL(path, 'https://iconsip.com'), {
    headers: cookieValue ? { cookie: `${AUTH_NEXT_COOKIE_NAME}=${cookieValue}` } : undefined,
  });
}

function signedCookie(purpose: 'signup' | 'recovery', next = '/community?sort=hot') {
  return signedAuthNextCookieValue(next, purpose, Date.now(), SECRET);
}

function locationPath(response: Response) {
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  const url = new URL(location ?? 'https://iconsip.com');
  return `${url.pathname}${url.search}`;
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
    mocks.configured = true;
    mocks.exchangeCodeForSession.mockReset();
    mocks.getUser.mockReset();
    mocks.signOut.mockReset();
    mocks.getProfileForUser.mockReset();
    mocks.setAll = null;
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'signup' }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg' } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getProfileForUser.mockResolvedValue(completeProfile);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SECRET;
  });

  it('prioritizes signed recovery next, revalidates the user, and bypasses onboarding', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null });

    const response = await GET(request(
      '/auth/callback?code=recovery-code&next=%2Fshop',
      signedCookie('recovery'),
    ));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.getProfileForUser).not.toHaveBeenCalled();
    expect(locationPath(response)).toBe(
      '/update-password?session_ready=1&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('forwards exchanged session cookies and no-store headers onto the redirect response', async () => {
    mocks.exchangeCodeForSession.mockImplementationOnce(async () => {
      mocks.setAll?.([
        {
          name: 'sb-local-auth-token',
          value: 'session-value',
          options: { httpOnly: true, path: '/', sameSite: 'lax' },
        },
      ], {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
      });
      return { data: { redirectType: 'recovery' }, error: null };
    });

    const response = await GET(request('/auth/callback?code=recovery-code', signedCookie('recovery')));

    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=session-value');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(locationPath(response)).toContain('/update-password');
  });

  it('uses the authoritative recovery redirect type when no marker is available', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'recovery' }, error: null });

    const response = await GET(request('/auth/callback?code=recovery-code&next=%2Fshop'));

    expect(locationPath(response)).toBe('/update-password?session_ready=1');
    expect(mocks.getProfileForUser).not.toHaveBeenCalled();
  });

  it('uses the successful exchange type instead of a stale recovery marker', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: 'signup' }, error: null });
    mocks.getProfileForUser.mockResolvedValue({ ...completeProfile, onboarded_at: null });

    const response = await GET(request('/auth/callback?code=signup-code', signedCookie('recovery')));

    expect(locationPath(response)).toBe('/onboarding?next=%2F');
    expect(mocks.getProfileForUser).toHaveBeenCalledOnce();
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_NEXT_COOKIE_NAME}=;`);
  });

  it('keeps the existing signup onboarding gate and clears signup next state', async () => {
    mocks.getProfileForUser.mockResolvedValue({ ...completeProfile, onboarded_at: null });

    const response = await GET(request('/auth/callback?code=signup-code', signedCookie('signup')));

    expect(locationPath(response)).toBe('/onboarding?next=%2Fcommunity%3Fsort%3Dhot');
    expect(mocks.getProfileForUser).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_NEXT_COOKIE_NAME}=;`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps onboarded signup users on their safe next path', async () => {
    const response = await GET(request('/auth/callback?code=signup-code', signedCookie('signup')));

    expect(locationPath(response)).toBe('/community?sort=hot');
    expect(mocks.getProfileForUser).toHaveBeenCalledOnce();
  });

  it('redirects a suspended signup session before onboarding or next', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      ...completeProfile,
      suspended_at: '2026-07-17T00:00:00.000Z',
    });

    const response = await GET(request('/auth/callback?code=signup-code', signedCookie('signup')));

    expect(locationPath(response)).toBe('/account-suspended');
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_NEXT_COOKIE_NAME}=;`);
  });

  it.each([
    ['/auth/callback?error_code=otp_expired', 'otp_expired'],
    ['/auth/callback', 'missing_code'],
  ])('routes identifiable recovery failure %s to reset-specific UX', async (path, code) => {
    const response = await GET(request(path, signedCookie('recovery')));

    expect(locationPath(response)).toBe(
      `/login?mode=reset&reset_error=${code}&next=%2Fcommunity%3Fsort%3Dhot`,
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('routes a recovery exchange failure to reset-specific UX', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: null },
      error: { code: 'pkce_code_verifier_not_found' },
    });

    const response = await GET(request('/auth/callback?code=stale-code', signedCookie('recovery')));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=pkce_code_verifier_not_found&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('does not guess recovery purpose when another browser has neither marker nor verifier', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { redirectType: null },
      error: { code: 'pkce_code_verifier_not_found' },
    });

    const response = await GET(request('/auth/callback?code=cross-browser-code'));

    expect(locationPath(response)).toBe(
      '/login?mode=signin&auth_error=pkce_code_verifier_not_found',
    );
  });

  it('keeps general signup provider failures on the existing auth error UX', async () => {
    const response = await GET(request(
      '/auth/callback?error_code=otp_expired',
      signedCookie('signup'),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=signin&auth_error=otp_expired&next=%2Fcommunity%3Fsort%3Dhot',
    );
  });

  it('routes failed user revalidation according to the recovery purpose', async () => {
    mocks.exchangeCodeForSession.mockImplementationOnce(async () => {
      mocks.setAll?.([
        {
          name: 'sb-local-auth-token',
          value: 'session-value',
          options: { httpOnly: true, path: '/', sameSite: 'lax' },
        },
      ], {});
      return { data: { redirectType: 'recovery' }, error: null };
    });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'session_not_found' } });

    const response = await GET(request('/auth/callback?code=recovery-code', signedCookie('recovery')));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=exchange_failed&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.getProfileForUser).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.headers.get('set-cookie')).not.toContain('session-value');
    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
