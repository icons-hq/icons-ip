'use server';
import { createHash } from 'node:crypto';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { readBoundedZip } from '@/lib/admin/bounded-zip.server';
import { parseGoodsWorkbookWithKc } from '@/lib/admin/goods-workbook-file';
import {
  GOODS_IMPORT_BUCKET,
  GOODS_IMPORT_PATH,
  GOODS_IMAGES_ZIP_BYTES_LIMIT,
  GOODS_WORKBOOK_BYTES_LIMIT,
  planGoodsWorkbookImport,
} from '@/lib/admin/goods-workbook';
import {
  goodsImportView,
  acquireGoodsImportWork,
  releaseGoodsImportWork,
  loadGoodsImportBatch,
  loadGoodsWorkbookContext,
  type GoodsImportBatch,
} from '@/lib/admin/goods-import.server';
import { prepareGoodsImportImages } from '@/lib/admin/goods-import-images.server';

async function requireStaff() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user)
    redirect(`/login?next=${encodeURIComponent(GOODS_IMPORT_PATH)}`);
  if (!auth.isStaff)
    throw new Error('상품 엑셀 작업은 운영자만 할 수 있습니다.');
  return auth.user.id;
}
function safeError(error: unknown) {
  unstable_rethrow(error);
  const message = error instanceof Error ? error.message : '';
  return {
    ok: false as const,
    error: /[가-힣]/.test(message)
      ? message
      : '엑셀 작업을 완료하지 못했습니다. 현재 작업에서 다시 시도해주세요.',
  };
}
function imagePath(batch: GoodsImportBatch, name: string) {
  return `${batch.actor_id}/${batch.id}/images/${createHash('sha256').update(name).digest('hex')}`;
}
async function cleanupExpired() {
  const service = createServiceClient();
  const { data } = await service
    .from('admin_goods_imports')
    .select('id,actor_id')
    .lt('expires_at', new Date().toISOString())
    .limit(5);
  for (const batch of data ?? []) {
    const prefix = `${batch.actor_id}/${batch.id}`;
    const images = await service.storage
      .from(GOODS_IMPORT_BUCKET)
      .list(`${prefix}/images`, { limit: 1000 });
    if (images.error) continue;
    const removed = await service.storage
      .from(GOODS_IMPORT_BUCKET)
      .remove([
        `${prefix}/workbook.xlsx`,
        `${prefix}/images.zip`,
        ...(images.data ?? []).map((file) => `${prefix}/images/${file.name}`),
      ]);
    if (!removed.error)
      await service.from('admin_goods_imports').delete().eq('id', batch.id);
  }
}
export async function prepareGoodsImport(input: {
  name: string;
  size: number;
  imageName?: string;
  imageSize?: number;
}) {
  try {
    const actorId = await requireStaff();
    if (
      !input ||
      typeof input.name !== 'string' ||
      !/\.xlsx$/i.test(input.name) ||
      !Number.isInteger(input.size) ||
      input.size <= 0 ||
      input.size > GOODS_WORKBOOK_BYTES_LIMIT
    )
      throw new Error('상품 양식은 XLSX 형식의 2MB 이하 파일로 올려주세요.');
    if (
      input.imageName &&
      (!/\.zip$/i.test(input.imageName) ||
        !Number.isInteger(input.imageSize) ||
        input.imageSize! <= 0 ||
        input.imageSize! > GOODS_IMAGES_ZIP_BYTES_LIMIT)
    )
      throw new Error('이미지 ZIP은 50MB 이하로 올려주세요.');
    await cleanupExpired();
    const service = createServiceClient();
    const { data, error } = await service
      .from('admin_goods_imports')
      .insert({
        actor_id: actorId,
        workbook_name: input.name.slice(0, 200),
        has_images: Boolean(input.imageName),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error('업로드 작업을 준비하지 못했습니다.');
    return {
      ok: true as const,
      id: data.id as string,
      prefix: `${actorId}/${data.id}`,
    };
  } catch (error) {
    return safeError(error);
  }
}
async function downloadSource(
  batch: GoodsImportBatch,
  file: 'workbook.xlsx' | 'images.zip',
  max: number,
) {
  const client = await createClient();
  const { data, error } = await client.storage
    .from(GOODS_IMPORT_BUCKET)
    .download(`${batch.actor_id}/${batch.id}/${file}`);
  if (error || !data)
    throw new Error('업로드 파일을 읽지 못했습니다. 파일을 다시 올려주세요.');
  if (data.size > max) throw new Error('업로드 파일 용량이 상한을 초과합니다.');
  return Buffer.from(await data.arrayBuffer());
}
export async function previewGoodsImport(id: string) {
  try {
    const actorId = await requireStaff();
    const batch = await loadGoodsImportBatch(id, actorId);
    if (batch.state !== 'uploading')
      return { ok: true as const, view: goodsImportView(batch) };
    const { rows, kcRows } = await parseGoodsWorkbookWithKc(
      await downloadSource(batch, 'workbook.xlsx', GOODS_WORKBOOK_BYTES_LIMIT),
    );
    const files = batch.has_images
      ? await readBoundedZip(
          await downloadSource(
            batch,
            'images.zip',
            GOODS_IMAGES_ZIP_BYTES_LIMIT,
          ),
          {
            entries: 1000,
            totalBytes: 100 * 1024 * 1024,
            entryBytes: 5 * 1024 * 1024,
            imagesOnly: true,
          },
        )
      : new Map<string, Buffer>();
    const context = await loadGoodsWorkbookContext(rows);
    const plan = planGoodsWorkbookImport(rows, {
      ...context,
      kcRows,
      imageNames: [...files.keys()],
    });
    const service = createServiceClient();
    // Extract only referenced files once; confirming each product downloads just its images.
    const referenced = new Set(
      plan
        .filter((group) => group.kind !== 'error')
        .flatMap((group) =>
          group.images
            .filter((image) => image.kind === 'file')
            .map((image) => image.source),
        ),
    );
    for (const name of referenced) {
      const uploaded = await service.storage
        .from(GOODS_IMPORT_BUCKET)
        .upload(imagePath(batch, name), files.get(name)!, {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      if (uploaded.error)
        throw new Error(
          '미리보기용 이미지 파일을 준비하지 못했습니다. 다시 검증해주세요.',
        );
    }
    const saved = await service
      .from('admin_goods_imports')
      .update({ plan, state: 'ready' })
      .eq('id', id)
      .eq('actor_id', actorId)
      .eq('state', 'uploading');
    if (saved.error) throw new Error('검증 결과를 저장하지 못했습니다.');
    return {
      ok: true as const,
      view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
    };
  } catch (error) {
    return safeError(error);
  }
}
export async function commitNextGoodsImport(id: string) {
  try {
    const actorId = await requireStaff();
    const batch = await loadGoodsImportBatch(id, actorId);
    if (batch.state === 'uploading')
      throw new Error('파일 검증을 먼저 완료해주세요.');
    const index = batch.plan.findIndex((_, index) => !batch.results[index]);
    if (index < 0) return { ok: true as const, view: goodsImportView(batch) };
    const workToken = crypto.randomUUID();
    if (!(await acquireGoodsImportWork(id, actorId, workToken)))
      return {
        ok: true as const,
        view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
        retryAfter: 2000,
      };
    try {
      // Another tab may have finished a group between our first read and lease claim.
      const batch = await loadGoodsImportBatch(id, actorId);
      const index = batch.plan.findIndex((_, index) => !batch.results[index]);
      if (index < 0) return { ok: true as const, view: goodsImportView(batch) };
      const group = batch.plan[index];
      if (
        group.kind !== 'error' &&
        group.kind !== 'unchanged' &&
        group.images.length
      ) {
        try {
          const service = createServiceClient();
          const files = new Map<string, Buffer>();
          for (const image of group.images.filter(
            (image) => image.kind === 'file',
          )) {
            const downloaded = await service.storage
              .from(GOODS_IMPORT_BUCKET)
              .download(imagePath(batch, image.source));
            if (
              downloaded.error ||
              !downloaded.data ||
              downloaded.data.size > 5 * 1024 * 1024
            )
              throw new Error('이미지 파일을 읽지 못했습니다.');
            files.set(
              image.source,
              Buffer.from(await downloaded.data.arrayBuffer()),
            );
          }
          const images = await prepareGoodsImportImages(batch, index, files);
          if (!images.ready)
            return {
              ok: true as const,
              view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
              retryAfter: images.retryAfter,
            };
        } catch {
          // Missing verified images become a durable failed product through the same RPC.
        }
      }
      const client = await createClient();
      const saved = await client.rpc('admin_commit_goods_import_group', {
        target_batch: id,
        target_index: index,
      });
      if (saved.error)
        throw new Error(
          '적용 상태를 저장하지 못했습니다. 같은 작업에서 다시 시도해주세요.',
        );
      if (saved.data?.status === 'success') {
        for (const path of [
          '/admin/catalog/goods',
          '/admin/catalog/ips',
          '/shop',
          '/',
        ])
          revalidatePath(path);
        revalidatePath('/shop/[goodId]', 'page');
        revalidatePath('/ip/[ipId]', 'page');
      }
      return {
        ok: true as const,
        view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
      };
    } finally {
      await releaseGoodsImportWork(id, actorId, workToken);
    }
  } catch (error) {
    return safeError(error);
  }
}
