import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import {
  ADMIN_ARTWORK_MAX_BYTES,
  buildAdminArtworkPath,
} from './artwork';
import {
  createAdminArtworkUploadClaim,
  rejectAdminArtworkUpload,
  verifyAndPromoteAdminArtwork,
} from './artwork.server';
import type { GoodsImportBatch } from './goods-import.server';
import type { GoodsImportImage } from './goods-workbook';
import {
  fetchRemoteImage,
  isPublicImageAddress,
  sniffImageMime,
} from './remote-image-fetch.server';

export { isPublicImageAddress };
export const imageMime = sniffImageMime;
/** URL images share the SSRF-guarded fetcher: pinned DNS, https only, per-hop redirect checks. */
export async function fetchGoodsImportImage(source: string): Promise<Buffer> {
  return (await fetchRemoteImage(source)).bytes;
}
async function verificationWait(actorId: string) {
  const service = createServiceClient();
  const { data, error } = await service
    .from('admin_artwork_upload_claims')
    .select('processing_started_at')
    .eq('actor_id', actorId)
    .gte('processing_started_at', new Date(Date.now() - 60000).toISOString())
    .order('processing_started_at')
    .limit(12);
  if (error) throw new Error('이미지 검증 상태를 읽지 못했습니다.');
  return (data?.length ?? 0) >= 12
    ? Math.max(
        1000,
        Date.parse(data![0].processing_started_at) + 61000 - Date.now(),
      )
    : 0;
}
function patchImage(
  patch: Record<string, unknown>,
  image: GoodsImportImage,
  path: string,
) {
  if (image.field.startsWith('gallery_')) {
    const values = [...((patch.gallery_paths as string[]) ?? [])];
    const index = values.findIndex(
      (value) => value === `import-image:${image.field}`,
    );
    if (index >= 0) values[index] = path;
    patch.gallery_paths = values;
  } else patch[image.field] = path;
}
export async function prepareGoodsImportImages(
  batch: GoodsImportBatch,
  index: number,
  files: Map<string, Buffer>,
): Promise<{ ready: true } | { ready: false; retryAfter: number }> {
  const group = batch.plan[index];
  if (!group?.target) return { ready: true };
  const patch: Record<string, unknown> = {
    image_path: group.target.image_path,
    gallery_paths: group.target.gallery_paths,
    detail_image_path: group.target.detail_image_path,
    ...batch.prepared_images[index],
  };
  const service = createServiceClient();
  for (const image of group.images) {
    const current = image.field.startsWith('gallery_')
      ? (patch.gallery_paths as string[]).find(
          (value) => value === `import-image:${image.field}`,
        )
      : patch[image.field];
    if (!current || !String(current).startsWith('import-image:')) continue;
    const wait = await verificationWait(batch.actor_id);
    if (wait) return { ready: false, retryAfter: wait };
    const bytes =
      image.kind === 'file'
        ? files.get(image.source)
        : await fetchGoodsImportImage(image.source);
    const mimeType = bytes ? imageMime(bytes) : null;
    if (!bytes || !mimeType || bytes.length > ADMIN_ARTWORK_MAX_BYTES)
      throw new Error(
        '이미지 파일은 JPEG/PNG/WebP 형식의 5MB 이하 파일이어야 합니다.',
      );
    const path = buildAdminArtworkPath({
      kind: 'good',
      mimeType,
      nonce: crypto.randomUUID(),
    });
    const input = {
      actorId: batch.actor_id,
      kind: 'good' as const,
      mimeType,
      path,
      size: bytes.length,
    };
    if (!(await createAdminArtworkUploadClaim(input)))
      throw new Error('이미지 업로드를 준비하지 못했습니다.');
    try {
      const uploaded = await service.storage
        .from('admin-artwork-staging')
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      if (uploaded.error) throw new Error('이미지를 저장하지 못했습니다.');
      const promoted = await verifyAndPromoteAdminArtwork(input);
      if (!promoted) {
        const retry = await verificationWait(batch.actor_id);
        if (retry) {
          await rejectAdminArtworkUpload({ actorId: batch.actor_id, path });
          return { ready: false, retryAfter: retry };
        }
        throw new Error('이미지 크기·형식·내용을 확인해주세요.');
      }
      patchImage(patch, image, promoted.imagePath);
      const cached = await service.rpc('service_cache_goods_import_images', {
        target_batch: batch.id,
        target_actor: batch.actor_id,
        target_index: index,
        target_images: patch,
      });
      if (cached.error)
        throw new Error('이미지 진행 상태를 저장하지 못했습니다.');
    } catch (error) {
      await rejectAdminArtworkUpload({ actorId: batch.actor_id, path });
      throw error;
    }
  }
  return { ready: true };
}
