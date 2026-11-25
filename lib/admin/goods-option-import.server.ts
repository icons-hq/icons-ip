import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { publicMediaUrl } from '@/lib/media';
import { goodsConsoleFilterValues, normalizeGoodsListFilters } from './goods-list';
import { diagnoseGoodsOptionImportSource, goodsOptionImportTargetVersion, GoodsOptionImportError, GOODS_OPTION_IMPORT_PAGE_SIZE, type GoodsOptionImportFilters,
  type GoodsOptionImportPage, type GoodsOptionImportSource, type GoodsOptionImportTarget } from './goods-option-import';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const SOURCE_SELECT = 'id,code,name,price,archived_at,updated_at,goods_variants(id,name,attributes,price,archived_at,sort_order,updated_at)';
const TARGET_SELECT = 'id,price,compare_at_price,show_discount_rate,published_at,archived_at,goods_variants(id,code,name,attributes,price,stock_qty,low_stock_threshold,is_default,archived_at)';
const LOOKUP_ERROR = '상품과 옵션을 불러오지 못했습니다. 현재 입력은 유지됩니다.';

/**
 * Reuse the catalog's filtering/paging RPC; project away inventory and unrelated operational data.
 * `optionSourcesOnly`(옵션 불러오기 선택창)면 같은 검색에 "사용 중인 선택형 옵션이 있는 상품만" 조건을,
 * `noticeSourcesOnly`(고시 '다른 상품에서 복사' 선택창)면 "고시를 한 칸이라도 적어 둔 상품만" 조건을 건 전용 조회를 쓴다 —
 * 조회에서 걸러야 총 개수와 페이지가 맞는다(화면 규칙 2). 그 밖의 호출(상품 선택창·복사등록)은 지금까지와 같은 조회다.
 */
export async function searchGoodsOptionImportSources(filters: GoodsOptionImportFilters): Promise<GoodsOptionImportPage> {
  const client = await createClient();
  const offset = (filters.page - 1) * GOODS_OPTION_IMPORT_PAGE_SIZE;
  /* 두 전용 조회는 인자가 같다: 검색어·검색 대상·카테고리·뺄 상품·페이지. */
  const sourceSearch = filters.optionSourcesOnly ? 'admin_search_goods_option_sources' : filters.noticeSourcesOnly ? 'admin_search_goods_notice_sources' : null;
  const { data, error } = sourceSearch
    ? await client.rpc(sourceSearch, {
      p_query: filters.query, p_field: filters.field, p_category_id: filters.categoryId || null, p_exclude_good_id: filters.excludeGoodId ?? null,
      p_limit: GOODS_OPTION_IMPORT_PAGE_SIZE, p_offset: offset,
    })
    : await client.rpc('admin_search_goods_console', {
      p_query: filters.query, p_ip_id: '', p_status: 'active', p_stock: 'all', p_category_id: filters.categoryId || null, p_readiness: 'all',
      p_filters: goodsConsoleFilterValues(normalizeGoodsListFilters({ field: filters.field, sort: 'created_desc' })),
      p_limit: GOODS_OPTION_IMPORT_PAGE_SIZE, p_offset: offset,
    });
  const page = error ? null : goodsPickerPageFromSearch(data, filters.page);
  if (!page) throw new Error(LOOKUP_ERROR);
  const lastPage = goodsPickerLastPage(page.total);
  if (filters.page > lastPage) return searchGoodsOptionImportSources({ ...filters, page: lastPage });
  return page;
}

/** 조건에 맞는 상품 수로 마지막 페이지를 구한다(1부터). */
export function goodsPickerLastPage(total: number): number {
  return Math.max(1, Math.ceil(total / GOODS_OPTION_IMPORT_PAGE_SIZE));
}

/**
 * 상품 선택창 조회 함수(`admin_search_goods_console`·`admin_search_goods_option_sources`·`admin_search_goods_notice_sources`·`admin_search_goods_additional_candidates`)의
 * 응답 `{ total, rows }`을 선택창 한 페이지로 바꾼다. 재고·준비 상태 같은 운영 값은 싣지 않는다. 모양이 다르면 null.
 */
export function goodsPickerPageFromSearch(data: unknown, page: number): GoodsOptionImportPage | null {
  if (!record(data) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Array.isArray(data.rows) || data.rows.length > GOODS_OPTION_IMPORT_PAGE_SIZE) return null;
  const rows: GoodsOptionImportPage['rows'] = [];
  for (const row of data.rows) {
    if (!record(row) || typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string' || row.archivedAt !== null) return null;
    rows.push({ id: row.id, code: row.code, name: row.name, categoryName: typeof row.categoryName === 'string' ? row.categoryName : null,
      imageUrl: typeof row.imagePath === 'string' && row.imagePath ? publicMediaUrl(row.imagePath) : null, published: typeof row.publishedAt === 'string' });
  }
  return { rows, total: Number(data.total), page, pageSize: GOODS_OPTION_IMPORT_PAGE_SIZE };
}

async function readTargetVersion(targetId: string | null): Promise<string> {
  if (!targetId) return goodsOptionImportTargetVersion(null);
  const client = await createClient();
  const { data, error } = await client.from('goods').select(TARGET_SELECT).eq('id', targetId).maybeSingle();
  if (error || !record(data) || data.id !== targetId || !Array.isArray(data.goods_variants)) throw new Error(LOOKUP_ERROR);
  if (data.published_at !== null || data.archived_at !== null) throw new GoodsOptionImportError('지금 편집 중인 상품이 공개 중이거나 보관되어 다른 상품의 옵션을 불러올 수 없습니다. 비공개로 전환한 뒤 상품 화면을 다시 열어주세요.');
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
  /* 불러올 수 없으면 원인(사용 중 옵션 없음·옵션 없는 상품·옵션명 불일치·겹친 옵션값·100개 초과 등)을 가려 알린다. */
  const read = diagnoseGoodsOptionImportSource({ id: data.id, code: data.code, name: data.name, basePrice: data.price, version,
    rows: variants.map((row: Record<string, unknown>) => ({ name: row.name, attributes: row.attributes, price: row.price })) });
  if (!read.ok) throw new GoodsOptionImportError(read.error);
  return { source: read.source, targetVersion: await readTargetVersion(targetId) };
}
