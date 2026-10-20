import 'server-only';
import { loadGoodsEditorOwnership } from './goods-group-common.server';
import { loadGoodsCategoryOptions } from './category.server';
import { loadActiveShippingNoticeTemplateOptions } from './shipping-notice-templates.server';
import { createClient } from '@/lib/supabase/server';
import { getAdminCatalogRecords, type AdminIpRecord } from './catalog.server';
import { loadGoodsFulfillmentOptions } from './fulfillment-origins.server';
import { loadAdminGoodsVariants } from './goods-variants.server';
import { loadAdminGoodsReadiness, parseGoodsReadiness } from './goods-readiness.server';
import { imageBg, imageUrlFromBg, publicMediaUrl } from '@/lib/media';
import type { Ip, Stock } from '@/lib/data';
import { goodsListPageSize, goodsConsoleFilterValues, type AdminGoodsListData, type GoodsListFilters } from './goods-list';

export function goodsWorkspaceQuery(filters: GoodsListFilters) {
  return { p_query: filters.query, p_ip_id: filters.ipId, p_status: filters.status, p_stock: filters.stock,
    p_category_id: filters.categoryId || null, p_readiness: filters.readiness || 'all' };
}
const LIST_ERROR = '상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
interface WorkspaceRow {
  id: string; code: string; name: string; ipId: string; ipTitle: string;
  publishedAt: string | null; archivedAt: string | null; stock: Stock; stockQty: number;
  imagePath: string | null; categoryName: string | null;
  createdAt: string; updatedAt: string;
  readiness: { activeStockQty: number; lowStockOptionCount: number; noticeComplete: boolean; priceMin: number | null; priceMax: number | null };
}
export async function loadAdminGoodsList(filters: GoodsListFilters): Promise<AdminGoodsListData> {
  const client = await createClient();
  const pageSize = goodsListPageSize(filters.pageSize);
  const result = await client.rpc('admin_search_goods_console', { ...goodsWorkspaceQuery(filters),
    p_filters: goodsConsoleFilterValues(filters), p_limit: pageSize, p_offset: (filters.page - 1) * pageSize });
  if (result.error || !result.data || !Number.isSafeInteger(result.data.total) || result.data.total < 0
    || !Array.isArray(result.data.rows)) throw new Error(LIST_ERROR);
  const total: number = result.data.total;
  const counts = result.data.statusCounts;
  if (!counts || ['all', 'active', 'draft', 'published', 'archived'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) throw new Error(LIST_ERROR);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (filters.page > lastPage) return loadAdminGoodsList({ ...filters, page: lastPage });
  const [ips, categories, origins] = await Promise.all([
    loadGoodsIpOptions().then(rows => rows.map(ip => ({ id: ip.id, title: ip.title, archivedAt: ip.archivedAt }))),
    (async () => {
      const rows: NonNullable<AdminGoodsListData['categories']> = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await client.from('catalog_categories').select('id,name,depth,archived_at').order('sort_order').order('code').range(offset, offset + 999);
        if (page.error) throw new Error('카테고리 필터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        rows.push(...(page.data ?? []).map(category => ({ id: category.id, name: category.name, depth: category.depth, archivedAt: category.archived_at })));
        if ((page.data?.length ?? 0) < 1000) return rows;
      }
    })(),
    loadGoodsFulfillmentOptions().then(rows => rows.map(origin => ({ id: origin.id, name: origin.name, active: origin.active }))),
  ]);
  return { filters, total, pageSize, counts, ips, categories, origins, checkedAt: result.data.checkedAt,
    goods: (result.data.rows as WorkspaceRow[]).map(good => {
      const readiness = parseGoodsReadiness(good.readiness);
      return { id: good.id, code: good.code, name: good.name, ipId: good.ipId, ipTitle: good.ipTitle,
        publishedAt: good.publishedAt, archivedAt: good.archivedAt, stock: good.stock, stockQty: good.stockQty,
        createdAt: good.createdAt, updatedAt: good.updatedAt,
        activeStockQty: good.readiness.activeStockQty, lowStockOptionCount: good.readiness.lowStockOptionCount,
        saleAvailableQty: readiness.availableQty ?? undefined, noticeComplete: good.readiness.noticeComplete,
        imageUrl: good.imagePath ? publicMediaUrl(good.imagePath) : null, categoryName: good.categoryName,
        priceMin: good.readiness.priceMin, priceMax: good.readiness.priceMax, readiness };
    }),
  };
}

/** Editor requests one good and its options; opening the list never loads these. */
export async function loadAdminGoodEditor(goodId?: string) {
  const supabase = await createClient();
  const [records, ipOptions, variants, verticals, origins, categories, shippingNoticeOptions, readiness, ownership] = await Promise.all([
    getAdminCatalogRecords({ include: goodId ? ['goods'] : [], ...(goodId ? { goodId } : {}) }),
    loadGoodsIpOptions(),
    goodId ? loadAdminGoodsVariants(goodId) : Promise.resolve([]),
    supabase.from('verticals').select('key,label,color').order('key'),
    loadGoodsFulfillmentOptions(),
    loadGoodsCategoryOptions(),
    loadActiveShippingNoticeTemplateOptions(),
    goodId ? loadAdminGoodsReadiness(goodId) : Promise.resolve(null),
    goodId ? loadGoodsEditorOwnership(goodId) : Promise.resolve(null),
  ]);
  if (verticals.error) throw new Error('상품 편집 정보를 불러오지 못했습니다.');
  // The preview needs IP presentation only, so avoid the public snapshot's full
  // goods/card/event catalogue and include draft IPs available to this editor.
  const catalogIps: Ip[] = ipOptions.map((ip) => ({
    id: ip.id, title: ip.title, sub: ip.sub ?? '',
    v: (verticals.data ?? []).find((vertical) => vertical.key === ip.verticalKey)
      ?? { key: ip.verticalKey, label: ip.verticalKey, color: 'var(--wc-ink)' },
    glyph: ip.glyph ?? '', bg: ip.imageUrl ? imageBg(ip.imageUrl) : ip.bg ?? '',
    fans: ip.fansCount, goods: 0, cards: 0, featured: ip.featured,
    tagline: ip.tagline ?? '', synopsis: ip.synopsis ?? '',
  }));
  const goods = records.goods.map(good => ownership?.goodId === good.id && !ownership.aggregation.editable ? { ...good, ...ownership.aggregation.sharedPolicy } : good);
  return { ownership, records: { ...records, goods, ips: ipOptions }, variants, catalogIps, origins, categories, shippingNoticeOptions, readiness };
}

/** IP presentation for product selection, without the IP operating workspace. */
export async function loadGoodsIpOptions(): Promise<AdminIpRecord[]> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_goods_ip_options');
  if (error || !Array.isArray(data)) throw new Error('상품 IP 선택지를 불러오지 못했습니다.');
  return data.map(row => ({ id: row.id, title: row.title, publicSlug: row.publicSlug,
    archivedAt: row.archivedAt, publishedAt: row.publishedAt, verticalKey: row.verticalKey,
    sub: row.sub, glyph: row.glyph, bg: row.bg, imagePath: row.imagePath,
    imageUrl: row.imagePath ? publicMediaUrl(row.imagePath) : imageUrlFromBg(row.bg),
    tagline: null, synopsis: null, featured: false, fansCount: 0 }));
}
