const { legacyOperatorAccessFixture, configuredOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAdminArtworkUploadAction,
  prepareAdminArtworkUploadAction,
  verifyAdminArtworkUploadAction,
} from './artwork-actions';
import { ADMIN_ARTWORK_ERROR, ADMIN_ARTWORK_MAX_BYTES } from '@/lib/admin/artwork';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OBJECT_PATH = `catalog/ip/${UUID}.png`;
const ACTOR_CHANGED_ERROR = '로그인 계정이 변경되었습니다. 현재 계정에서 다시 시도해주세요.';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  after: vi.fn(),
  afterCallbacks: [] as (() => unknown)[],
  blockReason: vi.fn(),
  cancelUpload: vi.fn(),
  cleanupExpired: vi.fn(),
  createClaim: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  rejectUpload: vi.fn(),
  rpc: vi.fn(),
  verifyAndPromote: vi.fn(),
}));

vi.mock('@/lib/admin/artwork.server', () => ({
  cancelAdminArtworkUpload: mocks.cancelUpload,
  cleanupExpiredAdminArtworkUploads: mocks.cleanupExpired,
  createAdminArtworkUploadClaim: mocks.createClaim,
  readAdminArtworkUploadBlockReason: mocks.blockReason,
  rejectAdminArtworkUpload: mocks.rejectUpload,
  verifyAndPromoteAdminArtwork: mocks.verifyAndPromote,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getCurrentAdminAuthState,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
async function runAfterCallbacks() {
  for (const callback of mocks.afterCallbacks.splice(0)) await callback();
}

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(UUID);
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  };
  vi.clearAllMocks();
  mocks.afterCallbacks = [];
  mocks.after.mockImplementation((callback: () => unknown) => { mocks.afterCallbacks.push(callback); });
  mocks.blockReason.mockResolvedValue(null);
  mocks.rpc.mockImplementation(async (_name: string, args: { p_id: string }) => ({ data: { id: args.p_id, revision: 1 }, error: null }));

  mocks.cleanupExpired.mockResolvedValue(undefined);
  mocks.cancelUpload.mockResolvedValue(undefined);
  mocks.createClaim.mockResolvedValue(true);
  mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.adminState);
  mocks.rejectUpload.mockResolvedValue(undefined);
  mocks.verifyAndPromote.mockResolvedValue({ imagePath: `public-media/${OBJECT_PATH}` });
});

