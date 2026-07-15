import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateMarketingConsentAction, updateProfileAction } from './actions';
import type { OnboardingConsents } from '@/lib/auth/onboarding';
import type { CurrentAuthState } from '@/lib/auth/server';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  update: vi.fn(),
  eq: vi.fn(),
  updateResult: { data: { id: 'user-1' }, error: null } as {
    data: { id: string } | null;
    error: { code?: string; message: string } | null;
  },
  storageFrom: vi.fn(),
  upload: vi.fn(),
  uploadResult: { data: { path: 'user-1/profile/avatar.png' }, error: null } as {
    data: { path: string } | null;
    error: { message: string } | null;
  },
  list: vi.fn(),
  listResult: { data: [] as { name: string }[], error: null as { message: string } | null },
  remove: vi.fn(),
  removeResult: { data: [] as { name: string }[], error: null as { message: string } | null },
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/profile', async () => await import('../../lib/profile'));
vi.mock('@/lib/settings', async () => await import('../../lib/settings'));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`Unexpected table ${table}`);
      return { update: mocks.update };
    },
    storage: {
      from: mocks.storageFrom,
    },
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function onboardedAuth(consents: OnboardingConsents, avatarPath: string | null = null): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      avatar_path: avatarPath,
      consents,
      onboarded_at: '2026-06-23T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function marketingForm(marketing: boolean) {
  const formData = new FormData();
  if (marketing) formData.set('marketing', 'on');
  return formData;
}

function profileForm(nickname: string, avatar?: File) {
  const formData = new FormData();
  formData.set('nickname', nickname);
  if (avatar) formData.set('avatar', avatar);
  return formData;
}

