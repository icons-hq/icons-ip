import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { publicMediaUrl } from '@/lib/media';
import { goodsConsoleFilterValues, normalizeGoodsListFilters } from './goods-list';
import { goodsOptionImportTargetVersion, parseGoodsOptionImportSource, GOODS_OPTION_IMPORT_PAGE_SIZE, type GoodsOptionImportFilters,
  type GoodsOptionImportPage, type GoodsOptionImportSource, type GoodsOptionImportTarget } from './goods-option-import';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const SOURCE_SELECT = 'id,code,name,price,archived_at,updated_at,goods_variants(id,name,attributes,price,archived_at,sort_order,updated_at)';
const TARGET_SELECT = 'id,price,compare_at_price,show_discount_rate,published_at,archived_at,goods_variants(id,code,name,attributes,price,stock_qty,low_stock_threshold,is_default,archived_at)';
const LOOKUP_ERROR = '상품과 옵션을 불러오지 못했습니다. 현재 입력은 유지됩니다.';

/** Reuse the catalog's filtering/paging RPC; project away inventory and unrelated operational data. */
export async function searchGoodsOptionImportSources(filters: GoodsOptionImportFilters): Promise<GoodsOptionImportPage> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_goods_console', {
    p_query: filters.query, p_ip_id: '', p_status: 'active', p_stock: 'all', p_category_id: filters.categoryId || null, p_readiness: 'all',
    p_filters: goodsConsoleFilterValues(normalizeGoodsListFilters({ field: filters.field, sort: 'created_desc' })),
    p_limit: GOODS_OPTION_IMPORT_PAGE_SIZE, p_offset: (filters.page - 1) * GOODS_OPTION_IMPORT_PAGE_SIZE,
  });
  if (error || !record(data) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Array.isArray(data.rows) || data.rows.length > GOODS_OPTION_IMPORT_PAGE_SIZE) throw new Error(LOOKUP_ERROR);
  const lastPage = Math.max(1, Math.ceil(Number(data.total) / GOODS_OPTION_IMPORT_PAGE_SIZE));
  if (filters.page > lastPage) return searchGoodsOptionImportSources({ ...filters, page: lastPage });
  const rows = data.rows.map(row => {
    if (!record(row) || typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string' || row.archivedAt !== null) throw new Error(LOOKUP_ERROR);
    return { id: row.id, code: row.code, name: row.name, categoryName: typeof row.categoryName === 'string' ? row.categoryName : null,
      imageUrl: typeof row.imagePath === 'string' && row.imagePath ? publicMediaUrl(row.imagePath) : null, published: typeof row.publishedAt === 'string' };
  });
  return { rows, total: Number(data.total), page: filters.page, pageSize: GOODS_OPTION_IMPORT_PAGE_SIZE };
}

async function readTargetVersion(targetId: string | null): Promise<string> {
  if (!targetId) return goodsOptionImportTargetVersion(null);
  const client = await createClient();
  const { data, error } = await client.from('goods').select(TARGET_SELECT).eq('id', targetId).maybeSingle();
  if (error || !record(data) || data.id !== targetId || !Array.isArray(data.goods_variants)) throw new Error(LOOKUP_ERROR);
  if (data.published_at !== null || data.archived_at !== null) throw new Error('옵션을 불러올 상품이 공개 중이거나 보관되었습니다. 비공개 상품으로 전환한 뒤 다시 열어주세요.');
  // ERP identities live in a private table, so the same existing read RPC used by the editor supplies this part of the baseline.
  const identities = await client.rpc('admin_list_goods_variant_external_identities', { target_good_id: targetId });
  if (identities.error || !Array.isArray(identities.data) || identities.data.some(row => !record(row) || row.good_id !== targetId || typeof row.variant_id !== 'string')) throw new Error(LOOKUP_ERROR);
  const external = new Map(identities.data.map(row => [row.variant_id, row]));
  const target: GoodsOptionImportTarget = { id: targetId, publishedAt: null, archivedAt: null, price: Number(data.price), compareAtPrice: data.compare_at_price as number | null,
    showDiscountRate: data.show_discount_rate !== false, variants: data.goods_variants.map((row: Record<string, unknown>) => {
      const identity = external.get(row.id as string);
      return { id: row.id as string, code: row.code as string,
        name: row.name as string, attributes: row.attributes as Record<string, string>, price: row.price as number, stockQty: row.stock_qty as number,
        lowStockThreshold: row.low_stock_threshold as number | null, isDefault: row.is_default as boolean, archivedAt: row.archived_at as string | null,
        erpCode: typeof identity?.erp_code === 'string' ? identity.erp_code : null, erpName: typeof identity?.erp_name === 'string' ? identity.erp_name : null,
        barcode: typeof identity?.barcode === 'string' ? identity.barcode : null, externalUpdatedAt: typeof identity?.updated_at === 'string' ? identity.updated_at : null };
    }) };
  return goodsOptionImportTargetVersion(target);
}

/** One embedded goods/variant query gives a consistent stored base price and option-price snapshot. */
export async function readGoodsOptionImportSource(sourceId: string, targetId: string | null): Promise<{ source: GoodsOptionImportSource; targetVersion: string }> {
  const client = await createClient();
  const { data, error } = await client.from('goods').select(SOURCE_SELECT).eq('id', sourceId).maybeSingle();
  if (error || !record(data) || data.id !== sourceId || data.archived_at !== null || !Array.isArray(data.goods_variants)) throw new Error(LOOKUP_ERROR);
  const variants = data.goods_variants.filter((row: Record<string, unknown>) => row.archived_at === null)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.sort_order) - Number(b.sort_order) || String(a.id).localeCompare(String(b.id)));
  const version = createHash('sha256').update(JSON.stringify([data.id, data.code, data.name, data.price, data.updated_at, variants])).digest('hex');
  const source = parseGoodsOptionImportSource({ id: data.id, code: data.code, name: data.name, basePrice: data.price, version,
    rows: variants.map((row: Record<string, unknown>) => ({ name: row.name, attributes: row.attributes, price: row.price })) });
  if (!source) throw new Error('이 상품에는 불러올 수 있는 선택형 옵션이 없습니다. 옵션 구성과 일반 저장 금액을 확인해주세요.');
  return { source, targetVersion: await readTargetVersion(targetId) };
}
