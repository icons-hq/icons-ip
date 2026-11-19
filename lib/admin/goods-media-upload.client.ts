'use client';
import { cancelGoodsMediaAction, prepareGoodsMediaAction, verifyGoodsMediaAction } from '@/app/admin/goods-media-actions';
import { createClient } from '@/lib/supabase/client';
import { GOODS_MEDIA_FILE_ERROR, GOODS_MEDIA_STAGING_BUCKET, validGoodsMediaUpload, type GoodsMediaKind } from '@/lib/goods-media';
import type { GoodsMediaVerification } from './goods-media.server';

export type GoodsMediaUploadResult = GoodsMediaVerification & { uploadId?: string };
export async function uploadGoodsMedia(kind: GoodsMediaKind, file: File, id = crypto.randomUUID()): Promise<GoodsMediaUploadResult> {
  if (!validGoodsMediaUpload({ kind, mimeType: file.type, size: file.size })) return { ok: false, error: GOODS_MEDIA_FILE_ERROR };
  let prepared = false, uploaded = false;
  try {
    const grant = await prepareGoodsMediaAction({ id, kind, mimeType: file.type, size: file.size }); if (!grant.ok) return grant;
    prepared = true;
    const result = await createClient().storage.from(GOODS_MEDIA_STAGING_BUCKET).upload(grant.path, file, { contentType: 'video/mp4', upsert: false });
    if (result.error) { await cancelGoodsMediaAction(id); return { ok: false, error: '영상 전송을 완료하지 못했습니다. 다시 업로드해주세요.' }; }
    uploaded = true;
    const verified = await verifyGoodsMediaAction(id); return { ...verified, uploadId: id };
  } catch {
    if (prepared && !uploaded) { try { await cancelGoodsMediaAction(id); } catch { /* Expiry cleanup remains available. */ } }
    return uploaded ? { ok: false, error: '영상 확인이 아직 끝나지 않았습니다. 잠시 뒤 [같은 업로드 결과 확인]을 눌러주세요. 다시 올리지 않아도 됩니다.', uncertain: true, uploadId: id }
      : { ok: false, error: '영상 전송을 완료하지 못했습니다. 다시 업로드해주세요.' };
  }
}