const PROFILE_AVATAR_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROFILE_AVATAR_PATH = `user-1/profile/${PROFILE_AVATAR_UUID}.png`;

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(PROFILE_AVATAR_UUID);
  mocks.auth = onboardedAuth({ terms: true, privacy: true, marketing: false });
  mocks.updateResult = { data: { id: 'user-1' }, error: null };
  mocks.uploadResult = { data: { path: 'user-1/profile/avatar.png' }, error: null };
  mocks.listResult = { data: [], error: null };
  mocks.removeResult = { data: [], error: null };
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.storageFrom.mockReset();
  mocks.upload.mockReset();
  mocks.list.mockReset();
  mocks.remove.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.update.mockImplementation(() => ({ eq: mocks.eq }));
  mocks.eq.mockImplementation(() => ({
    select: () => ({
      single: async () => mocks.updateResult,
    }),
  }));
  mocks.storageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
    return {
      upload: mocks.upload,
      list: mocks.list,
      remove: mocks.remove,
    };
  });
  mocks.upload.mockImplementation(async () => mocks.uploadResult);
  mocks.list.mockImplementation(async () => mocks.listResult);
  mocks.remove.mockImplementation(async () => mocks.removeResult);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('updateProfileAction', () => {
  it('returns a disabled notice without writing when Supabase is not configured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

    await expect(updateProfileAction({}, profileForm('fan'))).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login with the settings path', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(updateProfileAction({}, profileForm('fan'))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('redirects users who have not completed onboarding to onboarding', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };

    await expect(updateProfileAction({}, profileForm('fan'))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns invalid profile fields before Storage or DB writes', async () => {
    const formData = profileForm(
      ' ',
      new File(['avatar'], 'avatar.svg', { type: 'image/svg+xml' }),
    );

    await expect(updateProfileAction({}, formData)).resolves.toEqual({
      errors: {
        nickname: '닉네임을 입력해주세요.',
        avatar: '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.',
      },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('trims and saves a nickname without replacing the current avatar', async () => {
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      'user-1/profile/current.webp',
    );

    await expect(updateProfileAction({}, profileForm('  new fan  '))).resolves.toEqual({
      message: '프로필을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({ nickname: 'new fan' });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/settings',
      '/',
      '/community',
      '/search',
    ]);
  });

  it('uploads a UUID-named avatar and removes only the safe previous avatar', async () => {
    const avatar = new File(['avatar'], 'client-name.png', { type: 'image/png' });
    const previousAvatarPath = 'user-1/profile/previous.webp';
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      previousAvatarPath,
    );
    mocks.listResult = {
      data: [
        { name: 'previous.webp' },
        { name: `${PROFILE_AVATAR_UUID}.png` },
        { name: 'unrelated-later.png' },
      ],
      error: null,
    };

    await expect(updateProfileAction({}, profileForm('fan', avatar))).resolves.toEqual({
      message: '프로필을 저장했어요.',
    });

    expect(mocks.storageFrom).toHaveBeenCalledWith('user-uploads');
    expect(mocks.upload).toHaveBeenCalledWith(PROFILE_AVATAR_PATH, avatar, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      nickname: 'fan',
      avatar_path: PROFILE_AVATAR_PATH,
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([previousAvatarPath]);
  });

  it('keeps a successful profile save successful when previous avatar cleanup rejects', async () => {
    const previousAvatarPath = 'user-1/profile/previous.webp';
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      previousAvatarPath,
    );
    mocks.remove.mockRejectedValueOnce(new Error('storage remove failed'));

    await expect(
      updateProfileAction(
        {},
        profileForm('fan', new File(['avatar'], 'avatar.png', { type: 'image/png' })),
      ),
    ).resolves.toEqual({ message: '프로필을 저장했어요.' });

    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([previousAvatarPath]);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/settings',
      '/',
      '/community',
      '/search',
    ]);
  });

  it('does not remove a previous avatar outside the authenticated user profile folder', async () => {
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      'user-2/profile/previous.webp',
    );

    await expect(
      updateProfileAction(
        {},
        profileForm('fan', new File(['avatar'], 'avatar.png', { type: 'image/png' })),
      ),
    ).resolves.toEqual({ message: '프로필을 저장했어요.' });

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('does not remove the avatar path when it matches the newly uploaded path', async () => {
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      PROFILE_AVATAR_PATH,
    );

    await expect(
      updateProfileAction(
        {},
        profileForm('fan', new File(['avatar'], 'avatar.png', { type: 'image/png' })),
      ),
    ).resolves.toEqual({ message: '프로필을 저장했어요.' });

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('returns an avatar error without updating the profile when upload fails', async () => {
    mocks.uploadResult = { data: null, error: { message: 'upload failed' } };

    await expect(
      updateProfileAction(
        {},
        profileForm('fan', new File(['avatar'], 'avatar.png', { type: 'image/png' })),
      ),
    ).resolves.toEqual({
      errors: { avatar: '아바타를 업로드하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('maps nickname uniqueness violations to the nickname field', async () => {
    mocks.updateResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    };

    await expect(updateProfileAction({}, profileForm('taken'))).resolves.toEqual({
      errors: { nickname: '이미 사용 중인 닉네임입니다.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('removes a newly uploaded avatar when the profile update fails', async () => {
    mocks.auth = onboardedAuth(
      { terms: true, privacy: true, marketing: false },
      'user-1/profile/previous.webp',
    );
    mocks.updateResult = { data: null, error: { message: 'db failed' } };

    await expect(
      updateProfileAction(
        {},
        profileForm('fan', new File(['avatar'], 'avatar.png', { type: 'image/png' })),
      ),
    ).resolves.toEqual({
      errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' },
    });

    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([PROFILE_AVATAR_PATH]);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateMarketingConsentAction', () => {
  it('returns a disabled notice without writing when Supabase is not configured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login with the settings path', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('redirects users who have not completed onboarding to onboarding', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('updates only the marketing key while preserving DB consents, then confirms', async () => {
    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: true },
    });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('turns marketing consent off when the checkbox is not submitted', async () => {
    mocks.auth = onboardedAuth({ terms: true, privacy: true, marketing: true });

    await expect(updateMarketingConsentAction({}, marketingForm(false))).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: false },
    });
  });

  it('ignores client attempts to tamper with required consents', async () => {
    const formData = marketingForm(true);
    formData.set('terms', 'off');
    formData.set('privacy', 'off');
    formData.set('consents', JSON.stringify({ terms: false, privacy: false, marketing: true }));

    await expect(updateMarketingConsentAction({}, formData)).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: true },
    });
  });

  it('returns a form error when the profile update fails', async () => {
    mocks.updateResult = { data: null, error: { message: 'boom' } };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: '설정을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
