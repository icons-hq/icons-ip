import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAdminArtworkUpload,
  cleanupExpiredAdminArtworkUploads,
  createAdminArtworkUploadClaim,
  rejectAdminArtworkUpload,
  verifyAndPromoteAdminArtwork,
} from './artwork.server';

const ACTOR_ID = '00000000-0000-4000-8000-000000011201';
const PATH = 'catalog/ip/123e4567-e89b-42d3-a456-426614174000.png';
const SOURCE_BYTES = new Uint8Array([1, 2, 3, 4]);
const NORMALIZED_BYTES = new Uint8Array([5, 6, 7]);

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  decode: vi.fn(),
  download: vi.fn(),
  info: vi.fn(),
  publicRemove: vi.fn(),
  publicUpload: vi.fn(),
  rpc: vi.fn(),
  stagingRemove: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('./artwork-image.server', () => ({
  normalizeAdminArtworkImage: mocks.decode,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));

  mocks.decode.mockResolvedValue({
    bytes: NORMALIZED_BYTES,
    height: 1,
    width: 1,
  });
  mocks.info.mockResolvedValue({
    data: { contentType: 'image/png', size: SOURCE_BYTES.byteLength },
    error: null,
  });
  mocks.download.mockResolvedValue({
    data: new Blob([SOURCE_BYTES], { type: 'image/png' }),
    error: null,
  });
  mocks.publicUpload.mockResolvedValue({ data: { path: PATH }, error: null });
  mocks.publicRemove.mockResolvedValue({ data: [], error: null });
  mocks.stagingRemove.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'service_prepare_admin_artwork_upload') return { data: true, error: null };
    if (name === 'service_begin_admin_artwork_verification') {
      return {
        data: [{
          kind: 'ip',
          mime_type: 'image/png',
          source_size: SOURCE_BYTES.byteLength,
        }],
        error: null,
      };
    }
    if (name === 'service_verify_admin_artwork_upload') return { data: true, error: null };
    if (name === 'service_cancel_admin_artwork_upload') return { data: true, error: null };
    if (name === 'service_reject_admin_artwork_upload') return { data: true, error: null };
    if (name === 'service_complete_admin_artwork_cleanup') return { data: true, error: null };
    if (name === 'service_list_admin_artwork_cleanup_candidates') return { data: [], error: null };
    if (name === 'service_log_admin_artwork_cleanup_failure') return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.storageFrom.mockImplementation((bucket: string) => {
    if (bucket === 'admin-artwork-staging') {
      return {
        download: mocks.download,
        info: mocks.info,
        remove: mocks.stagingRemove,
      };
    }
    if (bucket === 'public-media') {
      return {
        remove: mocks.publicRemove,
        upload: mocks.publicUpload,
      };
    }
    throw new Error(`Unexpected bucket ${bucket}`);
  });
  mocks.createServiceClient.mockReturnValue({
    rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('admin artwork upload claims', () => {
  it('creates a short-lived server claim bound to actor, path, kind, MIME, and size', async () => {
    await expect(createAdminArtworkUploadClaim({
      actorId: ACTOR_ID,
      kind: 'ip',
      mimeType: 'image/png',
      path: PATH,
      size: SOURCE_BYTES.byteLength,
    })).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenCalledWith('service_prepare_admin_artwork_upload', {
      p_actor_id: ACTOR_ID,
      p_expires_at: '2026-07-17T00:10:00.000Z',
      p_kind: 'ip',
      p_mime_type: 'image/png',
      p_path: PATH,
      p_source_size: SOURCE_BYTES.byteLength,
    });
  });

  it('fails closed when the claim RPC returns a resolved provider error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private claim detail' } });

    await expect(createAdminArtworkUploadClaim({
      actorId: ACTOR_ID,
      kind: 'ip',
      mimeType: 'image/png',
      path: PATH,
      size: SOURCE_BYTES.byteLength,
    })).resolves.toBe(false);
  });
});

