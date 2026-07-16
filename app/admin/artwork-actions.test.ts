import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAdminArtworkUploadAction,
  prepareAdminArtworkUploadAction,
  verifyAdminArtworkUploadAction,
} from './artwork-actions';
import { ADMIN_ARTWORK_ERROR, ADMIN_ARTWORK_MAX_BYTES } from '@/lib/admin/artwork';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OBJECT_PATH = `catalog/ip/${UUID}.png`;

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  cancelUpload: vi.fn(),
  cleanupExpired: vi.fn(),
  createClaim: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  rejectUpload: vi.fn(),
  verifyAndPromote: vi.fn(),
}));

vi.mock('@/lib/admin/artwork', async () => await import('../../lib/admin/artwork'));
vi.mock('@/lib/admin/artwork.server', () => ({
  cancelAdminArtworkUpload: mocks.cancelUpload,
  cleanupExpiredAdminArtworkUploads: mocks.cleanupExpired,
  createAdminArtworkUploadClaim: mocks.createClaim,
  rejectAdminArtworkUpload: mocks.rejectUpload,
  verifyAndPromoteAdminArtwork: mocks.verifyAndPromote,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getCurrentAdminAuthState,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(UUID);
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff',
    isStaff: true,
  };
  vi.clearAllMocks();

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

    expect(mocks.cleanupExpired).toHaveBeenCalledWith(5);
    expect(mocks.createClaim).toHaveBeenCalledWith({
      actorId: 'staff-1',
      kind: 'ip',
      mimeType: 'image/png',
      path: OBJECT_PATH,
      size: 8,
    });
    expect(mocks.createClaim.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cleanupExpired.mock.invocationCallOrder[0],
    );
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

  it('rejects the claim when the post-claim cleanup unexpectedly rejects', async () => {
    mocks.cleanupExpired.mockRejectedValue(new Error('private cleanup rejection'));

    const result = await prepareAdminArtworkUploadAction({
      kind: 'ip', mimeType: 'image/png', size: 8,
    });

    expect(result).toEqual({
      ok: false,
      error: '이미지 업로드를 준비하지 못했습니다. 다시 시도해주세요.',
    });
    expect(mocks.rejectUpload).toHaveBeenCalledWith({ actorId: 'staff-1', path: OBJECT_PATH });
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
});
