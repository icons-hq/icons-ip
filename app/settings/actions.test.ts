import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareProfileAvatarUploadAction,
  updateMarketingConsentAction,
  updateProfileAction,
} from './actions';
import type { OnboardingConsents } from '@/lib/auth/onboarding';
import type { CurrentAuthState } from '@/lib/auth/server';
import { MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_ERROR } from '@/lib/profile';

const mocks = vi.hoisted(() => ({
  cleanupProfileAvatar: vi.fn(),
  createClient: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  dbEq: vi.fn(),
  dbUpdate: vi.fn(),
  download: vi.fn(),
  getCurrentAuthState: vi.fn(),
  info: vi.fn(),
  list: vi.fn(),
  revalidatePath: vi.fn(),
  storageFrom: vi.fn(),
  updateProfileIdentity: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: mocks.getCurrentAuthState,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/profile', async () => await import('../../lib/profile'));
vi.mock('@/lib/profile.server', () => ({
  cleanupProfileAvatar: mocks.cleanupProfileAvatar,
  updateProfileIdentity: mocks.updateProfileIdentity,
}));
vi.mock('@/lib/settings', async () => await import('../../lib/settings'));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const USER_ID = '00000000-0000-4000-8000-000000001201';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000001202';
const AVATAR_UUID = '123e4567-e89b-42d3-a456-426614174000';
const AVATAR_PATH = `${USER_ID}/profile/${AVATAR_UUID}.png`;
const PREVIOUS_AVATAR_PATH = `${USER_ID}/profile/11111111-1111-4111-8111-111111111111.jpg`;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

function onboardedAuth(
  consents: OnboardingConsents,
  avatarPath: string | null = PREVIOUS_AVATAR_PATH,
): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@icons.test' },
    profile: {
      email: 'fan@icons.test',
      nickname: 'fan',
      birth_date: '2000-01-01',
      avatar_path: avatarPath,
      consents,
      onboarded_at: '2026-06-23T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function profileForm(nickname: string, avatarPath?: string | File) {
  const formData = new FormData();
  formData.set('nickname', nickname);
  if (avatarPath !== undefined) formData.set('avatarPath', avatarPath);
  return formData;
}

function marketingForm(marketing: boolean) {
  const formData = new FormData();
  if (marketing) formData.set('marketing', 'on');
  return formData;
}

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(AVATAR_UUID);
  mocks.cleanupProfileAvatar.mockReset();
  mocks.createClient.mockReset();
  mocks.createSignedUploadUrl.mockReset();
  mocks.dbEq.mockReset();
  mocks.dbUpdate.mockReset();
  mocks.download.mockReset();
  mocks.getCurrentAuthState.mockReset();
  mocks.info.mockReset();
  mocks.list.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.storageFrom.mockReset();
  mocks.updateProfileIdentity.mockReset();
  mocks.upload.mockReset();

  mocks.getCurrentAuthState.mockResolvedValue(
    onboardedAuth({ terms: true, privacy: true, marketing: false }),
  );
  mocks.cleanupProfileAvatar.mockResolvedValue(undefined);
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { path: AVATAR_PATH, token: 'signed-upload-token' },
    error: null,
  });
  mocks.info.mockResolvedValue({
    data: { contentType: 'image/png', size: PNG_BYTES.byteLength },
    error: null,
  });
  mocks.download.mockResolvedValue({
    data: new Blob([PNG_BYTES], { type: 'image/png' }),
    error: null,
  });
  mocks.updateProfileIdentity.mockResolvedValue({
    ok: true,
    previousAvatarPath: PREVIOUS_AVATAR_PATH,
  });
  mocks.dbEq.mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: USER_ID }, error: null }),
    }),
  });
  mocks.dbUpdate.mockReturnValue({ eq: mocks.dbEq });
  mocks.storageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
    return {
      createSignedUploadUrl: mocks.createSignedUploadUrl,
      download: mocks.download,
      info: mocks.info,
      list: mocks.list,
      upload: mocks.upload,
    };
  });
  mocks.createClient.mockResolvedValue({
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`Unexpected table ${table}`);
      return { update: mocks.dbUpdate };
    },
    storage: { from: mocks.storageFrom },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prepareProfileAvatarUploadAction', () => {
  it('validates nickname and file metadata before reading auth', async () => {
    await expect(prepareProfileAvatarUploadAction({
      nickname: ' ',
      mimeType: 'image/svg+xml',
      size: 0,
    })).resolves.toEqual({
      ok: false,
      errors: {
        avatar: PROFILE_IMAGE_ERROR,
        nickname: '닉네임을 입력해주세요.',
      },
    });

    expect(mocks.getCurrentAuthState).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a 5MiB+1 request before auth or Storage', async () => {
    await expect(prepareProfileAvatarUploadAction({
      nickname: 'fan',
      mimeType: 'image/png',
      size: MAX_PROFILE_IMAGE_BYTES + 1,
    })).resolves.toEqual({
      ok: false,
      errors: { avatar: PROFILE_IMAGE_ERROR },
    });

    expect(mocks.getCurrentAuthState).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('returns the existing config gate after pure validation', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: false,
      user: null,
      profile: null,
      isStaff: false,
    });

    await expect(prepareProfileAvatarUploadAction({
      nickname: 'fan',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })).resolves.toEqual({
      ok: false,
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
  });

  it('retains the exact login redirect', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    });

    await expect(prepareProfileAvatarUploadAction({
      nickname: 'fan',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fsettings');
  });

  it('retains the exact onboarding redirect', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: true,
      user: { id: USER_ID, email: 'fan@icons.test' },
      profile: null,
      isStaff: false,
    });

    await expect(prepareProfileAvatarUploadAction({
      nickname: 'fan',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fsettings');
  });

  it('creates a non-upsert signed grant for a server UUID path without file bytes', async () => {
    await expect(prepareProfileAvatarUploadAction({
      nickname: '  새 닉네임  ',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })).resolves.toEqual({
      ok: true,
      path: AVATAR_PATH,
      token: 'signed-upload-token',
    });

    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(AVATAR_PATH, { upsert: false });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved error', () => mocks.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: 'private signed grant error' },
    })],
    ['rejection', () => mocks.createSignedUploadUrl.mockRejectedValue(
      new Error('private signed grant rejection'),
    )],
  ])('maps a signed grant %s to a safe avatar error', async (_label, arrange) => {
    arrange();

    await expect(prepareProfileAvatarUploadAction({
      nickname: 'fan',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })).resolves.toEqual({
      ok: false,
      errors: { avatar: '아바타 업로드를 준비하지 못했습니다. 다시 시도해주세요.' },
    });
  });
});