describe('verifyAndPromoteAdminArtwork', () => {
  const input = {
    actorId: ACTOR_ID,
    kind: 'ip' as const,
    mimeType: 'image/png' as const,
    path: PATH,
    size: SOURCE_BYTES.byteLength,
  };

  it('validates the private object, publishes only normalized bytes, verifies the claim, and removes staging', async () => {
    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toEqual({
      imagePath: `public-media/${PATH}`,
    });

    expect(mocks.info).toHaveBeenCalledWith(PATH);
    expect(mocks.download).toHaveBeenCalledWith(PATH);
    expect(mocks.decode).toHaveBeenCalledWith(SOURCE_BYTES, 'image/png');
    expect(mocks.publicUpload).toHaveBeenCalledWith(PATH, NORMALIZED_BYTES, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('service_verify_admin_artwork_upload', {
      p_actor_id: ACTOR_ID,
      p_final_size: NORMALIZED_BYTES.byteLength,
      p_path: PATH,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('service_begin_admin_artwork_verification', {
      p_actor_id: ACTOR_ID,
      p_path: PATH,
    });
    expect(mocks.stagingRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.rpc).toHaveBeenCalledWith('service_complete_admin_artwork_cleanup', {
      p_actor_id: ACTOR_ID,
      p_mode: 'staging',
      p_path: PATH,
    });
    expect(mocks.download.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publicUpload.mock.invocationCallOrder[0],
    );
    expect(mocks.publicUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder.find((order, index) =>
        mocks.rpc.mock.calls[index][0] === 'service_verify_admin_artwork_upload') ?? 0,
    );
  });

  it('does not read or remove an object without an admitted verification claim', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toBeNull();

    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.publicUpload).not.toHaveBeenCalled();
    expect(mocks.stagingRemove).not.toHaveBeenCalled();
    expect(mocks.publicRemove).not.toHaveBeenCalled();
  });

  it('rejects an admitted claim when browser metadata differs from the durable claim', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ kind: 'ip', mime_type: 'image/png', source_size: 999 }],
      error: null,
    });

    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toBeNull();

    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('service_reject_admin_artwork_upload', {
      p_actor_id: ACTOR_ID,
      p_path: PATH,
    });
  });

  it.each([
    ['invalid Storage info', () => mocks.info.mockResolvedValue({ data: { contentType: 'image/jpeg', size: 4 }, error: null })],
    ['download error', () => mocks.download.mockResolvedValue({ data: null, error: { message: 'private download' } })],
    ['decode failure', () => mocks.decode.mockResolvedValue(null)],
  ])('does not publish and rejects a %s candidate', async (_label, arrange) => {
    arrange();

    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toBeNull();

    expect(mocks.publicUpload).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('service_reject_admin_artwork_upload', {
      p_actor_id: ACTOR_ID,
      p_path: PATH,
    });
    expect(mocks.stagingRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.publicRemove).toHaveBeenCalledWith([PATH]);
  });

  it('rolls back a published object when the claim cannot transition to verified', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'service_begin_admin_artwork_verification') {
        return { data: [{ kind: 'ip', mime_type: 'image/png', source_size: 4 }], error: null };
      }
      if (name === 'service_verify_admin_artwork_upload') return { data: false, error: null };
      if (name === 'service_reject_admin_artwork_upload') return { data: true, error: null };
      if (name === 'service_complete_admin_artwork_cleanup') return { data: true, error: null };
      if (name === 'service_log_admin_artwork_cleanup_failure') return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toBeNull();

    expect(mocks.publicRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.stagingRemove).toHaveBeenCalledWith([PATH]);
  });

  it('audits a resolved staging cleanup error without hiding a successful promotion', async () => {
    mocks.stagingRemove.mockResolvedValue({ data: null, error: { message: 'private remove detail' } });

    await expect(verifyAndPromoteAdminArtwork(input)).resolves.toEqual({
      imagePath: `public-media/${PATH}`,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('service_log_admin_artwork_cleanup_failure', {
      p_actor_id: ACTOR_ID,
      p_bucket: 'admin-artwork-staging',
      p_path: PATH,
      p_stage: 'promote',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'service_complete_admin_artwork_cleanup',
      expect.anything(),
    );
  });
});

describe('cleanupExpiredAdminArtworkUploads', () => {
  it('removes both private and unattached public candidates before marking cleanup complete', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ actor_id: ACTOR_ID, cleanup_mode: 'all', path: PATH }],
      error: null,
    });

    await expect(cleanupExpiredAdminArtworkUploads()).resolves.toEqual({
      candidates: 1,
      completed: 1,
    });

    expect(mocks.stagingRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.publicRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'service_list_admin_artwork_cleanup_candidates',
      { p_limit: 50 },
    );
    expect(mocks.rpc).toHaveBeenCalledWith('service_complete_admin_artwork_cleanup', {
      p_actor_id: ACTOR_ID,
      p_mode: 'all',
      p_path: PATH,
    });
  });

  it('does not mark cleanup complete when a provider returns a resolved remove error', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ actor_id: ACTOR_ID, cleanup_mode: 'all', path: PATH }],
      error: null,
    });
    mocks.publicRemove.mockResolvedValue({ data: null, error: { message: 'private remove detail' } });

    await expect(cleanupExpiredAdminArtworkUploads()).resolves.toEqual({
      candidates: 1,
      completed: 0,
    });

    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'service_complete_admin_artwork_cleanup',
      expect.anything(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith('service_log_admin_artwork_cleanup_failure', {
      p_actor_id: ACTOR_ID,
      p_bucket: 'public-media',
      p_path: PATH,
      p_stage: 'gc',
    });
  });

  it('reports candidate listing failure to scheduled callers', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private list detail' } });

    await expect(cleanupExpiredAdminArtworkUploads()).resolves.toBeNull();

    expect(mocks.stagingRemove).not.toHaveBeenCalled();
    expect(mocks.publicRemove).not.toHaveBeenCalled();
  });

  it('fails closed when the service-owned candidate contract is malformed', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ actor_id: ACTOR_ID, cleanup_mode: 'all', path: 'unexpected/private-path' }],
      error: null,
    });

    await expect(cleanupExpiredAdminArtworkUploads()).resolves.toBeNull();

    expect(mocks.stagingRemove).not.toHaveBeenCalled();
    expect(mocks.publicRemove).not.toHaveBeenCalled();
  });
});

