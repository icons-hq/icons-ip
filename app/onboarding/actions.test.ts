import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from './actions';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  getSupabaseConfig: vi.fn(),
  identity: vi.fn(),
  ipArchivedFilter: vi.fn(),
  profilePayloads: [] as Record<string, unknown>[],
  profileResults: [] as { data: { id: string } | null; error: { message: string } | null }[],
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/profile.server', () => ({ updateProfileIdentity: mocks.identity }));
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
    select: () => ({
      is: (column: string, value: unknown) => {
        mocks.ipArchivedFilter(column, value);
        return { in: async () => ({ data: rows, error: null }) };
      },
    }),
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
  mocks.ipArchivedFilter.mockReset();
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
  it('normalizes grouped year, month, and day fields to the stored ISO date', async () => {
    const formData = onboardingForm('fan');
    formData.delete('birthDate');
    formData.set('birthYear', '2000');
    formData.set('birthMonth', '1');
    formData.set('birthDay', '31');

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow(
      'NEXT_REDIRECT:/community',
    );

    expect(mocks.profilePayloads[0]).toMatchObject({ birth_date: '2000-01-31' });
  });

  it('rejects a date that is not a real calendar date before any writes', async () => {
    const formData = onboardingForm('fan');
    formData.set('birthDate', '2000-02-31');

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '실제로 존재하는 생년월일을 입력해주세요.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('identifies incomplete grouped birth-date fields before any writes', async () => {
    const formData = onboardingForm('fan');
    formData.delete('birthDate');
    formData.set('birthYear', '2000');
    formData.set('birthMonth', '1');

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '생년월일에 연도, 월, 일을 모두 입력해주세요.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('identifies a grouped future birth date before any writes', async () => {
    const formData = onboardingForm('fan');
    formData.delete('birthDate');
    formData.set('birthYear', '2999');
    formData.set('birthMonth', '1');
    formData.set('birthDay', '1');

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '생년월일은 오늘 또는 이전 날짜로 입력해주세요.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  /*
   * #188 · ADR-0009 — v1 가입 기준은 만 14세다. 고정 날짜를 박으면 스위트가 시간이
   * 지나면서 의미를 잃으므로, KST 오늘에서 상대로 만든다.
   */
  function birthDateForExactAge(age: number) {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const month = kst.getUTCMonth() + 1;
    /* 2월 29일에 돌리면 대상 연도에 그 날짜가 없을 수 있다 — 하루 당겨도 판정은 같은 쪽이다. */
    const day = month === 2 && kst.getUTCDate() === 29 ? 28 : kst.getUTCDate();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${kst.getUTCFullYear() - age}-${pad(month)}-${pad(day)}`;
  }

  it('rejects an under-14 birth date before any writes', async () => {
    const formData = onboardingForm('fan');
    formData.set('birthDate', birthDateForExactAge(13));

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '만 14세 이상만 가입할 수 있습니다.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  /* 경계일은 거부가 아니라 허용 쪽이다 — 생일 당일에 가입할 수 있어야 한다. */
  it('accepts the exact fourteenth birthday', async () => {
    const formData = onboardingForm('fan');
    formData.set('birthDate', birthDateForExactAge(14));

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/community');
    expect(mocks.profilePayloads[0]?.birth_date).toBe(birthDateForExactAge(14));
  });

  /* DB 트리거가 앱 검증을 우회한 쓰기를 막았을 때, 이용자에게는 같은 문장이 보여야 한다. */
  it('maps the database age guard to the same field error', async () => {
    mocks.profileResults.push({ data: null, error: { message: 'minimum_age_required' } });

    const formData = onboardingForm('fan');

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '만 14세 이상만 가입할 수 있습니다.' },
    });
  });

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
    expect(mocks.ipArchivedFilter).toHaveBeenCalledWith('archived_at', null);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/ip/${IP_TWO}`,
      `/ip/${IP_ONE}`,
      '/',
      '/ip',
    ]);
  });
});
