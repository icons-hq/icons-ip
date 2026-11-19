import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAdminArtwork } from './artwork-upload.client';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OBJECT_PATH = `catalog/card/${UUID}.webp`;
const ACTOR_CHANGED_ERROR = '로그인 계정이 변경되었습니다. 현재 계정에서 다시 시도해주세요.';
/* 업로드는 File.type이 아니라 파일 앞부분(매직 바이트)으로 형식을 정한다. 시험 파일도 실제 이미지 머리를 둔다. */
const SIGNATURES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
};
function imageFile(body: string, name: string, options: { type: string }) {
  return new File([new Uint8Array(SIGNATURES[options.type] ?? []), body], name, options);
}

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  createClient: vi.fn(),
  fetch: vi.fn(),
  prepare: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/app/admin/artwork-actions', () => ({
  cancelAdminArtworkUploadAction: mocks.cancel,
  prepareAdminArtworkUploadAction: mocks.prepare,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  /* 확인은 서버 액션이 아니라 /api/admin/artwork/verify로 간다(R19). mocks.verify는 그 본문을 받는 서버 역할이다. */
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const result = await mocks.verify(JSON.parse(String(init.body)));
    return { ok: result?.ok === true, json: async () => result };
  });
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
  it('captures the starting actor once for prepare and verify', async () => {
    const file = imageFile('image', 'image.webp', { type: 'image/webp' });
    const input = { kind: 'card' as const, file, expectedActorId: 'staff-1' };
    mocks.prepare.mockImplementationOnce(async () => {
      input.expectedActorId = 'staff-2';
      return { ok: true, path: OBJECT_PATH };
    });

    await expect(uploadAdminArtwork(input)).resolves.toEqual({ ok: true, imagePath: `public-media/${OBJECT_PATH}` });
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({ kind: 'card', mimeType: file.type, size: file.size, expectedActorId: 'staff-1' });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ kind: 'card', mimeType: file.type, size: file.size, path: OBJECT_PATH, expectedActorId: 'staff-1' });
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(OBJECT_PATH, file, { contentType: file.type, upsert: false });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('keeps explicitly undefined actor bindings compatible with existing actions', async () => {
    const file = imageFile('image', 'image.webp', { type: 'image/webp' });
    await uploadAdminArtwork({ kind: 'card', file, expectedActorId: undefined });
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({ kind: 'card', mimeType: file.type, size: file.size });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ kind: 'card', mimeType: file.type, size: file.size, path: OBJECT_PATH });
  });

  it('does not upload or cancel when the actor changed before prepare', async () => {
    mocks.prepare.mockResolvedValue({ ok: false, error: ACTOR_CHANGED_ERROR });
    await expect(uploadAdminArtwork({
      kind: 'good', file: imageFile('image', 'image.png', { type: 'image/png' }), expectedActorId: 'staff-1',
    })).resolves.toEqual({ ok: false, error: ACTOR_CHANGED_ERROR });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(['resolves', 'rejects'])('keeps a verify account-switch error when cancellation %s', async cleanup => {
    mocks.verify.mockResolvedValue({ ok: false, error: ACTOR_CHANGED_ERROR });
    if (cleanup === 'rejects') mocks.cancel.mockRejectedValue(new Error('private cancellation failure'));
    await expect(uploadAdminArtwork({
      kind: 'good', file: imageFile('image', 'image.png', { type: 'image/png' }), expectedActorId: 'staff-1',
    })).resolves.toEqual({ ok: false, error: ACTOR_CHANGED_ERROR });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ path: OBJECT_PATH });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedActorId: 'staff-1' }));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('cleans up a bound verification rejection without accepting a path or retrying', async () => {
    mocks.verify.mockRejectedValue(new Error('private verification failure'));
    mocks.cancel.mockRejectedValue(new Error('private cancellation failure'));
    await expect(uploadAdminArtwork({
      kind: 'good', file: imageFile('image', 'image.png', { type: 'image/png' }), expectedActorId: 'staff-1',
    })).resolves.toEqual({ ok: false, error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.' });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ path: OBJECT_PATH });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('preserves the curation kind through prepare and verification', async () => {
    const path = `catalog/curation/${UUID}.png`;
    const file = imageFile('image', 'curation.png', { type: 'image/png' });
    mocks.prepare.mockResolvedValue({ ok: true, path });
    mocks.upload.mockResolvedValue({
      data: { path, fullPath: `admin-artwork-staging/${path}` },
      error: null,
    });
    mocks.verify.mockResolvedValue({ ok: true, imagePath: `public-media/${path}` });

    await expect(uploadAdminArtwork({ kind: 'curation', file })).resolves.toEqual({
      ok: true,
      imagePath: `public-media/${path}`,
    });
    expect(mocks.prepare).toHaveBeenCalledWith({
      kind: 'curation',
      mimeType: 'image/png',
      size: file.size,
    });
    expect(mocks.verify).toHaveBeenCalledWith({
      kind: 'curation',
      mimeType: 'image/png',
      path,
      size: file.size,
    });
  });

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
      file: imageFile('image', 'image.png', { type: 'image/png' }),
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
      file: imageFile('image', 'image.png', { type: 'image/png' }),
    });

    expect(result).toEqual({
      ok: false,
      error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요. 계속되면 운영 담당자에게 알려주세요(원인 코드 staging_upload_failed).',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    // 화면에는 내보내지 않는 저장소 문구는 취소와 함께 서버(claim 진단 값)로만 보낸다.
    expect(mocks.cancel).toHaveBeenCalledWith({ path: OBJECT_PATH, failure: { status: null, message: 'private storage detail', tooLarge: 0 } });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  /* 2026-11-19 다른 세션의 의심(프로젝트 전역 Storage 한도가 버킷 한도보다 낮음)이 맞다면 이 경로로 드러난다. */
  it('names a storage size rejection during the staging upload', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: { statusCode: '413', message: 'The object exceeded the maximum allowed size' } });
    await expect(uploadAdminArtwork({ kind: 'good', file: imageFile('image', 'detail.png', { type: 'image/png' }) })).resolves.toEqual({
      ok: false,
      error: '저장소가 파일 크기로 업로드를 거절했습니다. 운영 담당자에게 알려주세요(원인 코드 staging_upload_too_large).',
    });
    expect(mocks.cancel).toHaveBeenCalledWith({ path: expect.any(String), failure: { status: 413, message: 'The object exceeded the maximum allowed size', tooLarge: 1 } });
  });

  it('returns a post-upload verification error without exposing or accepting the path', async () => {
    mocks.verify.mockResolvedValue({
      ok: false,
      error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.',
    });

    await expect(uploadAdminArtwork({
      kind: 'event',
      file: imageFile('not-image', 'image.png', { type: 'image/png' }),
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
      file: imageFile('image', 'image.jpg', { type: 'image/jpeg' }),
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
      file: imageFile('image', 'image.jpg', { type: 'image/jpeg' }),
    })).resolves.toEqual({
      ok: false,
      error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.',
    });
  });

  /* R19(MD-0030): 수 초 걸리는 확인을 서버 액션 대기열 밖으로 보내 사진 보관함 팝업 조회가 뒤에 서지 않게 한다. */
  it('verifies through the same-origin JSON route instead of a server action', async () => {
    await uploadAdminArtwork({ kind: 'card', file: imageFile('image', 'image.webp', { type: 'image/webp' }) });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/artwork/verify', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('sends the library request and returns its registration result', async () => {
    const path = `catalog/good/${UUID}.png`;
    mocks.prepare.mockResolvedValue({ ok: true, path });
    mocks.verify.mockResolvedValue({ ok: true, imagePath: `public-media/${path}`, library: { ok: true, id: UUID } });
    const file = imageFile('image', 'image.png', { type: 'image/png' });
    await expect(uploadAdminArtwork({ kind: 'good', file, library: { name: '키링.png' } })).resolves.toEqual({
      ok: true, imagePath: `public-media/${path}`, library: { ok: true, id: UUID },
    });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ kind: 'good', mimeType: 'image/png', path, size: file.size, library: { name: '키링.png' } });
  });

  it.each([
    ['a public path for another upload', { ok: true, imagePath: 'public-media/catalog/card/223e4567-e89b-42d3-a456-426614174000.webp' }],
    ['a non-JSON gateway error', null],
    ['an untyped body', { ok: 'yes' }],
  ])('rejects %s and cancels the claim', async (_label, body) => {
    mocks.fetch.mockResolvedValue({ ok: body !== null, json: async () => { if (body === null) throw new SyntaxError('html'); return body; } });
    await expect(uploadAdminArtwork({ kind: 'card', file: imageFile('image', 'image.webp', { type: 'image/webp' }) })).resolves.toEqual({
      ok: false, error: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.',
    });
    expect(mocks.cancel).toHaveBeenCalledWith({ path: OBJECT_PATH });
  });

  it('keeps a specific server error such as an upload limit', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: '다른 사진을 올리는 중입니다. 끝난 뒤 다시 시도해주세요.' }) });
    await expect(uploadAdminArtwork({ kind: 'card', file: imageFile('image', 'image.webp', { type: 'image/webp' }) })).resolves.toEqual({
      ok: false, error: '다른 사진을 올리는 중입니다. 끝난 뒤 다시 시도해주세요.',
    });
  });

  it('sends one verification at a time per tab while other uploads keep preparing', async () => {
    const paths = [1, 2].map(n => `catalog/card/${UUID.slice(0, -1)}${n}.webp`);
    let prepared = 0;
    mocks.prepare.mockImplementation(async () => ({ ok: true, path: paths[prepared++] }));
    const releases: (() => void)[] = [];
    let active = 0, maxActive = 0;
    mocks.verify.mockImplementation(async (body: { path: string }) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return { ok: true, imagePath: `public-media/${body.path}` };
    });
    const file = () => imageFile('image', 'image.webp', { type: 'image/webp' });
    const uploads = [uploadAdminArtwork({ kind: 'card', file: file() }), uploadAdminArtwork({ kind: 'card', file: file() })];
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await expect(Promise.all(uploads)).resolves.toEqual(paths.map(path => ({ ok: true, imagePath: `public-media/${path}` })));
    expect(maxActive).toBe(1);
  });

  it('does not let a rejected verification block the next one', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('network down'));
    const file = () => imageFile('image', 'image.webp', { type: 'image/webp' });
    await expect(uploadAdminArtwork({ kind: 'card', file: file() })).resolves.toMatchObject({ ok: false });
    await expect(uploadAdminArtwork({ kind: 'card', file: file() })).resolves.toEqual({ ok: true, imagePath: `public-media/${OBJECT_PATH}` });
  });

  /* 2026-11-19: PNG를 .jpg 이름으로 저장한 상세 이미지를 브라우저는 image/jpeg로 신고했고 서버가 형식 불일치로 거절했다. */
  it('declares the format read from the file content instead of the extension-derived File.type', async () => {
    const file = new File([new Uint8Array(SIGNATURES['image/png']), 'png body'], '6.홍실_랜덤티켓세트_PDP.jpg', { type: 'image/jpeg' });
    await uploadAdminArtwork({ kind: 'good', file });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ kind: 'good', mimeType: 'image/png', size: file.size }));
    // supabase-js는 Blob 본문의 type으로 저장 형식을 정하므로 본문도 판별한 형식이어야 한다.
    const [, body] = mocks.upload.mock.calls[0] as [string, File];
    expect(body.type).toBe('image/png');
    expect(body.size).toBe(file.size);
    expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({ contentType: 'image/png' }));
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('stops before preparing when the content is not JPEG, PNG or WebP', async () => {
    const file = new File(['GIF89a'], 'animation.png', { type: 'image/png' });
    await expect(uploadAdminArtwork({ kind: 'good', file })).resolves.toEqual({ ok: false, error: expect.stringContaining('JPEG, PNG, WebP 이미지 파일이 아닙니다') });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