describe('prepareAdminArtworkUploadAction', () => {
  it.each([
    { kind: 'unknown', mimeType: 'image/png', size: 1 },
    { kind: 'ip', mimeType: 'image/svg+xml', size: 1 },
    { kind: 'ip', mimeType: 'image/png', size: 0 },
    { kind: 'ip', mimeType: 'image/png', size: 1.5 },
    { kind: 'ip', mimeType: 'image/png', size: ADMIN_ARTWORK_MAX_BYTES + 1 },
    // A prototype key that reaches the extension lookup would stringify a function
    // into the object path and leave a claim no later parse can match.
    { kind: 'ip', mimeType: 'toString', size: 1 },
    { kind: 'ip', mimeType: 'constructor', size: 1 },
    { kind: 'toString', mimeType: 'image/png', size: 1 },
  ])('validates metadata before auth, claims, or Storage %#', async (input) => {
    await expect(prepareAdminArtworkUploadAction(input)).resolves.toEqual({
      ok: false,
      error: ADMIN_ARTWORK_ERROR,
    });

    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.createClaim).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated requests to the exact admin login path', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip',
      mimeType: 'image/png',
      size: 8,
    })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');
    expect(mocks.createClaim).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-staff user before claims or Storage', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };

    await expect(prepareAdminArtworkUploadAction({
      kind: 'good',
      mimeType: 'image/jpeg',
      size: 1,
    })).resolves.toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.createClaim).not.toHaveBeenCalled();
  });

  it('returns an actor-bound path for authenticated private staging upload', async () => {
    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip',
      mimeType: 'image/png',
      size: 8,
    })).resolves.toEqual({
      ok: true,
      path: OBJECT_PATH,
    });

    expect(mocks.createClaim).toHaveBeenCalledWith({
      actorId: 'staff-1',
      kind: 'ip',
      mimeType: 'image/png',
      path: OBJECT_PATH,
      size: 8,
    });
    /* R19: 만료 정리는 응답을 보낸 뒤(after) 돈다 — 준비 응답이 정리 RPC·Storage 삭제를 기다리지 않는다. */
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.cleanupExpired).not.toHaveBeenCalled();
    await runAfterCallbacks();
    expect(mocks.cleanupExpired).toHaveBeenCalledWith(5);
    expect(mocks.createClaim.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cleanupExpired.mock.invocationCallOrder[0],
    );
  });

  it('keeps a prepared claim when the deferred cleanup rejects or cannot be scheduled', async () => {
    mocks.cleanupExpired.mockRejectedValue(new Error('private cleanup rejection'));
    await expect(prepareAdminArtworkUploadAction({ kind: 'ip', mimeType: 'image/png', size: 8 }))
      .resolves.toEqual({ ok: true, path: OBJECT_PATH });
    await expect(runAfterCallbacks()).resolves.toBeUndefined();

    mocks.after.mockImplementation(() => { throw new Error('outside request scope'); });
    await expect(prepareAdminArtworkUploadAction({ kind: 'ip', mimeType: 'image/png', size: 8 }))
      .resolves.toEqual({ ok: true, path: OBJECT_PATH });
    expect(mocks.rejectUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['staging_full', '확인을 기다리는 사진이 너무 많습니다. 올리는 중인 사진이 끝난 뒤 다시 시도해주세요.'],
    ['unsaved_full', '저장하지 않고 올려 둔 사진이 너무 많습니다. 작성 중인 화면을 먼저 저장한 뒤 다시 시도해주세요.'],
  ])('explains a %s upload budget instead of the generic prepare error', async (reason, message) => {
    mocks.createClaim.mockResolvedValue(false);
    mocks.blockReason.mockResolvedValue(reason);
    await expect(prepareAdminArtworkUploadAction({ kind: 'good', mimeType: 'image/png', size: 8 }))
      .resolves.toEqual({ ok: false, error: message });
    expect(mocks.blockReason).toHaveBeenCalledWith({ actorId: 'staff-1', stage: 'prepare' });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it.each(['staff-1', undefined])('accepts the current or omitted expected actor (%s)', async expectedActorId => {
    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8, expectedActorId,
    })).resolves.toEqual({ ok: true, path: OBJECT_PATH });
    expect(mocks.createClaim).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'staff-1' }));
  });

  it.each(['staff-2', null, '', ' staff-1 ', 123, {}, ['staff-1']])('rejects a mismatched or malformed expected actor before claims (%j)', async expectedActorId => {
    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8, expectedActorId,
    })).resolves.toEqual({ ok: false, error: ACTOR_CHANGED_ERROR });
    expect(mocks.createClaim).not.toHaveBeenCalled();
    expect(mocks.cleanupExpired).not.toHaveBeenCalled();
    expect(mocks.rejectUpload).not.toHaveBeenCalled();
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
  });

  it('fails a bound request after sign-out without redirecting or preparing a claim', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8, expectedActorId: 'staff-1',
    })).resolves.toEqual({ ok: false, error: ACTOR_CHANGED_ERROR });
    expect(mocks.createClaim).not.toHaveBeenCalled();
    expect(mocks.cleanupExpired).not.toHaveBeenCalled();
  });

  it('still requires permission when the expected actor matches', async () => {
    mocks.adminState.isStaff = false;
    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8, expectedActorId: 'staff-1',
    })).resolves.toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.createClaim).not.toHaveBeenCalled();
  });

  it('prepares curation artwork under the dedicated path contract', async () => {
    await expect(prepareAdminArtworkUploadAction({
      kind: 'curation',
      mimeType: 'image/png',
      size: 8,
    })).resolves.toEqual({
      ok: true,
      path: `catalog/curation/${UUID}.png`,
    });

    expect(mocks.createClaim).toHaveBeenCalledWith({
      actorId: 'staff-1',
      kind: 'curation',
      mimeType: 'image/png',
      path: `catalog/curation/${UUID}.png`,
      size: 8,
    });
  });

  it('fails closed without granting when the durable claim cannot be created', async () => {
    mocks.createClaim.mockResolvedValue(false);

    await expect(prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8,
    })).resolves.toEqual({
      ok: false,
      error: '이미지 업로드를 준비하지 못했습니다. 다시 시도해주세요.',
    });
    expect(mocks.cleanupExpired).not.toHaveBeenCalled();
  });

  it('keeps the generic prepare error when the block reason lookup unexpectedly rejects', async () => {
    mocks.createClaim.mockResolvedValue(false);
    mocks.blockReason.mockRejectedValue(new Error('private lookup detail'));

    const result = await prepareAdminArtworkUploadAction({ kind: 'ip', mimeType: 'image/png', size: 8 });

    expect(result).toEqual({ ok: false, error: '이미지 업로드를 준비하지 못했습니다. 다시 시도해주세요.' });
    expect(mocks.rejectUpload).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

describe('cancelAdminArtworkUploadAction', () => {
  it('rejects only the authenticated actor claim for a valid staging path', async () => {
    await cancelAdminArtworkUploadAction({ path: OBJECT_PATH });

    expect(mocks.cancelUpload).toHaveBeenCalledWith({
      actorId: 'staff-1',
      path: OBJECT_PATH,
    });
  });

  it('allows a signed-in actor to release their claim after losing staff eligibility', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: false,
    };

    await cancelAdminArtworkUploadAction({ path: OBJECT_PATH });

    expect(mocks.cancelUpload).toHaveBeenCalledWith({
      actorId: 'staff-1',
      path: OBJECT_PATH,
    });
  });

  it.each([
    ['invalid path', { path: `public-media/${OBJECT_PATH}` }, true],
    ['signed-out actor', { path: OBJECT_PATH }, false],
  ])('does not access service state for a %s', async (_label, input, invalidPath) => {
    if (!invalidPath) {
      mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };
    }

    await cancelAdminArtworkUploadAction(input);

    expect(mocks.cancelUpload).not.toHaveBeenCalled();
    if (invalidPath) expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
  });
});

