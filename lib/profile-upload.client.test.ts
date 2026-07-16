import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadProfileAvatar } from './profile-upload.client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  prepare: vi.fn(),
  storageFrom: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));

vi.mock('@/app/settings/actions', () => ({
  prepareProfileAvatarUploadAction: mocks.prepare,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));

const USER_ID = '00000000-0000-4000-8000-000000001201';
const AVATAR_PATH = `${USER_ID}/profile/22222222-2222-4222-8222-222222222222.png`;

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.prepare.mockReset();
  mocks.storageFrom.mockReset();
  mocks.uploadToSignedUrl.mockReset();

  mocks.prepare.mockResolvedValue({
    ok: true,
    path: AVATAR_PATH,
    token: 'signed-upload-token',
  });
  mocks.uploadToSignedUrl.mockResolvedValue({
    data: { path: AVATAR_PATH, fullPath: `user-uploads/${AVATAR_PATH}` },
    error: null,
  });
  mocks.storageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
    return { uploadToSignedUrl: mocks.uploadToSignedUrl };
  });
  mocks.createClient.mockReturnValue({ storage: { from: mocks.storageFrom } });
});

describe('uploadProfileAvatar', () => {
  it('sends only nickname and metadata to prepare, then sends bytes directly to Storage', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'avatar.png', {
      type: 'image/png',
    });

    await expect(uploadProfileAvatar({ nickname: '  새 닉네임  ', file })).resolves.toEqual({
      ok: true,
      path: AVATAR_PATH,
    });

    expect(mocks.prepare).toHaveBeenCalledWith({
      nickname: '  새 닉네임  ',
      mimeType: 'image/png',
      size: 4,
    });
    expect(Object.values(mocks.prepare.mock.calls[0][0])).not.toContain(file);
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      AVATAR_PATH,
      'signed-upload-token',
      file,
      { contentType: 'image/png', upsert: false },
    );
  });

  it('returns prepare field and form errors without creating a browser client', async () => {
    mocks.prepare.mockResolvedValue({
      ok: false,
      errors: {
        avatar: '아바타 입력 오류',
        nickname: '닉네임 입력 오류',
        form: '준비 오류',
      },
    });

    await expect(uploadProfileAvatar({
      nickname: 'fan',
      file: new File(['avatar'], 'avatar.png', { type: 'image/png' }),
    })).resolves.toEqual({
      ok: false,
      errors: {
        avatar: '아바타 입력 오류',
        nickname: '닉네임 입력 오류',
        form: '준비 오류',
      },
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('maps a resolved direct-upload error to a safe avatar message', async () => {
    mocks.uploadToSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'private storage detail' },
    });

    const result = await uploadProfileAvatar({
      nickname: 'fan',
      file: new File(['avatar'], 'avatar.png', { type: 'image/png' }),
    });

    expect(result).toEqual({
      ok: false,
      errors: { avatar: '아바타를 업로드하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(JSON.stringify(result)).not.toContain('private storage detail');
  });

  it.each([
    ['prepare', () => mocks.prepare.mockRejectedValue(new Error('private prepare rejection'))],
    ['upload', () => mocks.uploadToSignedUrl.mockRejectedValue(new Error('private upload rejection'))],
  ])('catches a %s rejection without exposing credentials or provider details', async (_label, arrange) => {
    arrange();

    const result = await uploadProfileAvatar({
      nickname: 'fan',
      file: new File(['avatar'], 'avatar.png', { type: 'image/png' }),
    });

    expect(result).toEqual({
      ok: false,
      errors: { avatar: '아바타를 업로드하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|token|credential/i);
  });
});
