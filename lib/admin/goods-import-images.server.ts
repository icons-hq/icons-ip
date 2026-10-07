import 'server-only';
import { createHash } from 'node:crypto';
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
import {
  dropGoodsImportImage,
  GOODS_IMPORT_BUCKET,
  type GoodsImportGroup,
  type GoodsImportImage,
} from './goods-workbook';
import { SABANGNET_IMAGE_LIMIT } from './sabangnet-goods-format';
import {
  fetchRemoteImage,
  fetchRemoteImages,
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
function dropImage(patch: Record<string, unknown>, image: GoodsImportImage) {
  if (image.field.startsWith('gallery_'))
    patch.gallery_paths = ((patch.gallery_paths as string[]) ?? []).filter(
      (value) => value !== `import-image:${image.field}`,
    );
  else patch[image.field] = null;
}
async function cachePreparedImages(
  batch: GoodsImportBatch,
  index: number,
  patch: Record<string, unknown>,
) {
  const cached = await createServiceClient().rpc('service_cache_goods_import_images', {
    target_batch: batch.id,
    target_actor: batch.actor_id,
    target_index: index,
    target_images: patch,
  });
  if (cached.error) throw new Error('이미지 진행 상태를 저장하지 못했습니다.');
}
/** Verifies one image through the artwork pipeline, or asks the caller to wait for the verification budget. */
async function promoteImage(
  batch: GoodsImportBatch,
  image: GoodsImportImage,
  files: Map<string, Buffer>,
  save: (path: string) => Promise<void>,
): Promise<{ done: true } | { retryAfter: number }> {
  const bytes =
    image.kind === 'file'
      ? files.get(image.source)
      : (image.cached && files.get(image.cached)) || (await fetchGoodsImportImage(image.source));
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
    const uploaded = await createServiceClient()
      .storage.from('admin-artwork-staging')
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (uploaded.error) throw new Error('이미지를 저장하지 못했습니다.');
    const promoted = await verifyAndPromoteAdminArtwork(input);
    if (!promoted) {
      const retry = await verificationWait(batch.actor_id);
      if (retry) {
        await rejectAdminArtworkUpload({ actorId: batch.actor_id, path });
        return { retryAfter: retry };
      }
      throw new Error('이미지 크기·형식·내용을 확인해주세요.');
    }
    await save(promoted.imagePath);
    return { done: true };
  } catch (error) {
    await rejectAdminArtworkUpload({ actorId: batch.actor_id, path });
    throw error;
  }
}
/**
 * ICONS workbook groups fail as a product when an image cannot be verified.
 * Sabangnet groups are drafts: the failing image is left out and the saved prepared state
 * records it, so the result screen counts it with countDroppedGoodsImportImages.
 */
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
  for (const image of group.images) {
    const current = image.field.startsWith('gallery_')
      ? (patch.gallery_paths as string[]).find(
          (value) => value === `import-image:${image.field}`,
        )
      : patch[image.field];
    if (!current || !String(current).startsWith('import-image:')) continue;
    const wait = await verificationWait(batch.actor_id);
    if (wait) return { ready: false, retryAfter: wait };
    try {
      const outcome = await promoteImage(batch, image, files, async (path) => {
        patchImage(patch, image, path);
        await cachePreparedImages(batch, index, patch);
      });
      if ('retryAfter' in outcome) return { ready: false, retryAfter: outcome.retryAfter };
    } catch (error) {
      if (group.format !== 'sabangnet') throw error;
      dropImage(patch, image);
      await cachePreparedImages(batch, index, patch);
    }
  }
  return { ready: true };
}

/** Private batch object for an image file or a preview-time download. */
export function goodsImportFilePath(batch: Pick<GoodsImportBatch, 'actor_id' | 'id'>, name: string) {
  return `${batch.actor_id}/${batch.id}/images/${createHash('sha256').update(name).digest('hex')}`;
}
/** Leaves room in the 300-second preview action for planning and saving after downloads. */
export const SABANGNET_IMAGE_BUDGET_MS = 150_000;
const IMAGE_LABELS: Record<string, string> = {
  image_path: '대표 이미지',
  detail_image_path: '상세 이미지',
};
/**
 * Downloads every URL image of the valid groups once (SSRF-guarded, 4 at a time) into the
 * batch's private files. A failed image is removed from its draft with a warning, so the
 * product still saves and the operator adds the image in the product editor.
 */
export async function prefetchGoodsImportImages(
  batch: Pick<GoodsImportBatch, 'actor_id' | 'id'>,
  plan: GoodsImportGroup[],
  options: { deadline?: number; limit?: number } = {},
) {
  const sources = plan
    .filter((group) => group.kind === 'new' || group.kind === 'update')
    .flatMap((group) => group.images.filter((image) => image.kind === 'url').map((image) => image.source));
  const service = createServiceClient();
  const results = await fetchRemoteImages(
    sources,
    async (image, source) => {
      const name = `remote:${createHash('sha256').update(source).digest('hex')}`;
      const uploaded = await service.storage
        .from(GOODS_IMPORT_BUCKET)
        .upload(goodsImportFilePath(batch, name), image.bytes, {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      if (uploaded.error) throw new Error('가져온 이미지를 임시 저장하지 못했습니다.');
      return name;
    },
    {
      limit: options.limit ?? SABANGNET_IMAGE_LIMIT,
      deadline: options.deadline ?? Date.now() + SABANGNET_IMAGE_BUDGET_MS,
    },
  );
  for (const group of plan) {
    for (const image of [...group.images]) {
      if (image.kind !== 'url') continue;
      const result = results.get(image.source);
      if (!result) continue;
      if (result.ok) {
        image.cached = result.value;
        continue;
      }
      const label = IMAGE_LABELS[image.field] ?? `추가 이미지 ${Number(image.field.split('_')[1]) + 1}`;
      group.warnings.push(`${label}: ${result.error} 이 이미지는 빼고 초안을 만듭니다. 상품 편집에서 올려 주세요.`);
      dropGoodsImportImage(group, image.field);
    }
  }
  return results;
}