describe('rejectAdminArtworkUpload', () => {
  it('rejects the claim before removing both possible objects', async () => {
    await rejectAdminArtworkUpload({ actorId: ACTOR_ID, path: PATH });

    const rejectOrder = mocks.rpc.mock.invocationCallOrder.find((order, index) =>
      mocks.rpc.mock.calls[index][0] === 'service_reject_admin_artwork_upload') ?? 0;
    expect(rejectOrder).toBeLessThan(mocks.stagingRemove.mock.invocationCallOrder[0]);
    expect(mocks.publicRemove).toHaveBeenCalledWith([PATH]);
  });
});

describe('cancelAdminArtworkUpload', () => {
  it('cleans objects only after atomically cancelling an active claim', async () => {
    await cancelAdminArtworkUpload({ actorId: ACTOR_ID, path: PATH });

    const cancelOrder = mocks.rpc.mock.invocationCallOrder.find((order, index) =>
      mocks.rpc.mock.calls[index][0] === 'service_cancel_admin_artwork_upload') ?? 0;
    expect(cancelOrder).toBeLessThan(mocks.stagingRemove.mock.invocationCallOrder[0]);
    expect(mocks.publicRemove).toHaveBeenCalledWith([PATH]);
    expect(mocks.rpc).toHaveBeenCalledWith('service_complete_admin_artwork_cleanup', {
      p_actor_id: ACTOR_ID,
      p_mode: 'all',
      p_path: PATH,
    });
  });

  it.each([
    ['already resolved claim', { data: false, error: null }],
    ['provider error', { data: null, error: { message: 'private cancel detail' } }],
  ])('does no Storage work for an %s', async (_label, result) => {
    mocks.rpc.mockResolvedValueOnce(result);

    await cancelAdminArtworkUpload({ actorId: ACTOR_ID, path: PATH });

    expect(mocks.stagingRemove).not.toHaveBeenCalled();
    expect(mocks.publicRemove).not.toHaveBeenCalled();
  });
});
