import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), info: vi.fn(), download: vi.fn(), upload: vi.fn(), removeStaging: vi.fn(), removePublic: vi.fn(), inspect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mock.rpc, storage: { from: mock.from } }) }));
vi.mock('./goods-video-parser.server', () => ({ inspectAndNormalizeGoodsVideo: mock.inspect }));
import { cleanupGoodsMediaUploads, loadAdminGoodMedia, verifyAndPromoteGoodsMedia } from './goods-media.server';
const id = '92800000-0000-4000-8001-000000000001', actor = '92800000-0000-4000-8000-000000000001', path = `video/${id}.mp4`;
const metadata = { width: 160, height: 120, durationMs: 2000, byteSize: 4, sha256: 'a'.repeat(64), videoCodec: 'avc1.64000a', audioCodec: null };
const claim = { id, path, kind: 'video', sourceSize: 4, status: 'claimed' };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
  mock.rpc.mockImplementation(async name => ({ data: name === 'service_begin_goods_media_verification' ? claim : true, error: null }));
  mock.from.mockImplementation(bucket => bucket === 'goods-video-staging' ? { info: mock.info, download: mock.download, remove: mock.removeStaging } : { upload: mock.upload, remove: mock.removePublic });
  mock.info.mockResolvedValue({ data: { contentType: 'video/mp4', size: 4 }, error: null });
  mock.download.mockResolvedValue({ data: new Blob([new Uint8Array(4)]), error: null });
  mock.inspect.mockReturnValue({ bytes: new Uint8Array(4), metadata });
  mock.upload.mockResolvedValue({ error: null }); mock.removeStaging.mockResolvedValue({ error: null }); mock.removePublic.mockResolvedValue({ error: null });
});
describe('verified goods video promotion and cleanup', () => {
  it('requires matching actual Storage metadata and accepted bytes before public promotion', async () => {
    mock.info.mockResolvedValueOnce({ data: { contentType: 'video/mp4', size: 5 }, error: null });
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ ok: false }); expect(mock.download).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith('service_cancel_goods_media_upload', { p_actor_id: actor, p_id: id });
    mock.inspect.mockReturnValue(null); expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ ok: false }); expect(mock.upload).not.toHaveBeenCalled();
  });
  it('promotes normalized bytes once and removes only staging after the verified receipt', async () => {
    const result = await verifyAndPromoteGoodsMedia(actor, id); expect(result).toMatchObject({ ok: true, asset: { id, ...metadata } });
    expect(mock.upload).toHaveBeenCalledWith(path, new Uint8Array(4), { contentType: 'video/mp4', upsert: false, cacheControl: '3600' });
    expect(mock.removeStaging).toHaveBeenCalledWith([path]); expect(mock.removePublic).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith('service_complete_goods_media_cleanup', { p_id: id, p_mode: 'staging' });
  });
  it('preserves a possibly committed public asset on lost verification response, then recovers the same claim', async () => {
    mock.rpc.mockImplementation(async name => { if (name === 'service_verify_goods_media_upload') throw new Error('response lost'); return { data: claim, error: null }; });
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ ok: false, uncertain: true });
    expect(mock.removeStaging).not.toHaveBeenCalled(); expect(mock.removePublic).not.toHaveBeenCalled();
    expect(mock.rpc.mock.calls.some(([name]) => name === 'service_cancel_goods_media_upload')).toBe(false);
    mock.rpc.mockResolvedValue({ data: { ...claim, status: 'verified', metadata }, error: null }); mock.upload.mockClear();
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ ok: true, asset: { id } }); expect(mock.upload).not.toHaveBeenCalled();
  });
  it('never downloads or duplicates promotion while another verifier is processing', async () => {
    mock.rpc.mockResolvedValue({ data: { status: 'processing', id }, error: null });
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ uncertain: true }); expect(mock.download).not.toHaveBeenCalled(); expect(mock.upload).not.toHaveBeenCalled();
  });
  it('re-queues a late public upload after cleanup already finished, then removes that orphan', async () => {
    const events: string[] = []; let status = 'processing', publicExists = false;
    mock.upload.mockImplementation(async () => {
      events.push('gc-reserved', 'gc-deleted', 'gc-completed'); status = 'cleaned';
      events.push('late-upload-completed'); publicExists = true; return { error: null };
    });
    mock.rpc.mockImplementation(async name => {
      if (name === 'service_begin_goods_media_verification') return { data: claim, error: null };
      if (name === 'service_verify_goods_media_upload') { events.push('verification-rejected'); return { data: false, error: null }; }
      if (name === 'service_cancel_goods_media_upload') { events.push('cleanup-requeued'); status = 'rejected'; return { data: true, error: null }; }
      if (name === 'service_claim_goods_media_cleanup') return { data: status === 'rejected' ? [{ id, path, mode: 'all' }] : [], error: null };
      return { data: true, error: null };
    });
    mock.removePublic.mockImplementation(async () => { publicExists = false; return { error: null }; });
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ ok: false });
    expect(events).toEqual(['gc-reserved', 'gc-deleted', 'gc-completed', 'late-upload-completed', 'verification-rejected', 'cleanup-requeued']);
    expect(publicExists).toBe(true); expect(await cleanupGoodsMediaUploads()).toEqual({ candidates: 1, completed: 1 }); expect(publicExists).toBe(false);
  });
  it('seals reads and cleans public bytes only for an atomically reserved all-mode candidate', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'network' } }); expect(await loadAdminGoodMedia('good-1')).toHaveProperty('unavailable', true);
    mock.rpc.mockImplementation(async name => ({ data: name === 'service_claim_goods_media_cleanup' ? [{ id, path, mode: 'staging' }] : true, error: null }));
    expect(await cleanupGoodsMediaUploads()).toEqual({ candidates: 1, completed: 1 }); expect(mock.removePublic).not.toHaveBeenCalled();
    mock.rpc.mockImplementation(async name => ({ data: name === 'service_claim_goods_media_cleanup' ? [{ id, path, mode: 'all' }] : true, error: null }));
    mock.removePublic.mockResolvedValueOnce({ error: { message: 'storage offline' } });
    expect(await cleanupGoodsMediaUploads()).toEqual({ candidates: 1, completed: 0 });
  });
  it('treats a definite permission rejection as failed while retaining unknown database errors', async () => {
    mock.rpc.mockImplementation(async name => name === 'service_begin_goods_media_verification' ? { data: claim, error: null } : name === 'service_verify_goods_media_upload' ? { data: null, error: { code: '42501' } } : { data: false, error: null });
    const denied = await verifyAndPromoteGoodsMedia(actor, id); expect(denied).toMatchObject({ ok: false }); expect(denied).not.toHaveProperty('uncertain');
    expect(mock.rpc).toHaveBeenCalledWith('service_cancel_goods_media_upload', { p_actor_id: actor, p_id: id });
    mock.rpc.mockClear(); mock.rpc.mockImplementation(async name => name === 'service_begin_goods_media_verification' ? { data: claim, error: null } : { data: null, error: { code: '08006' } });
    expect(await verifyAndPromoteGoodsMedia(actor, id)).toMatchObject({ uncertain: true }); expect(mock.rpc.mock.calls.some(([name]) => name === 'service_cancel_goods_media_upload')).toBe(false);
  });
});
