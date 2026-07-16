import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from './actions';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  getSupabaseConfig: vi.fn(),
  identity: vi.fn(),
  profilePayloads: [] as Record<string, unknown>[],
  profileResults: [] as { data: { id: string } | null; error: { message: string } | null }[],
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/profile.server', () => ({ updateProfileIdentity: mocks.identity }));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/ip-follow', async () => await import('../../lib/ip-follow'));
vi.mock('@/lib/profile', async () => await import('../../lib/profile'));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: mocks.getSupabaseConfig }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const USER_ID = '00000000-0000-4000-8000-000000001201';
const IP_ONE = '00000000-0000-4000-8000-000000000101';
const IP_TWO = '00000000-0000-4000-8000-000000000102';
const familyEmoji = '👨‍👩‍👧‍👦';

function onboardingForm(nickname: string, options: {
  recommended?: string[];
  selected?: string[];
} = {}) {
  const formData = new FormData();
  formData.set('nickname', nickname);
  formData.set('birthDate', '2000-01-01');
  formData.set('terms', 'on');
  formData.set('privacy', 'on');
  formData.set('marketing', 'on');
  formData.set('next', '/community');
  for (const id of options.recommended ?? []) formData.append('recommendedIpIds', id);
  for (const id of options.selected ?? []) formData.append('followIpIds', id);
  return formData;
}

function profileQuery() {
  return {
    update: (payload: Record<string, unknown>) => {
      mocks.profilePayloads.push(payload);
      return {
        eq: () => ({
          select: () => ({
            single: async () => mocks.profileResults.shift() ?? {
              data: { id: USER_ID },
              error: null,
            },
          }),
        }),
      };
    },
  };
}

function ipQuery(rows: { id: string }[]) {
  return {
    select: () => ({ in: async () => ({ data: rows, error: null }) }),
  };
}

function followsQuery(rows: { ip_id: string }[]) {
  return {
    select: () => ({
      eq: () => ({ in: async () => ({ data: rows, error: null }) }),
    }),
  };
}

beforeEach(() => {
  mocks.authGetUser.mockReset();
  mocks.createClient.mockReset();
  mocks.from.mockReset();
  mocks.getSupabaseConfig.mockReset();
  mocks.identity.mockReset();
  mocks.profilePayloads = [];
  mocks.profileResults = [];
  mocks.revalidatePath.mockReset();
  mocks.rpc.mockReset();

  mocks.getSupabaseConfig.mockReturnValue({ isConfigured: true });
  mocks.authGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: 'fan@icons.gg' } },
    error: null,
  });
  mocks.identity.mockResolvedValue({ ok: true, previousAvatarPath: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'profiles') return profileQuery();
    if (table === 'ips') return ipQuery([]);
    if (table === 'ip_follows') return followsQuery([]);
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.authGetUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
});

describe('completeOnboardingAction profile identity', () => {
  it('accepts 30 family graphemes and saves nickname only through the identity helper', async () => {
    const nickname = familyEmoji.repeat(30);

    await expect(completeOnboardingAction({}, onboardingForm(nickname))).rejects.toThrow(
      'NEXT_REDIRECT:/community',
    );

    expect(mocks.identity).toHaveBeenCalledWith({
      userId: USER_ID,
      nickname,
      avatarPath: null,
      replaceAvatar: false,
    });
    expect(mocks.profilePayloads).toEqual([
      {
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true, marketing: true },
      },
      { onboarded_at: expect.any(String) },
    ]);
    expect(JSON.stringify(mocks.profilePayloads)).not.toContain('nickname');
  });

  it('rejects 31 graphemes before config, authentication, or writes', async () => {
    await expect(
      completeOnboardingAction({}, onboardingForm(familyEmoji.repeat(31))),
    ).resolves.toEqual({ errors: { nickname: '닉네임은 30자 이하로 입력해주세요.' } });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('rejects a raw 513-code-unit nickname before config, authentication, or writes', async () => {
    await expect(
      completeOnboardingAction({}, onboardingForm('a'.repeat(513))),
    ).resolves.toEqual({ errors: { nickname: '닉네임은 30자 이하로 입력해주세요.' } });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('maps identity uniqueness failures to the existing nickname message', async () => {
    mocks.identity.mockResolvedValue({ ok: false, errorCode: '23505' });

    await expect(
      completeOnboardingAction({}, onboardingForm('taken')),
    ).resolves.toEqual({ errors: { nickname: '이미 사용 중인 닉네임입니다.' } });

    expect(mocks.profilePayloads).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the existing recommended follow, consent, and completion flow', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profileQuery();
      if (table === 'ips') return ipQuery([{ id: IP_ONE }, { id: IP_TWO }]);
      if (table === 'ip_follows') return followsQuery([{ ip_id: IP_ONE }]);
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(completeOnboardingAction({}, onboardingForm('fan', {
      recommended: [IP_ONE, IP_TWO],
      selected: [IP_TWO],
    }))).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc.mock.calls).toEqual([
      ['follow_ip', { target_ip_id: IP_TWO }],
      ['unfollow_ip', { target_ip_id: IP_ONE }],
    ]);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/ip/${IP_TWO}`,
      `/ip/${IP_ONE}`,
      '/',
      '/ip',
    ]);
  });
});
