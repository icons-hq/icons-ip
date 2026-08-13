import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signedAuthNextCookieValue } from '../../../../lib/auth/recovery.server';
import { GET } from './route';

const AUTH_NEXT_COOKIE_NAME = 'icons_auth_recovery_next';
const SECRET = 'test-recovery-callback-secret-with-enough-entropy';
const ORIGINAL_SECRET = process.env.AUTH_SIGNUP_RESEND_SECRET;

const mocks = vi.hoisted(() => ({
  configured: true,
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  setAll: null as null | ((
    cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
    headers: Record<string, string>,
  ) => void),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({
    isConfigured: mocks.configured,
    url: mocks.configured ? 'http://127.0.0.1:54321' : undefined,
    key: mocks.configured ? 'publishable-key' : undefined,
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: typeof mocks.setAll };
  }) => {
    mocks.setAll = options.cookies.setAll;
    return {
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        verifyOtp: mocks.verifyOtp,
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

function signedRecoveryCookie(next = '/community?sort=hot') {
  return signedAuthNextCookieValue(next, 'recovery', Date.now(), SECRET);
}

function locationPath(response: Response) {
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  const url = new URL(location ?? 'https://iconsip.com');
  return `${url.pathname}${url.search}`;
}

describe('GET /auth/recovery/callback', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    mocks.configured = true;
    mocks.exchangeCodeForSession.mockReset();
    mocks.verifyOtp.mockReset();
    mocks.getUser.mockReset();
    mocks.signOut.mockReset();
    mocks.setAll = null;
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg' } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SECRET;
  });

  it('exchanges a same-browser recovery code and opens password update', async () => {
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

    const response = await GET(request(
      '/auth/recovery/callback?code=recovery-code',
      signedRecoveryCookie(),
    ));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(locationPath(response)).toBe(
      '/update-password?session_ready=1&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=session-value');
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_NEXT_COOKIE_NAME}=;`);
    expect(response.headers.get('set-cookie')).toContain('Path=/auth/recovery/callback');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('verifies a recovery token hash and opens password update in the requesting browser', async () => {
    mocks.verifyOtp.mockImplementationOnce(async () => {
      mocks.setAll?.([
        {
          name: 'sb-local-auth-token',
          value: 'session-value',
          options: { httpOnly: true, path: '/', sameSite: 'lax' },
        },
      ], {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
      });
      return {
        data: { session: { access_token: 'redacted' }, user: { id: 'user-1' } },
        error: null,
      };
    });

    const response = await GET(request(
      '/auth/recovery/callback?token_hash=recovery-token-hash&type=recovery',
      signedRecoveryCookie(),
    ));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'recovery-token-hash',
      type: 'recovery',
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(locationPath(response)).toBe(
      '/update-password?session_ready=1&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=session-value');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('routes an expired or reused token hash through the recovery error UX', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { code: 'otp_expired', message: 'private token detail' },
    });

    const response = await GET(request(
      '/auth/recovery/callback?token_hash=reused-token-hash&type=recovery',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=link_expired_or_used&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('location')).not.toContain('private');
    expect(response.headers.get('location')).not.toContain('reused-token-hash');
    expect(response.headers.get('set-cookie') ?? '').not.toContain(
      `${AUTH_NEXT_COOKIE_NAME}=;`,
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('rejects a token hash with a non-recovery type before verification', async () => {
    const response = await GET(request(
      '/auth/recovery/callback?token_hash=recovery-token-hash&type=signup',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=browser_mismatch&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('does not consume a token hash when the requesting-browser state is missing', async () => {
    const response = await GET(request(
      '/auth/recovery/callback?token_hash=recovery-token-hash&type=recovery',
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=browser_mismatch',
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('routes a different-browser PKCE failure to the public browser-mismatch code', async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      data: { redirectType: null },
      error: {
        code: 'pkce_code_verifier_not_found',
        message: 'private verifier detail',
      },
    });

    const response = await GET(request('/auth/recovery/callback?code=cross-browser-code'));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=browser_mismatch',
    );
    expect(response.headers.get('location')).not.toContain('pkce');
    expect(response.headers.get('location')).not.toContain('private');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('normalizes an expired provider link before attempting an exchange', async () => {
    const response = await GET(request(
      '/auth/recovery/callback?error_code=otp_expired&error_description=private-token-detail',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=link_expired_or_used&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('location')).not.toContain('private');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('rejects a missing code without trusting a query next path', async () => {
    const response = await GET(request(
      '/auth/recovery/callback?next=https%3A%2F%2Fevil.example%2Fsteal',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=missing_code&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(response.headers.get('location')).not.toContain('evil');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('expires an exchanged session when recovery state is missing', async () => {
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

    const response = await GET(request('/auth/recovery/callback?code=recovery-code'));

    expect(locationPath(response)).toBe('/login?mode=reset&reset_error=browser_mismatch');
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.headers.get('set-cookie')).not.toContain('session-value');
    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie') ?? '').not.toContain(
      `${AUTH_NEXT_COOKIE_NAME}=;`,
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('expires an exchanged session when the local PKCE marker is not recovery', async () => {
    mocks.exchangeCodeForSession.mockImplementationOnce(async () => {
      mocks.setAll?.([
        {
          name: 'sb-local-auth-token',
          value: 'session-value',
          options: { httpOnly: true, path: '/', sameSite: 'lax' },
        },
      ], {});
      return { data: { redirectType: 'signup' }, error: null };
    });

    const response = await GET(request(
      '/auth/recovery/callback?code=not-recovery-code',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=browser_mismatch&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.headers.get('set-cookie')).not.toContain('session-value');
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('expires an exchanged session when the current user cannot be revalidated', async () => {
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
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'session_not_found', message: 'private session detail' },
    });

    const response = await GET(request(
      '/auth/recovery/callback?code=recovery-code',
      signedRecoveryCookie(),
    ));

    expect(locationPath(response)).toBe(
      '/login?mode=reset&reset_error=session_not_found&next=%2Fcommunity%3Fsort%3Dhot',
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.headers.get('set-cookie')).not.toContain('session-value');
    expect(response.headers.get('set-cookie')).toContain('sb-local-auth-token=;');
    expect(response.headers.get('set-cookie') ?? '').not.toContain(
      `${AUTH_NEXT_COOKIE_NAME}=;`,
    );
    expect(response.headers.get('location')).not.toContain('private');
  });
});