describe('updateProfileAction', () => {
  it('validates nickname and rejects file-valued candidate input before auth', async () => {
    await expect(updateProfileAction(
      {},
      profileForm(' ', new File(['not-a-path'], 'avatar.png', { type: 'image/png' })),
    )).resolves.toEqual({
      errors: {
        avatar: '아바타 경로를 확인할 수 없습니다. 다시 업로드해주세요.',
        nickname: '닉네임을 입력해주세요.',
      },
    });

    expect(mocks.getCurrentAuthState).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('returns the config gate without profile writes', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: false,
      user: null,
      profile: null,
      isStaff: false,
    });

    await expect(updateProfileAction({}, profileForm('fan'))).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
  });

  it('retains the exact login redirect', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    });

    await expect(updateProfileAction({}, profileForm('fan'))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings',
    );
  });

  it('retains the exact onboarding redirect', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: true,
      user: { id: USER_ID, email: 'fan@icons.test' },
      profile: null,
      isStaff: false,
    });

    await expect(updateProfileAction({}, profileForm('fan'))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fsettings',
    );
  });

  it.each([
    `${OTHER_USER_ID}/profile/${AVATAR_UUID}.png`,
    `${USER_ID}/profile/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png`,
    `${USER_ID}/community/${AVATAR_UUID}.png`,
  ])('rejects a non-contract candidate before Storage reads: %s', async (candidate) => {
    await expect(updateProfileAction({}, profileForm('fan', candidate))).resolves.toEqual({
      errors: { avatar: '아바타 경로를 확인할 수 없습니다. 다시 업로드해주세요.' },
    });

    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.cleanupProfileAvatar).not.toHaveBeenCalled();
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
  });

  it('rejects the current avatar candidate without reading or deleting it', async () => {
    mocks.getCurrentAuthState.mockResolvedValue(
      onboardedAuth({ terms: true, privacy: true, marketing: false }, AVATAR_PATH),
    );

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { avatar: '현재 아바타와 다른 이미지를 선택해주세요.' },
    });

    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.cleanupProfileAvatar).not.toHaveBeenCalled();
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['zero size', { contentType: 'image/png', size: 0 }],
    ['fractional size', { contentType: 'image/png', size: 8.5 }],
    ['oversized', { contentType: 'image/png', size: MAX_PROFILE_IMAGE_BYTES + 1 }],
    ['MIME mismatch', { contentType: 'image/jpeg', size: PNG_BYTES.byteLength }],
  ])('rejects invalid Storage info: %s', async (_label, data) => {
    mocks.info.mockResolvedValue({ data, error: null });

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { avatar: '아바타 파일을 확인하지 못했습니다. 다시 업로드해주세요.' },
    });

    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    });
  });

  it.each([
    ['resolved info error', () => mocks.info.mockResolvedValue({
      data: null,
      error: { message: 'private info error' },
    })],
    ['info rejection', () => mocks.info.mockRejectedValue(new Error('private info rejection'))],
  ])('cleans the candidate after a %s', async (_label, arrange) => {
    arrange();

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { avatar: '아바타 파일을 확인하지 못했습니다. 다시 업로드해주세요.' },
    });
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    });
  });

  it.each([
    ['resolved download error', () => mocks.download.mockResolvedValue({
      data: null,
      error: { message: 'private download error' },
    })],
    ['download rejection', () => mocks.download.mockRejectedValue(
      new Error('private download rejection'),
    )],
    ['magic mismatch', () => mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([0x00, 0x01, 0x02])], { type: 'image/png' }),
      error: null,
    })],
  ])('cleans the candidate after a %s', async (_label, arrange) => {
    arrange();

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { avatar: '아바타 파일을 확인하지 못했습니다. 다시 업로드해주세요.' },
    });
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    });
  });

  it('updates a nickname without Storage reads or avatar replacement', async () => {
    mocks.updateProfileIdentity.mockResolvedValue({ ok: true, previousAvatarPath: null });

    await expect(updateProfileAction({}, profileForm('  새 닉네임  '))).resolves.toEqual({
      message: '프로필을 저장했어요.',
    });

    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.updateProfileIdentity).toHaveBeenCalledWith({
      userId: USER_ID,
      nickname: '새 닉네임',
      avatarPath: null,
      replaceAvatar: false,
    });
    expect(mocks.cleanupProfileAvatar).not.toHaveBeenCalled();
  });

  it('validates bytes before RPC, then cleans only the locked previous path', async () => {
    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      message: '프로필을 저장했어요.',
    });

    expect(mocks.info).toHaveBeenCalledWith(AVATAR_PATH);
    expect(mocks.download).toHaveBeenCalledWith(AVATAR_PATH);
    expect(mocks.updateProfileIdentity).toHaveBeenCalledWith({
      userId: USER_ID,
      nickname: 'fan',
      avatarPath: AVATAR_PATH,
      replaceAvatar: true,
    });
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledOnce();
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: PREVIOUS_AVATAR_PATH,
      stage: 'previous',
    });
    expect(mocks.info.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0],
    );
    expect(mocks.download.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateProfileIdentity.mock.invocationCallOrder[0],
    );
    expect(mocks.updateProfileIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cleanupProfileAvatar.mock.invocationCallOrder[0],
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/settings',
      '/',
      '/community',
      '/search',
    ]);
  });

  it('maps 23505 and rolls back the exact candidate', async () => {
    mocks.updateProfileIdentity.mockResolvedValue({ ok: false, errorCode: '23505' });

    await expect(updateProfileAction({}, profileForm('taken', AVATAR_PATH))).resolves.toEqual({
      errors: { nickname: '이미 사용 중인 닉네임입니다.' },
    });
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps a generic RPC failure and rolls back the exact candidate', async () => {
    mocks.updateProfileIdentity.mockResolvedValue({ ok: false });

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.cleanupProfileAvatar).toHaveBeenCalledWith({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    });
  });

  it('preserves the intended result when cleanup unexpectedly rejects', async () => {
    mocks.info.mockResolvedValue({
      data: null,
      error: { message: 'private info error' },
    });
    mocks.cleanupProfileAvatar.mockRejectedValue(new Error('private cleanup rejection'));

    await expect(updateProfileAction({}, profileForm('fan', AVATAR_PATH))).resolves.toEqual({
      errors: { avatar: '아바타 파일을 확인하지 못했습니다. 다시 업로드해주세요.' },
    });
  });

  it('does not clean when the locked previous path is null or equals the candidate', async () => {
    mocks.updateProfileIdentity.mockResolvedValueOnce({
      ok: true,
      previousAvatarPath: null,
    });
    await updateProfileAction({}, profileForm('fan', AVATAR_PATH));

    mocks.cleanupProfileAvatar.mockClear();
    mocks.updateProfileIdentity.mockResolvedValueOnce({
      ok: true,
      previousAvatarPath: AVATAR_PATH,
    });
    await updateProfileAction({}, profileForm('fan', AVATAR_PATH));

    expect(mocks.cleanupProfileAvatar).not.toHaveBeenCalled();
  });
});

