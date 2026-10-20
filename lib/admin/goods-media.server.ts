import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { DEFAULT_GOODS_MEDIA_SETTINGS, GOODS_MEDIA_BUCKET, GOODS_MEDIA_STAGING_BUCKET, goodsVideoUrl, parseGoodMediaSnapshot, parseGoodsMediaMetadata, parseGoodsMediaPath, parseGoodsMediaSettings, type GoodMediaSnapshot, type GoodsMediaAsset, type GoodsMediaKind, type GoodsMediaSettingsSnapshot } from '@/lib/goods-media';
import { inspectAndNormalizeGoodsVideo } from './goods-video-parser.server';

export async function loadAdminGoodMedia(goodId: string): Promise<GoodMediaSnapshot | null> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_good_media', { p_good_id: goodId });
    if (!error && data === null) return null;
    const parsed = !error ? parseGoodMediaSnapshot(data) : null; if (parsed) return parsed;
  } catch { /* A failed read must never become an editable empty snapshot. */ }
  return { goodId, goodName: goodId, revision: 0, video: null, shortclip: null, unavailable: true };
}
export async function loadAdminGoodsMediaSettings(): Promise<GoodsMediaSettingsSnapshot> {
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_goods_media_settings');
    const values = !error ? parseGoodsMediaSettings(data?.values) : null;
    if (values && Number.isSafeInteger(data.revision) && data.revision >= 0) return { values, revision: data.revision };
  } catch { /* Keep reads fail closed. */ }
  return { values: { ...DEFAULT_GOODS_MEDIA_SETTINGS }, revision: 0, unavailable: true };
}

