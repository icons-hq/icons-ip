import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { publicMediaUrl } from '@/lib/media';
import {
  exportGoodsWorkbookRows,
  partitionGoodsExports,
  type GoodsImportExisting,
  type GoodsImportGroup,
  type GoodsWorkbookContext,
  type GoodsWorkbookInputRow,
} from './goods-workbook';
import type { GoodsListFilters } from './goods-list';
export type GoodsImportResult = {
  status: 'success' | 'failed' | 'unchanged';
  id?: string;
  code?: string;
  error?: string;
};
export async function acquireGoodsImportWork(
  id: string,
  actorId: string,
  token: string,
) {
  const result = await createServiceClient().rpc(
    'service_acquire_goods_import_work',
    { target_batch: id, target_actor: actorId, target_token: token },
  );
  if (result.error)
    throw new Error('작업 진행 상태를 확인하지 못했습니다. 다시 시도해주세요.');
  return result.data === true;
}
export async function releaseGoodsImportWork(
  id: string,
  actorId: string,
  token: string,
) {
  try {
    await createServiceClient().rpc('service_release_goods_import_work', {
      target_batch: id,
      target_actor: actorId,
      target_token: token,
    });
  } catch {
    // A crashed request recovers at work_expires_at; product results remain durable.
  }
}
export type GoodsImportBatch = {
  id: string;
  actor_id: string;
  workbook_name: string;
  state: 'uploading' | 'ready' | 'complete';
  has_images: boolean;
  plan: GoodsImportGroup[];
  results: Record<string, GoodsImportResult>;
  prepared_images: Record<string, Record<string, unknown>>;
  expires_at: string;
};
export async function loadGoodsImportBatch(
  id: string,
  actorId: string,
): Promise<GoodsImportBatch> {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error('업로드 작업을 찾을 수 없습니다.');
  const client = await createClient();
  const { data, error } = await client
    .from('admin_goods_imports')
    .select('*')
    .eq('id', id)
    .eq('actor_id', actorId)
    .maybeSingle();
  if (error || !data) throw new Error('업로드 작업을 찾을 수 없습니다.');
  if (Date.parse(data.expires_at) <= Date.now())
    throw new Error(
      '업로드 작업의 24시간 유효기간이 지났습니다. 파일을 다시 올려주세요.',
    );
  return data as GoodsImportBatch;
}
export async function loadGoodsWorkbookContext(
  rows: GoodsWorkbookInputRow[] = [],
  ids: string[] = [],
): Promise<GoodsWorkbookContext> {
  const client = await createClient();
  const codes = [
    ...new Set(
      rows.map((row) => row.values.code.trim().toUpperCase()).filter(Boolean),
    ),
  ];
  const names = [
    ...new Set(rows.map((row) => row.values.preset).filter(Boolean)),
  ];
  const [records, origins, presets] = await Promise.all([
    client.rpc('admin_goods_import_records', {
      target_codes: codes,
      target_ids: ids,
    }),
    client.from('fulfillment_origins').select('id,code,is_active'),
    names.length
      ? client
          .from('goods_notice_presets')
          .select(
            'name,maker,origin,material,size,made_on,as_manager,as_contact',
          )
          .in('name', names)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (records.error || origins.error || presets.error)
    throw new Error(
      '현재 상품·배송·고시정보를 읽지 못했습니다. 다시 시도해주세요.',
    );
  const ips: GoodsWorkbookContext['ips'] = [];
  for (let start = 0; ; start += 1000) {
    const result = await client
      .from('ips')
      .select('id,archived_at')
      .order('id')
      .range(start, start + 999);
    if (result.error) throw new Error('IP 목록을 읽지 못했습니다.');
    ips.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) break;
  }
  return {
    existing: (records.data ?? []) as GoodsImportExisting[],
    origins: origins.data ?? [],
    ips,
    mediaUrl: publicMediaUrl,
    presets: (presets.data ?? []).map((row) => ({
      name: row.name,
      notice: {
        maker: row.maker,
        origin: row.origin,
        material: row.material,
        size: row.size,
        madeOn: row.made_on,
        asManager: row.as_manager,
        asContact: row.as_contact,
      },
    })),
  };
}
export async function loadGoodsExportParts(filters: GoodsListFilters) {
  const client = await createClient();
  const candidates: { id: string; rows: number }[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client
      .rpc('admin_goods_export_candidates', {
        search_text: filters.query,
        ip_filter: filters.ipId,
        status_filter: filters.status,
        stock_filter: filters.stock,
      })
      .order('good_id')
      .range(start, start + 999);
    if (error) throw new Error('내보낼 상품 목록을 읽지 못했습니다.');
    candidates.push(
      ...(data ?? []).map((row: { good_id: string; option_rows: number }) => ({
        id: row.good_id,
        rows: row.option_rows,
      })),
    );
    if ((data?.length ?? 0) < 1000) break;
  }
  return {
    parts: partitionGoodsExports(candidates),
    totalRows: candidates.reduce((total, row) => total + row.rows, 0),
    totalGoods: candidates.length,
  };
}
export async function loadGoodsExportRows(
  filters: GoodsListFilters,
  part: number,
) {
  const { parts } = await loadGoodsExportParts(filters);
  if (!Number.isInteger(part) || part < 1 || part > parts.length)
    throw new Error('내보내기 페이지를 다시 선택해주세요.');
  const context = await loadGoodsWorkbookContext([], parts[part - 1]);
  const rows = context.existing.flatMap((record) =>
    exportGoodsWorkbookRows(record, context),
  );
  if (rows.length > 500)
    throw new Error(
      '옵션 구성이 바뀌어 500행을 초과했습니다. 내보내기 페이지를 새로 열어주세요.',
    );
  return rows;
}
export function goodsImportErrorMessage(error?: string) {
  if (error?.includes('stock_changed'))
    return '미리보기 이후 재고가 바뀌었습니다. 최신 파일로 다시 검증해주세요.';
  if (error?.includes('changed') || error?.includes('conflict'))
    return '미리보기 이후 상품 정보가 바뀌었습니다. 최신 파일로 다시 검증해주세요.';
  if (error?.includes('duplicate') || error?.includes('code'))
    return '상품코드·옵션코드가 이미 사용 중이거나 형식이 올바르지 않습니다.';
  if (error?.includes('artwork') || error?.includes('images'))
    return '이미지를 저장하지 못했습니다. URL·ZIP 파일을 확인하고 다시 올려주세요.';
  if (error?.includes('publish') || error?.includes('origin'))
    return '공개 필수 정보·이미지·출고지 설정을 확인해주세요.';
  return '상품 정보를 저장하지 못했습니다. 실패 행의 필수 정보와 옵션 구성을 확인하고 다시 올려주세요.';
}
export function goodsImportView(batch: GoodsImportBatch) {
  return {
    id: batch.id,
    fileName: batch.workbook_name,
    state: batch.state,
    groups: batch.plan.map((group, index) => ({
      index,
      code: group.code,
      name: group.name,
      rows: group.rows,
      kind: group.kind,
      errors: group.errors,
      warnings: group.warnings,
      result: batch.results[index]
        ? {
            ...batch.results[index],
            ...(batch.results[index].status === 'failed'
              ? { error: goodsImportErrorMessage(batch.results[index].error) }
              : {}),
          }
        : null,
    })),
  };
}