describe('updateMarketingConsentAction', () => {
  it('returns a disabled notice without writing when Supabase is not configured', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({
      isConfigured: false,
      user: null,
      profile: null,
      isStaff: false,
    });

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('retains login and onboarding redirects', async () => {
    mocks.getCurrentAuthState.mockResolvedValueOnce({
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    });
    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings',
    );

    mocks.getCurrentAuthState.mockResolvedValueOnce({
      isConfigured: true,
      user: { id: USER_ID, email: 'fan@icons.test' },
      profile: null,
      isStaff: false,
    });
    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fsettings',
    );
  });

  it('updates only marketing while preserving required consent values', async () => {
    const formData = marketingForm(true);
    formData.set('terms', 'off');
    formData.set('privacy', 'off');

    await expect(updateMarketingConsentAction({}, formData)).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });
    expect(mocks.dbUpdate).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: true },
    });
    expect(mocks.dbEq).toHaveBeenCalledWith('id', USER_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('turns marketing off when the checkbox is absent', async () => {
    mocks.getCurrentAuthState.mockResolvedValue(
      onboardedAuth({ terms: true, privacy: true, marketing: true }),
    );

    await expect(updateMarketingConsentAction({}, marketingForm(false))).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });
    expect(mocks.dbUpdate).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: false },
    });
  });

  it('returns a safe form error when the DB update fails', async () => {
    mocks.dbEq.mockReturnValue({
      select: () => ({
        single: async () => ({ data: null, error: { message: 'private DB error' } }),
      }),
    });

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: '설정을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