describe('verifyAdminArtworkUploadAction', () => {
  const validInput = {
    kind: 'ip',
    mimeType: 'image/png',
    path: OBJECT_PATH,
    size: 8,
  };

  it.each([
    { ...validInput, kind: 'unknown' },
    { ...validInput, mimeType: 'image/jpeg' },
    { ...validInput, path: `public-media/${OBJECT_PATH}` },
    { ...validInput, size: 0 },
  ])('rejects invalid candidate input before auth or promotion %#', async (input) => {
    await expect(verifyAdminArtworkUploadAction(input)).resolves.toEqual({
      ok: false,
      error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.',
    });
    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated verifier before service access', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(verifyAdminArtworkUploadAction(validInput)).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it('rejects non-staff before service access', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };

    await expect(verifyAdminArtworkUploadAction(validInput)).resolves.toEqual({
      ok: false,
      error: '관리자 권한이 필요합니다.',
    });
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it('returns a public path only after private validation and promotion', async () => {
    await expect(verifyAdminArtworkUploadAction(validInput)).resolves.toEqual({
      ok: true,
      imagePath: `public-media/${OBJECT_PATH}`,
    });
    expect(mocks.verifyAndPromote).toHaveBeenCalledWith({
      actorId: 'staff-1',
      ...validInput,
    });
  });

  it.each(['staff-1', undefined])('accepts the current or omitted expected actor (%s)', async expectedActorId => {
    await expect(verifyAdminArtworkUploadAction({ ...validInput, expectedActorId })).resolves.toEqual({
      ok: true, imagePath: `public-media/${OBJECT_PATH}`,
    });
    expect(mocks.verifyAndPromote).toHaveBeenCalledWith({ actorId: 'staff-1', ...validInput });
  });

  it.each(['staff-2', null, '', ' staff-1 ', 123, {}, ['staff-1']])('rejects a mismatched or malformed expected actor before promotion (%j)', async expectedActorId => {
    await expect(verifyAdminArtworkUploadAction({ ...validInput, expectedActorId })).resolves.toEqual({
      ok: false, error: ACTOR_CHANGED_ERROR,
    });
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it.each(['account switch', 'sign-out'])('rejects %s between prepare and verify', async change => {
    const input = { ...validInput, expectedActorId: 'staff-1' };
    await expect(prepareAdminArtworkUploadAction(input)).resolves.toEqual({ ok: true, path: OBJECT_PATH });
    mocks.adminState = change === 'sign-out'
      ? { isConfigured: true, user: null, role: null, isStaff: false }
      : { ...mocks.adminState, user: { id: 'staff-2', email: 'other@icons.test' } };

    await expect(verifyAdminArtworkUploadAction(input)).resolves.toEqual({ ok: false, error: ACTOR_CHANGED_ERROR });
    expect(mocks.createClaim).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff-1', ...validInput });
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it('still requires permission when the expected verifier matches', async () => {
    mocks.adminState.isStaff = false;
    await expect(verifyAdminArtworkUploadAction({ ...validInput, expectedActorId: 'staff-1' })).resolves.toEqual({
      ok: false, error: '관리자 권한이 필요합니다.',
    });
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved rejection', () => mocks.verifyAndPromote.mockResolvedValue(null)],
    ['rejection', () => mocks.verifyAndPromote.mockRejectedValue(new Error('private verify detail'))],
  ])('maps a promotion %s to a safe generic error', async (_label, arrange) => {
    arrange();

    const result = await verifyAdminArtworkUploadAction(validInput);

    expect(result).toEqual({
      ok: false,
      error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  /* R20(MD-0025): 한도에 걸린 확인은 사진이 조용히 사라진 것처럼 보이지 않게 이유를 알린다. */
  it.each([
    ['verification_in_progress', '다른 사진을 올리는 중입니다. 끝난 뒤 다시 시도해주세요.'],
    ['verification_rate_limited', '1분에 올릴 수 있는 사진 수를 넘었습니다. 잠시 뒤 다시 시도해주세요.'],
  ])('maps a %s block to a specific message', async (blockedReason, error) => {
    mocks.verifyAndPromote.mockResolvedValue({ blockedReason });
    await expect(verifyAdminArtworkUploadAction(validInput)).resolves.toEqual({ ok: false, error });
  });
});

describe('verified goods upload → photo library (R20)', () => {
  const GOOD_UUID = '223e4567-e89b-42d3-a456-426614174000';
  const goodPath = `catalog/good/${GOOD_UUID}.png`;
  const goodInput = { kind: 'good', mimeType: 'image/png', path: goodPath, size: 8 };
  beforeEach(() => {
    mocks.verifyAndPromote.mockResolvedValue({ imagePath: `public-media/${goodPath}` });
  });

  it('registers the verified upload under its upload UUID with an NFC name, without revalidating', async () => {
    const nfd = '메이플 키링.png'.normalize('NFD');
    await expect(verifyAdminArtworkUploadAction({ ...goodInput, library: { name: ` ${nfd} ` } })).resolves.toEqual({
      ok: true, imagePath: `public-media/${goodPath}`, library: { ok: true, id: GOOD_UUID },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_goods_photo', {
      p_id: GOOD_UUID, p_image_path: `public-media/${goodPath}`, p_name: '메이플 키링.png'.normalize('NFC'), p_expected_revision: 0, p_archived: false,
    });
    expect(mocks.verifyAndPromote.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it('does not register uploads that did not ask for it', async () => {
    await expect(verifyAdminArtworkUploadAction(goodInput)).resolves.toEqual({ ok: true, imagePath: `public-media/${goodPath}` });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['an RPC error', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unverified_artwork' } })],
    ['a thrown RPC', () => mocks.rpc.mockRejectedValue(new Error('private rpc detail'))],
    ['a mismatched result', () => mocks.rpc.mockResolvedValue({ data: { id: 'other', revision: 1 }, error: null })],
  ])('keeps the upload successful when registration fails with %s', async (_label, arrange) => {
    arrange();
    const result = await verifyAdminArtworkUploadAction({ ...goodInput, library: { name: 'a.png' } });
    expect(result).toEqual({
      ok: true, imagePath: `public-media/${goodPath}`,
      library: { ok: false, error: '사진 보관함에는 등록하지 못했습니다. 상품 이미지는 그대로 저장할 수 있습니다.' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('uses the same catalog.manage permission as saving a photo in the library', async () => {
    mocks.adminState.operatorAccess = configuredOperatorAccessFixture('deputy');
    await expect(verifyAdminArtworkUploadAction({ ...goodInput, library: { name: 'a.png' } })).resolves.toMatchObject({ ok: true, library: { ok: true } });

    mocks.rpc.mockClear();
    mocks.adminState.operatorAccess = { ...configuredOperatorAccessFixture('deputy'), capabilities: ['home', 'catalog.read'] };
    await expect(verifyAdminArtworkUploadAction({ ...goodInput, library: { name: 'a.png' } })).resolves.toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.verifyAndPromote).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-goods kind', { ...validLibraryInput('ip'), library: { name: 'a.png' } }],
    ['a malformed library request', { ...goodInput, library: 'a.png' }],
    ['extra library keys', { ...goodInput, library: { name: 'a.png', id: GOOD_UUID } }],
    ['an oversized file name', { ...goodInput, library: { name: 'a'.repeat(1025) } }],
  ])('rejects %s before verification', async (_label, input) => {
    await expect(verifyAdminArtworkUploadAction(input)).resolves.toEqual({ ok: false, error: '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.' });
    expect(mocks.verifyAndPromote).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  function validLibraryInput(kind: 'ip') {
    return { kind, mimeType: 'image/png', path: OBJECT_PATH, size: 8 };
  }
});
