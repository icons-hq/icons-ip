import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAdminArtwork } from './artwork-upload.client';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OBJECT_PATH = `catalog/card/${UUID}.webp`;

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  createClient: vi.fn(),
  prepare: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/app/admin/artwork-actions', () => ({
  cancelAdminArtworkUploadAction: mocks.cancel,
  prepareAdminArtworkUploadAction: mocks.prepare,
  verifyAdminArtworkUploadAction: mocks.verify,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  mocks.cancel.mockReset();
  mocks.createClient.mockReset();
  mocks.prepare.mockReset();
  mocks.storageFrom.mockReset();
  mocks.upload.mockReset();
  mocks.verify.mockReset();

  mocks.cancel.mockResolvedValue(undefined);

  mocks.prepare.mockResolvedValue({
    ok: true,
    path: OBJECT_PATH,
  });
  mocks.upload.mockResolvedValue({
    data: { path: OBJECT_PATH, fullPath: `admin-artwork-staging/${OBJECT_PATH}` },
    error: null,
  });
  mocks.verify.mockResolvedValue({
    ok: true,
    imagePath: `public-media/${OBJECT_PATH}`,
  });
  mocks.storageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'admin-artwork-staging') throw new Error(`Unexpected bucket ${bucket}`);
    return { upload: mocks.upload };
  });
  mocks.createClient.mockReturnValue({ storage: { from: mocks.storageFrom } });
});

describe('uploadAdminArtwork', () => {
  it('sends only metadata to the action and sends bytes directly to private staging', async () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const file = new File([bytes], 'card.webp', {
      type: 'image/webp',
    });

    await expect(uploadAdminArtwork({ kind: 'card', file })).resolves.toEqual({
      ok: true,
      imagePath: `public-media/${OBJECT_PATH}`,
    });

    expect(mocks.prepare).toHaveBeenCalledWith({
      kind: 'card',
      mimeType: 'image/webp',
      size: bytes.byteLength,
    });
    expect(Object.values(mocks.prepare.mock.calls[0][0])).not.toContain(file);
    expect(mocks.storageFrom).toHaveBeenCalledWith('admin-artwork-staging');
    expect(mocks.upload).toHaveBeenCalledWith(
      OBJECT_PATH,
      file,
      { contentType: 'image/webp', upsert: false },
    );
    expect(mocks.verify).toHaveBeenCalledWith({
      kind: 'card',
      mimeType: 'image/webp',
      path: OBJECT_PATH,
      size: bytes.byteLength,
    });
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verify.mock.invocationCallOrder[0],
    );
  });

  it('returns a prepare error without creating a browser client', async () => {
    mocks.prepare.mockResolvedValue({ ok: false, error: '메타데이터 오류' });

    await expect(uploadAdminArtwork({
      kind: 'ip',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
    })).resolves.toEqual({ ok: false, error: '메타데이터 오류' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('maps a direct-upload error to a safe generic message', async () => {
    mocks.upload.mockResolvedValue({
      data: null,
      error: { message: 'private storage detail' },
    });

    const result = await uploadAdminArtwork({
      kind: 'event',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
    });

    expect(result).toEqual({
      ok: false,
      error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.cancel).toHaveBeenCalledWith({ path: OBJECT_PATH });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('returns a post-upload verification error without exposing or accepting the path', async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.',
    });

    await expect(uploadAdminArtwork({
      kind: 'event',
      file: new File(['not-image'], 'image.png', { type: 'image/png' }),
    })).resolves.toEqual({
      ok: false,
      error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.',
    });
    expect(mocks.cancel).toHaveBeenCalledWith({ path: OBJECT_PATH });
  });

  it.each([
    ['prepare', () => mocks.prepare.mockRejectedValue(new Error('private prepare rejection'))],
    ['upload', () => mocks.upload.mockRejectedValue(new Error('private upload rejection'))],
    ['verify', () => mocks.verify.mockRejectedValue(new Error('private verify rejection'))],
  ])('catches a %s rejection without exposing details', async (_label, arrange) => {
    arrange();

    const result = await uploadAdminArtwork({
      kind: 'good',
      file: new File(['image'], 'image.jpg', { type: 'image/jpeg' }),
    });

    expect(result).toEqual({
      ok: false,
      error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|token|credential/i);
    if (_label === 'prepare') {
      expect(mocks.cancel).not.toHaveBeenCalled();
    } else {
      expect(mocks.cancel).toHaveBeenCalledWith({ path: OBJECT_PATH });
    }
  });

  it('does not mask the upload error when best-effort claim cancellation rejects', async () => {
    mocks.upload.mockRejectedValue(new Error('private upload rejection'));
    mocks.cancel.mockRejectedValue(new Error('private cancellation rejection'));

    await expect(uploadAdminArtwork({
      kind: 'good',
      file: new File(['image'], 'image.jpg', { type: 'image/jpeg' }),
    })).resolves.toEqual({
      ok: false,
      error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.',
    });
  });
});
