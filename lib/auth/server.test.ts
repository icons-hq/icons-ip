import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedPasswordRecoveryProofValue } from './recovery.server';
import { getCurrentAuthState, getPasswordUpdateState } from './server';

const SECRET = 'test-password-update-state-secret-with-entropy';
const ORIGINAL_SECRET = process.env.AUTH_SIGNUP_RESEND_SECRET;

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  proofCookie: undefined as string | undefined,
  profile: null as Record<string, unknown> | null,
  select: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser, getClaims: mocks.getClaims },
    from: () => {
      const query = {
        select: mocks.select,
        eq: () => query,
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
      };
      mocks.select.mockImplementation(() => query);
      return query;
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (
      name === 'icons_auth_recovery_proof' && mocks.proofCookie !== undefined
        ? { name, value: mocks.proofCookie }
        : undefined
    ),
  }),
}));

describe('getCurrentAuthState', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.select.mockReset();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'staff@icons.gg' } },
      error: null,
    });
    mocks.profile = {
      email: 'staff@icons.gg',
      nickname: 'staff',
      birth_date: '2000-01-01',
      avatar_path: null,
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      role: 'staff',
      suspended_at: '2026-07-17T00:00:00.000Z',
    };
  });

  it('loads suspension state and never treats suspended staff as staff', async () => {
    const state = await getCurrentAuthState();

    expect(mocks.select).toHaveBeenCalledWith(
      'email,nickname,birth_date,avatar_path,consents,onboarded_at,role,suspended_at',
    );
    expect(state.profile?.suspended_at).toBe('2026-07-17T00:00:00.000Z');
    expect(state.isStaff).toBe(false);
  });
});

describe('getPasswordUpdateState', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = SECRET;
    mocks.getUser.mockReset();
    mocks.getClaims.mockReset();
    mocks.proofCookie = signedPasswordRecoveryProofValue(
      { sessionId: 'recovery-session-1', userId: 'user-1' },
      Date.now(),
      SECRET,
    );
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-1', session_id: 'recovery-session-1' } },
      error: null,
    });
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SECRET;
  });

  function signedInAs(identities: Array<{ provider: string }>) {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg', identities } },
      error: null,
    });
  }

  it('allows an email account whose session passed the recovery callback', async () => {
    signedInAs([{ provider: 'email' }]);

    await expect(getPasswordUpdateState()).resolves.toEqual({
      access: 'allowed',
      user: { id: 'user-1', email: 'fan@icons.gg' },
    });
  });

  it('asks for a reset mail when the session has no recovery proof', async () => {
    signedInAs([{ provider: 'email' }]);
    mocks.proofCookie = undefined;

    await expect(getPasswordUpdateState()).resolves.toMatchObject({ access: 'recovery_required' });
  });

  it('refuses a social-only account even with a recovery proof', async () => {
    signedInAs([{ provider: 'kakao' }]);

    await expect(getPasswordUpdateState()).resolves.toMatchObject({ access: 'no_email_identity' });
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it('returns no user when the session cannot be revalidated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'session_not_found' } });

    await expect(getPasswordUpdateState()).resolves.toEqual({ access: 'recovery_required', user: null });
  });
});
