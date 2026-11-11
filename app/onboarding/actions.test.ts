import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from './actions';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  getSupabaseConfig: vi.fn(),
  identity: vi.fn(),
  ipArchivedFilter: vi.fn(),
  ipPublishedFilter: vi.fn(),
  profileNickname: null as string | null,
  profileReadError: null as { message: string } | null,
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

/* 온보딩은 닉네임을 묻지 않는다(1014-004) — 폼에는 생년월일·약관·선택 항목만 있다. */
function onboardingForm(options: {
  recommended?: string[];
  selected?: string[];
} = {}) {
  const formData = new FormData();
  formData.set('birthDate', '2000-01-01');
  formData.set('terms', 'on');
  formData.set('privacy', 'on');
  formData.set('marketingEmail', 'on');
  formData.set('next', '/community');
  for (const id of options.recommended ?? []) formData.append('recommendedIpIds', id);
  for (const id of options.selected ?? []) formData.append('followIpIds', id);
  return formData;
}

function profileQuery() {
  return {
    select: (columns: string) => ({
      eq: () => ({
        maybeSingle: async () => {
          expect(columns).toBe('nickname');
          return mocks.profileReadError
            ? { data: null, error: mocks.profileReadError }
            : { data: { nickname: mocks.profileNickname }, error: null };
        },
      }),
    }),
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
        return {
          not: (column: string, operator: string, value: unknown) => {
            mocks.ipPublishedFilter(column, operator, value);
            return { in: async () => ({ data: rows, error: null }) };
          },
          in: async () => ({ data: rows, error: null }),
        };
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
  mocks.ipPublishedFilter.mockReset();
  mocks.profileNickname = null;
  mocks.profileReadError = null;
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
    const formData = onboardingForm();
    formData.delete('birthDate');
    formData.set('birthYear', '2000');
    formData.set('birthMonth', '1');
    formData.set('birthDay', '31');

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity',
    );

    expect(mocks.profilePayloads[0]).toMatchObject({ birth_date: '2000-01-31' });
  });

  it('rejects a date that is not a real calendar date before any writes', async () => {
    const formData = onboardingForm();
    formData.set('birthDate', '2000-02-31');

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '실제로 존재하는 생년월일을 입력해주세요.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('identifies incomplete grouped birth-date fields before any writes', async () => {
    const formData = onboardingForm();
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
    const formData = onboardingForm();
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
    const formData = onboardingForm();
    formData.set('birthDate', birthDateForExactAge(13));

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '만 14세 이상만 가입할 수 있습니다.' },
    });

    expect(mocks.getSupabaseConfig).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  /* 경계일은 거부가 아니라 허용 쪽이다 — 생일 당일에 가입할 수 있어야 한다. */
  it('accepts the exact fourteenth birthday', async () => {
    const formData = onboardingForm();
    formData.set('birthDate', birthDateForExactAge(14));

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');
    expect(mocks.profilePayloads[0]?.birth_date).toBe(birthDateForExactAge(14));
  });

  /* DB 트리거가 앱 검증을 우회한 쓰기를 막았을 때, 이용자에게는 같은 문장이 보여야 한다. */
  it('maps the database age guard to the same field error', async () => {
    mocks.profileResults.push({ data: null, error: { message: 'minimum_age_required' } });

    const formData = onboardingForm();

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({
      errors: { birthDate: '만 14세 이상만 가입할 수 있습니다.' },
    });
  });

  /* 1014-004 — 닉네임은 묻지 않고 자동으로 만든다. 저장은 기존 프로필 저장 경로(identity helper)만 쓴다. */
  it('generates an automatic nickname for an account without one and saves it only through the identity helper', async () => {
    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity',
    );

    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.identity).toHaveBeenCalledWith({
      userId: USER_ID,
      nickname: expect.stringMatching(/^fan_[a-z0-9]{8}$/),
      avatarPath: null,
      replaceAvatar: false,
    });
    expect(mocks.profilePayloads).toEqual([
      {
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true },
      },
      { onboarded_at: expect.any(String) },
    ]);
    expect(JSON.stringify(mocks.profilePayloads)).not.toContain('nickname');
  });

  it('keeps an existing nickname and ignores any submitted nickname field', async () => {
    mocks.profileNickname = '아이콘즈 팬';
    const formData = onboardingForm();
    formData.set('nickname', familyEmoji.repeat(31));

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity',
    );

    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.profilePayloads.at(-1)).toEqual({ onboarded_at: expect.any(String) });
  });

  it('retries a colliding automatic nickname with a new value', async () => {
    mocks.identity
      .mockResolvedValueOnce({ ok: false, errorCode: '23505' })
      .mockResolvedValueOnce({ ok: true, previousAvatarPath: null });

    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity',
    );

    expect(mocks.identity).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.identity.mock.calls.map(([input]) => (input as { nickname: string }).nickname);
    expect(first).toMatch(/^fan_[a-z0-9]{8}$/);
    expect(second).toMatch(/^fan_[a-z0-9]{8}$/);
  });

  it('stops before any other write when an automatic nickname cannot be saved', async () => {
    mocks.identity.mockResolvedValue({ ok: false, errorCode: '23505' });

    await expect(completeOnboardingAction({}, onboardingForm())).resolves.toEqual({
      errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.identity).toHaveBeenCalledTimes(5);
    expect(mocks.profilePayloads).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.identity.mockReset();
    mocks.identity.mockResolvedValue({ ok: false, errorCode: 'P0002' });
    await expect(completeOnboardingAction({}, onboardingForm())).resolves.toEqual({
      errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.identity).toHaveBeenCalledOnce();
  });

  it('does not guess when the current nickname cannot be read', async () => {
    mocks.profileReadError = { message: 'unavailable' };

    await expect(completeOnboardingAction({}, onboardingForm())).resolves.toEqual({
      errors: { form: '프로필을 확인하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.profilePayloads).toEqual([]);
  });

  /* 10/14 회의 S2 · D5 — 관심 IP는 선택이다. 건너뛰면 화면이 추천 목록 입력을 보내지 않고,
     서버는 팔로우를 바꾸지 않은 채 온보딩을 끝낸다(이미 팔로우한 IP를 풀지 않는다). */
  it('completes onboarding without IP picks and leaves existing follows untouched', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profileQuery();
      if (table === 'ips') return ipQuery([{ id: IP_ONE }]);
      if (table === 'ip_follows') return followsQuery([{ ip_id: IP_ONE }]);
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');

    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'follow_ip' || name === 'unfollow_ip')).toEqual([]);
    expect(mocks.profilePayloads.at(-1)).toEqual({ onboarded_at: expect.any(String) });
  });

  it('keeps the existing recommended follow, consent, and completion flow', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profileQuery();
      if (table === 'ips') return ipQuery([{ id: IP_ONE }, { id: IP_TWO }]);
      if (table === 'ip_follows') return followsQuery([{ ip_id: IP_ONE }]);
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(completeOnboardingAction({}, onboardingForm({
      recommended: [IP_ONE, IP_TWO],
      selected: [IP_TWO],
    }))).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');

    expect(mocks.rpc.mock.calls).toEqual([
      ['set_my_marketing_consents', { p_email: true, p_sms: false, p_notice_version: 'marketing-channels-v1', p_source: 'onboarding' }],
      ['follow_ip', { target_ip_id: IP_TWO }],
      ['unfollow_ip', { target_ip_id: IP_ONE }],
    ]);
    expect(mocks.ipArchivedFilter).toHaveBeenCalledWith('archived_at', null);
    expect(mocks.ipPublishedFilter).toHaveBeenCalledWith('published_at', 'is', null);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/ip/${IP_TWO}`,
      `/ip/${IP_ONE}`,
      '/',
      '/ip',
    ]);
  });
});

/* 10/14 회의 S4·S5 — 수단별 마케팅 수신 동의와 선택 성별. */
describe('completeOnboardingAction optional consents', () => {
  const DEMOGRAPHIC_STATE = {
    actorId: USER_ID, sessionId: '00000000-0000-4000-9000-000000001201', revision: 0, choice: 'unset', gender: null,
    noticeVersion: 'customer-demographics-v1', acceptedAt: null,
  };

  it('records email and SMS choices separately and does not write the derived marketing flag directly', async () => {
    const formData = onboardingForm();
    formData.delete('marketingEmail');
    formData.set('marketingSms', 'on');

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');

    expect(mocks.rpc).toHaveBeenCalledWith('set_my_marketing_consents', {
      p_email: false, p_sms: true, p_notice_version: 'marketing-channels-v1', p_source: 'onboarding',
    });
    expect(JSON.stringify(mocks.profilePayloads)).not.toContain('marketing');
  });

  it('stops before completion when the channel consent cannot be recorded', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'set_my_marketing_consents'
      ? { data: null, error: { message: 'unavailable' } } : { data: null, error: null });

    await expect(completeOnboardingAction({}, onboardingForm())).resolves.toEqual({
      errors: { form: '마케팅 정보 수신 동의를 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.profilePayloads.some((payload) => 'onboarded_at' in payload)).toBe(false);
  });

  it.each([
    [{ gender: 'female' }, '성별을 저장하려면 수집·이용에 동의해주세요.'],
    [{ genderConsent: 'on' }, '동의하려면 성별을 선택해주세요.'],
    [{ gender: 'unknown', genderConsent: 'on' }, '성별을 다시 선택해주세요.'],
  ])('rejects an incomplete gender choice %o before any writes', async (fields, message) => {
    const formData = onboardingForm();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);

    await expect(completeOnboardingAction({}, formData)).resolves.toEqual({ errors: { gender: message } });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('saves a consented gender through the existing optional consent path right after completion', async () => {
    const order: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'profiles') return table === 'ips' ? ipQuery([]) : followsQuery([]);
      const query = profileQuery();
      return { ...query, update: (payload: Record<string, unknown>) => { order.push(Object.keys(payload).join(',')); return query.update(payload); } };
    });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      order.push(name);
      if (name === 'customer_demographic_state') return { data: DEMOGRAPHIC_STATE, error: null };
      if (name === 'set_customer_demographic_consent') return { data: { ...DEMOGRAPHIC_STATE, revision: 1, choice: 'accepted', gender: args.p_gender, acceptedAt: '2026-10-27T00:00:00.000Z' }, error: null };
      return { data: null, error: null };
    });
    const formData = onboardingForm();
    formData.set('gender', 'female');
    formData.set('genderConsent', 'on');

    await expect(completeOnboardingAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');

    expect(mocks.rpc).toHaveBeenCalledWith('set_customer_demographic_consent', {
      p_choice: 'accepted', p_gender: 'female', p_expected_revision: 0, p_expected_actor: USER_ID,
      p_expected_session: DEMOGRAPHIC_STATE.sessionId, p_notice_version: 'customer-demographics-v1',
    });
    expect(order.indexOf('onboarded_at')).toBeLessThan(order.indexOf('customer_demographic_state'));
  });

  it('does not save gender without a choice and does not undo completion when the optional save fails', async () => {
    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('customer_demographic_state');

    mocks.rpc.mockImplementation(async (name: string) => name === 'customer_demographic_state'
      ? { data: null, error: { message: 'unavailable' } } : { data: null, error: null });
    const formData = onboardingForm();
    formData.set('gender', 'male');
    formData.set('genderConsent', 'on');
    await expect(completeOnboardingAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');
  });
});


/* 1014-005·006 — 휴대폰 번호 인증은 스위치가 켜졌을 때만 온보딩 완료 조건이다. */
describe('completeOnboardingAction phone verification switch', () => {
  const PHONE_ENV = {
    ICONS_PHONE_VERIFICATION_ENABLED: 'true',
    ICONS_PHONE_VERIFICATION_SECRET: 'phone-verification-test-secret-0123456789',
    ICONS_SMS_PROVIDER: 'console',
  } as const;
  const original = Object.fromEntries(Object.keys(PHONE_ENV).map((key) => [key, process.env[key]]));

  function setPhoneEnv(on: boolean) {
    for (const [key, value] of Object.entries(PHONE_ENV)) {
      if (on) process.env[key] = value;
      else delete process.env[key];
    }
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('does not read phone verification at all while the switch is off', async () => {
    setPhoneEnv(false);

    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('my_member_phone_verification');
  });

  it('stops before any write when the switch is on and the member has not verified a phone', async () => {
    setPhoneEnv(true);
    mocks.rpc.mockImplementation(async (name: string) => name === 'my_member_phone_verification'
      ? { data: { verified: false, phoneE164: null, verifiedAt: null }, error: null }
      : { data: null, error: null });

    await expect(completeOnboardingAction({}, onboardingForm())).resolves.toEqual({
      errors: { form: '휴대폰 번호 인증을 먼저 마쳐주세요.' },
    });
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.profilePayloads).toEqual([]);
  });

  it('completes onboarding when the switch is on and the phone is verified', async () => {
    setPhoneEnv(true);
    mocks.rpc.mockImplementation(async (name: string) => name === 'my_member_phone_verification'
      ? { data: { verified: true, phoneE164: '+821012345678', verifiedAt: '2026-11-11T00:00:00Z' }, error: null }
      : { data: null, error: null });

    await expect(completeOnboardingAction({}, onboardingForm())).rejects.toThrow('NEXT_REDIRECT:/onboarding/address?next=%2Fcommunity');
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe('my_member_phone_verification');
  });
});
