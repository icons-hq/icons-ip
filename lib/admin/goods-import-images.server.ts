import 'server-only';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { createServiceClient } from '@/lib/supabase/service';
import {
  ADMIN_ARTWORK_MAX_BYTES,
  buildAdminArtworkPath,
  type AdminArtworkMimeType,
} from './artwork';
import {
  createAdminArtworkUploadClaim,
  rejectAdminArtworkUpload,
  verifyAndPromoteAdminArtwork,
} from './artwork.server';
import type { GoodsImportBatch } from './goods-import.server';
import type { GoodsImportImage } from './goods-workbook';
export function isPublicImageAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function imageMime(bytes: Uint8Array): AdminArtworkMimeType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return 'image/png';
  if (
    Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}
/** DNS is checked once and the socket uses that exact address, including redirects. */
export async function fetchGoodsImportImage(
  source: string,
  redirects = 0,
): Promise<Buffer> {
  const url = new URL(source);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    redirects > 3
  )
    throw new Error('공개 HTTPS 이미지 URL만 사용할 수 있습니다.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('이미지 주소 확인 시간이 초과됐습니다.')),
        5000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some((result) => !isPublicImageAddress(result.address))
  )
    throw new Error('내부 네트워크 이미지 URL은 사용할 수 없습니다.');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        family: selected.family,
        lookup: (_host, _options, callback) =>
          callback(null, selected.address, selected.family),
        headers: {
          Accept: 'image/jpeg,image/png,image/webp',
          'User-Agent': 'ICONS-goods-import/1',
        },
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          fetchGoodsImportImage(
            new URL(response.headers.location, url).toString(),
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error('이미지 URL에서 파일을 내려받지 못했습니다.'));
          return;
        }
        if (
          Number(response.headers['content-length'] ?? 0) >
          ADMIN_ARTWORK_MAX_BYTES
        ) {
          response.destroy();
          reject(new Error('이미지는 5MB 이하여야 합니다.'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > ADMIN_ARTWORK_MAX_BYTES) {
            response.destroy(new Error('이미지는 5MB 이하여야 합니다.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(new Error('이미지 URL 응답 시간이 초과됐습니다.')),
    );
    req.on('error', reject);
    req.end();
  });
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
