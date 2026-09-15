import 'server-only';
import { loadAdminCategoryWorkspace } from './category.server';
import { loadActiveShippingNoticeTemplateOptions } from './shipping-notice-templates.server';
import { createClient } from '@/lib/supabase/server';
import { getAdminCatalogRecords } from './catalog.server';
import { loadAdminFulfillmentOrigins } from './fulfillment-origins.server';
import { loadAdminGoodsVariants } from './goods-variants.server';
import { loadAdminGoodsReadiness, parseGoodsReadiness } from './goods-readiness.server';
import { imageBg, publicMediaUrl } from '@/lib/media';
import type { Ip, Stock } from '@/lib/data';
import { GOODS_LIST_PAGE_SIZE, type AdminGoodsListData, type GoodsListFilters } from './goods-list';

export function goodsWorkspaceQuery(filters: GoodsListFilters) {
  return { p_query: filters.query, p_ip_id: filters.ipId, p_status: filters.status, p_stock: filters.stock,
    p_category_id: filters.categoryId || null, p_readiness: filters.readiness || 'all' };
}
const LIST_ERROR = '상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
interface WorkspaceRow {
  id: string; code: string; name: string; ipId: string; ipTitle: string;
  publishedAt: string | null; archivedAt: string | null; stock: Stock; stockQty: number;
  imagePath: string | null; categoryName: string | null;
  readiness: { activeStockQty: number; lowStockOptionCount: number; noticeComplete: boolean; priceMin: number | null; priceMax: number | null };
}
export async function loadAdminGoodsList(filters: GoodsListFilters): Promise<AdminGoodsListData> {
  const client = await createClient();
  const result = await client.rpc('admin_search_goods_workspace', { ...goodsWorkspaceQuery(filters),
    p_limit: GOODS_LIST_PAGE_SIZE, p_offset: (filters.page - 1) * GOODS_LIST_PAGE_SIZE });
  if (result.error || !result.data || !Number.isSafeInteger(result.data.total) || result.data.total < 0
    || !Array.isArray(result.data.rows)) throw new Error(LIST_ERROR);
  const total: number = result.data.total;
  const lastPage = Math.max(1, Math.ceil(total / GOODS_LIST_PAGE_SIZE));
  if (filters.page > lastPage) return loadAdminGoodsList({ ...filters, page: lastPage });
  const [ips, categories] = await Promise.all([
    (async () => {
      const rows: AdminGoodsListData['ips'] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await client.from('ips').select('id,title,archived_at').order('title').order('id').range(offset, offset + 999);
        if (page.error) throw new Error('IP 필터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        rows.push(...(page.data ?? []).map(ip => ({ id: ip.id, title: ip.title, archivedAt: ip.archived_at })));
        if ((page.data?.length ?? 0) < 1000) return rows;
      }
    })(),
    (async () => {
      const rows: NonNullable<AdminGoodsListData['categories']> = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await client.from('catalog_categories').select('id,name,depth,archived_at').order('sort_order').order('code').range(offset, offset + 999);
        if (page.error) throw new Error('카테고리 필터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        rows.push(...(page.data ?? []).map(category => ({ id: category.id, name: category.name, depth: category.depth, archivedAt: category.archived_at })));
        if ((page.data?.length ?? 0) < 1000) return rows;
      }
    })(),
  ]);
  return { filters, total, ips, categories, checkedAt: result.data.checkedAt,
    goods: (result.data.rows as WorkspaceRow[]).map(good => {
      const readiness = parseGoodsReadiness(good.readiness);
      return { id: good.id, code: good.code, name: good.name, ipId: good.ipId, ipTitle: good.ipTitle,
        publishedAt: good.publishedAt, archivedAt: good.archivedAt, stock: good.stock, stockQty: good.stockQty,
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
  const [records, variants, verticals, origins, categoryWorkspace, shippingNoticeOptions, readiness] = await Promise.all([
    getAdminCatalogRecords({ include: goodId ? ['goods', 'ips'] : ['ips'], ...(goodId ? { goodId } : {}) }),
    goodId ? loadAdminGoodsVariants(goodId) : Promise.resolve([]),
    supabase.from('verticals').select('key,label,color').order('key'),
    loadAdminFulfillmentOrigins(),
    loadAdminCategoryWorkspace(),
    loadActiveShippingNoticeTemplateOptions(),
    goodId ? loadAdminGoodsReadiness(goodId) : Promise.resolve(null),
  ]);
  if (verticals.error) throw new Error('상품 편집 정보를 불러오지 못했습니다.');
  // The preview needs IP presentation only, so avoid the public snapshot's full
  // goods/card/event catalogue and include draft IPs available to this editor.
  const catalogIps: Ip[] = records.ips.map((ip) => ({
    id: ip.id, title: ip.title, sub: ip.sub ?? '',
    v: (verticals.data ?? []).find((vertical) => vertical.key === ip.verticalKey)
      ?? { key: ip.verticalKey, label: ip.verticalKey, color: 'var(--wc-ink)' },
    glyph: ip.glyph ?? '', bg: ip.imageUrl ? imageBg(ip.imageUrl) : ip.bg ?? '',
    fans: ip.fansCount, goods: 0, cards: 0, featured: ip.featured,
    tagline: ip.tagline ?? '', synopsis: ip.synopsis ?? '',
  }));
  return { records, variants, catalogIps, origins, categories: categoryWorkspace.categories, shippingNoticeOptions, readiness };
}