export type GoodsMediaVerification = { ok: true; asset: GoodsMediaAsset } | { ok: false; error: string; uncertain?: boolean };
const uncertainVerification = (): GoodsMediaVerification => ({ ok: false, error: '영상 확인 결과를 아직 알 수 없습니다. 같은 업로드 결과를 다시 확인해주세요.', uncertain: true });
export async function cancelGoodsMediaUpload(actorId: string, id: string): Promise<void> {
  try { const service = createServiceClient(); await service.rpc('service_cancel_goods_media_upload', { p_actor_id: actorId, p_id: id }); }
  catch { /* The bounded expiry and cleanup job are the fallback. */ }
}
export async function prepareGoodsMediaUpload(actorId: string, id: string, kind: GoodsMediaKind, size: number): Promise<{ id: string; path: string } | null> {
  const service = createServiceClient(), { data, error } = await service.rpc('service_prepare_goods_media_upload', { p_actor_id: actorId, p_id: id, p_kind: kind, p_source_size: size });
  const path = parseGoodsMediaPath(data?.path);
  if (error || !path || data.id !== id || data.kind !== kind || data.sourceSize !== size) return null;
  return { id, path: path.path };
}
function verifiedAsset(claim: { id: string; path: string; kind: GoodsMediaKind }, metadata: unknown): GoodsMediaAsset | null {
  const parsed = parseGoodsMediaMetadata(metadata), url = goodsVideoUrl(claim.path);
  return parsed && url ? { ...claim, ...parsed, url, title: claim.kind === 'video' ? '상품 동영상' : '상품 숏클립' } : null;
}
export async function verifyAndPromoteGoodsMedia(actorId: string, id: string): Promise<GoodsMediaVerification> {
  const service = createServiceClient();
  let data: Record<string, unknown>;
  try {
    const result = await service.rpc('service_begin_goods_media_verification', { p_actor_id: actorId, p_id: id });
    if (result.error || !result.data) return { ok: false, error: '영상 업로드가 만료되었거나 현재 권한으로 확인할 수 없습니다. 다시 업로드해주세요.' };
    data = result.data;
  } catch { return uncertainVerification(); }
  if (data.status === 'processing') return uncertainVerification();
  const path = parseGoodsMediaPath(data.path);
  if (!path || data.id !== id || path.id !== id || data.kind !== path.kind || !Number.isSafeInteger(data.sourceSize)) return uncertainVerification();
  const claim = { id, path: path.path, kind: path.kind };
  if (data.status === 'verified' || data.status === 'attached') {
    const asset = verifiedAsset(claim, data.metadata); return asset ? { ok: true, asset } : uncertainVerification();
  }
  if (data.status !== 'claimed') return uncertainVerification();
  try {
    const staging = service.storage.from(GOODS_MEDIA_STAGING_BUCKET), info = await staging.info(claim.path);
    if (info.error || !info.data || info.data.contentType !== 'video/mp4' || info.data.size !== data.sourceSize) {
      await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '업로드된 파일 형식과 크기가 일치하지 않습니다. 다시 업로드해주세요.' };
    }
    const download = await staging.download(claim.path);
    if (download.error || !download.data || download.data.size !== data.sourceSize) {
      await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '영상 파일을 읽지 못했습니다. 다시 업로드해주세요.' };
    }
    const normalized = inspectAndNormalizeGoodsVideo(new Uint8Array(await download.data.arrayBuffer()));
    if (!normalized) {
      await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '지원하는 MP4 영상인지 확인해주세요. H.264·AAC, 1분 이하, 가로·세로 1920px 이하만 등록할 수 있습니다.' };
    }
    const upload = await service.storage.from(GOODS_MEDIA_BUCKET).upload(claim.path, normalized.bytes, { contentType: 'video/mp4', upsert: false, cacheControl: '3600' });
    if (upload.error) { await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '영상을 저장하지 못했습니다. 다시 업로드해주세요.' }; }
    let verification: Awaited<ReturnType<typeof service.rpc>>;
    try { verification = await service.rpc('service_verify_goods_media_upload', { p_actor_id: actorId, p_id: id, p_metadata: normalized.metadata }); }
    catch { return uncertainVerification(); }
    // An unknown receipt must keep the asset: the verified transaction may have committed.
    if (verification.error?.code === '42501') { await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '영상 확인 중 상품 관리 권한이 변경되었습니다. 현재 권한을 다시 확인해주세요.' }; }
    if (verification.error) return uncertainVerification();
    if (verification.data !== true) { await cancelGoodsMediaUpload(actorId, id); return { ok: false, error: '영상 확인 중 권한이나 업로드 상태가 변경되었습니다. 다시 업로드해주세요.' }; }
    const removed = await service.storage.from(GOODS_MEDIA_STAGING_BUCKET).remove([claim.path]);
    if (!removed.error) await service.rpc('service_complete_goods_media_cleanup', { p_id: id, p_mode: 'staging' });
    const asset = verifiedAsset(claim, normalized.metadata); return asset ? { ok: true, asset } : uncertainVerification();
  } catch { return uncertainVerification(); }
}

export async function cleanupGoodsMediaUploads(limit = 20): Promise<{ candidates: number; completed: number } | null> {
  try {
    const service = createServiceClient(), { data, error } = await service.rpc('service_claim_goods_media_cleanup', { p_limit: Math.max(1, Math.min(50, Math.floor(limit))) });
    if (error || !Array.isArray(data)) return null;
    let completed = 0;
    for (const row of data) {
      const parsed = parseGoodsMediaPath(row.path); if (!parsed || row.id !== parsed.id || !['all', 'staging'].includes(row.mode)) return null;
      const staging = await service.storage.from(GOODS_MEDIA_STAGING_BUCKET).remove([parsed.path]);
      const stored = row.mode === 'all' ? await service.storage.from(GOODS_MEDIA_BUCKET).remove([parsed.path]) : { error: null };
      if (staging.error || stored.error) continue;
      const receipt = await service.rpc('service_complete_goods_media_cleanup', { p_id: row.id, p_mode: row.mode });
      if (!receipt.error && receipt.data === true) completed++;
    }
    return { candidates: data.length, completed };
  } catch { return null; }
}
