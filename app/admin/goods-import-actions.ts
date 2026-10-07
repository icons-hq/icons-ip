'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { readBoundedZip } from '@/lib/admin/bounded-zip.server';
import {
  parseGoodsWorkbookWithKc,
  readSabangnetGoodsSheet,
} from '@/lib/admin/goods-workbook-file';
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
  loadGoodsImportIps,
  loadGoodsWorkbookContext,
  type GoodsImportBatch,
} from '@/lib/admin/goods-import.server';
import {
  goodsImportFilePath,
  prefetchGoodsImportImages,
  prepareGoodsImportImages,
} from '@/lib/admin/goods-import-images.server';
import {
  convertSabangnetRows,
  validateSabangnetTargets,
  type SabangnetTarget,
} from '@/lib/admin/sabangnet-goods-format';

async function requireStaff() {
  const auth = await requireAdminActionAccess(GOODS_IMPORT_PATH);
  if (!auth) throw new Error('상품 엑셀 작업은 운영자만 할 수 있습니다.');
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
const SABANGNET_XLS_MESSAGE =
  'XLS(Excel 97-2003) 파일은 읽을 수 없습니다. 엑셀에서 “Excel 통합 문서(.xlsx)”로 저장해 다시 올려 주세요.';
const SABANGNET_EXISTING_MESSAGE =
  '이미 등록된 상품코드입니다. 사방넷 양식은 새 상품 초안만 만듭니다. 기존 상품은 ICONS 양식으로 내려받아 수정해 주세요.';
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
  format?: 'icons' | 'sabangnet';
}) {
  try {
    const actorId = await requireStaff();
    if (input?.format === 'sabangnet') {
      if (typeof input.name === 'string' && /\.xls$/i.test(input.name))
        throw new Error(SABANGNET_XLS_MESSAGE);
      if (
        typeof input.name !== 'string' ||
        !/\.(xlsx|csv)$/i.test(input.name) ||
        !Number.isInteger(input.size) ||
        input.size <= 0 ||
        input.size > GOODS_WORKBOOK_BYTES_LIMIT
      )
        throw new Error('사방넷 상품 파일은 .xlsx 또는 .csv 형식의 2MB 이하 파일로 올려 주세요.');
      if (input.imageName)
        throw new Error('사방넷 양식은 이미지 주소로 이미지를 가져옵니다. 이미지 ZIP 없이 올려 주세요.');
    } else if (
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
        .upload(goodsImportFilePath(batch, name), files.get(name)!, {
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
      let skippedImages = 0;
      if (
        group.kind !== 'error' &&
        group.kind !== 'unchanged' &&
        group.images.length
      ) {
        try {
          const service = createServiceClient();
          const files = new Map<string, Buffer>();
          for (const image of group.images) {
            const name = image.kind === 'file' ? image.source : image.cached;
            if (!name || files.has(name)) continue;
            const downloaded = await service.storage
              .from(GOODS_IMPORT_BUCKET)
              .download(goodsImportFilePath(batch, name));
            if (
              downloaded.error ||
              !downloaded.data ||
              downloaded.data.size > 5 * 1024 * 1024
            ) {
              if (image.kind === 'file')
                throw new Error('이미지 파일을 읽지 못했습니다.');
              // A missing preview download falls back to the guarded live fetch.
              continue;
            }
            files.set(name, Buffer.from(await downloaded.data.arrayBuffer()));
          }
          const images = await prepareGoodsImportImages(batch, index, files);
          if (!images.ready)
            return {
              ok: true as const,
              view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
              retryAfter: images.retryAfter,
            };
          skippedImages = images.skipped;
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
        revalidateGoodsSurfaces();
        revalidatePath('/admin/catalog/ips');
      }
      return {
        ok: true as const,
        view: goodsImportView(await loadGoodsImportBatch(id, actorId)),
        ...(skippedImages && saved.data?.status === 'success'
          ? { skippedImages: { index, count: skippedImages } }
          : {}),
      };
    } finally {
      await releaseGoodsImportWork(id, actorId, workToken);
    }
  } catch (error) {
    return safeError(error);
  }
}

export async function inspectSabangnetGoodsImport(id: string) {
  try {
    const actorId = await requireStaff();
    const batch = await loadGoodsImportBatch(id, actorId);
    if (batch.state !== 'uploading')
      throw new Error('이미 미리보기를 만든 작업입니다. 다른 연결로 하려면 파일을 다시 올려 주세요.');
    const [sheet, ips] = await Promise.all([
      downloadSource(batch, 'workbook.xlsx', GOODS_WORKBOOK_BYTES_LIMIT).then(readSabangnetGoodsSheet),
      loadGoodsImportIps(),
    ]);
    return {
      ok: true as const,
      inspection: {
        id: batch.id,
        fileName: batch.workbook_name,
        headerRow: sheet.headerRow,
        rowCount: sheet.rows.length,
        columns: sheet.headers.map((header, column) => {
          const values = [
            ...new Set(sheet.rows.map((row) => (row.cells[column] ?? '').trim()).filter(Boolean)),
          ];
          return {
            header,
            sample: (values[0] ?? '').slice(0, 80),
            // Short value lists let the screen offer per-brand IP choices.
            ...(values.length <= 30 && values.every((value) => value.length <= 80) ? { values } : {}),
          };
        }),
        ips,
      },
    };
  } catch (error) {
    return safeError(error);
  }
}
export type SabangnetGoodsInspection = Extract<
  Awaited<ReturnType<typeof inspectSabangnetGoodsImport>>,
  { ok: true }
>['inspection'];

export async function previewSabangnetGoodsImport(
  id: string,
  input: { targets: SabangnetTarget[]; ipId: string; brandIps?: Record<string, string> },
) {
  try {
    const actorId = await requireStaff();
    if (
      !input ||
      !Array.isArray(input.targets) ||
      input.targets.length > 500 ||
      typeof input.ipId !== 'string' ||
      (input.brandIps !== undefined &&
        (!input.brandIps ||
          typeof input.brandIps !== 'object' ||
          Array.isArray(input.brandIps) ||
          Object.keys(input.brandIps).length > 200))
    )
      throw new Error('열 연결과 IP 선택을 다시 확인해 주세요.');
    const batch = await loadGoodsImportBatch(id, actorId);
    if (batch.state !== 'uploading')
      return { ok: true as const, view: goodsImportView(batch), ignoredColumns: [] as string[] };
    const [sheet, ips] = await Promise.all([
      downloadSource(batch, 'workbook.xlsx', GOODS_WORKBOOK_BYTES_LIMIT).then(readSabangnetGoodsSheet),
      loadGoodsImportIps(),
    ]);
    const targetError = validateSabangnetTargets(input.targets, sheet.headers);
    if (targetError) throw new Error(targetError);
    const ipIds = new Set(ips.map((ip) => ip.id));
    if (!ipIds.has(input.ipId)) throw new Error('새 상품을 연결할 IP를 골라 주세요.');
    const brandIps = Object.fromEntries(
      Object.entries(input.brandIps ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && ipIds.has(entry[1]),
      ),
    );
    const converted = convertSabangnetRows({
      headers: sheet.headers,
      rows: sheet.rows,
      targets: input.targets,
      ipId: input.ipId,
      brandIps,
    });
    const context = await loadGoodsWorkbookContext(converted.rows);
    // Sabangnet rows only start drafts; an existing code never turns into an overwrite.
    const existing = new Set(context.existing.map((record) => String(record.good.code).toUpperCase()));
    const flagged = new Set<number>();
    for (const row of converted.rows)
      if (row.values.code && existing.has(row.values.code) && !flagged.has(row.row)) {
        flagged.add(row.row);
        row.errors = [...(row.errors ?? []), SABANGNET_EXISTING_MESSAGE];
      }
    const plan = planGoodsWorkbookImport(converted.rows, { ...context, kcRows: null, imageNames: [] });
    for (const group of plan) {
      group.format = 'sabangnet';
      if (group.kind === 'update' || group.kind === 'unchanged') {
        group.kind = 'error';
        group.target = null;
        group.errors.push(SABANGNET_EXISTING_MESSAGE);
      }
      group.warnings = [
        ...new Set([...group.rows.flatMap((row) => converted.warnings.get(row) ?? []), ...group.warnings]),
      ];
    }
    await prefetchGoodsImportImages(batch, plan);
    const service = createServiceClient();
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
      ignoredColumns: converted.ignoredColumns,
    };
  } catch (error) {
    return safeError(error);
  }
}
