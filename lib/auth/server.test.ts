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
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser, getClaims: mocks.getClaims },
    rpc: mocks.rpc,
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

/* 2026-11-11 사용자 결정 '옮기고 재인증 요구' — 휴대폰 번호 인증 스위치가 켜졌을 때만, 번호를 다른 계정에 옮겨 간 회원을
   다시 인증할 때까지 온보딩 미완료로 본다. 스위치가 꺼져 있으면 DB를 읽지 않는다. */
describe('getCurrentAuthState phone re-verification gate', () => {
  const PHONE_ENV = {
    ICONS_PHONE_VERIFICATION_ENABLED: 'true',
    ICONS_PHONE_VERIFICATION_SECRET: 'phone-verification-test-secret-0123456789',
    ICONS_SMS_PROVIDER: 'console',
  } as const;
  const original = Object.fromEntries(Object.keys(PHONE_ENV).map((key) => [key, process.env[key]]));

  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.select.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg' } }, error: null });
    mocks.profile = {
      email: 'fan@icons.gg', nickname: 'fan', birth_date: '2000-01-01', avatar_path: null,
      consents: { terms: true, privacy: true }, onboarded_at: '2026-07-01T00:00:00.000Z', role: 'user', suspended_at: null,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('does not read the phone state while the switch is off', async () => {
    for (const key of Object.keys(PHONE_ENV)) delete process.env[key];

    const state = await getCurrentAuthState();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(state.profile).toEqual(mocks.profile);
  });

  it('marks a member whose number moved to another account as needing re-verification', async () => {
    Object.assign(process.env, PHONE_ENV);
    mocks.rpc.mockResolvedValue({ data: { verified: false, phoneE164: null, verifiedAt: null, reverificationRequired: true }, error: null });

    const state = await getCurrentAuthState();
    expect(mocks.rpc).toHaveBeenCalledWith('my_member_phone_verification');
    expect(state.profile).toMatchObject({ phone_reverification_required: true });
  });

  it('leaves verified members and members who never verified unchanged', async () => {
    Object.assign(process.env, PHONE_ENV);
    mocks.rpc.mockResolvedValue({ data: { verified: true, phoneE164: '+821012345678', verifiedAt: '2026-11-11T00:00:00Z', reverificationRequired: false }, error: null });
    expect((await getCurrentAuthState()).profile).toEqual(mocks.profile);

    mocks.rpc.mockResolvedValue({ data: { verified: false, phoneE164: null, verifiedAt: null, reverificationRequired: false }, error: null });
    expect((await getCurrentAuthState()).profile).toEqual(mocks.profile);
  });
});
