import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getAdminCatalogRecords } from './catalog.server';
import { loadAdminFulfillmentOrigins } from './fulfillment-origins.server';
import { loadAdminGoodsVariants } from './goods-variants.server';
import { imageBg } from '@/lib/media';
import type { Ip, Stock } from '@/lib/data';
import { GOODS_LIST_PAGE_SIZE, type AdminGoodsListData, type GoodsListFilters } from './goods-list';

interface GoodsListRow {
  id: string; code: string; name: string; ip_id: string;
  published_at: string | null; archived_at: string | null;
  notice_maker: string | null; notice_origin: string | null; notice_material: string | null; notice_size: string | null;
  notice_made_on: string | null; notice_as_manager: string | null; notice_as_contact: string | null;
  stock: Stock; stock_qty: number; ip: { title: string };
}

export async function loadAdminGoodsList(filters: GoodsListFilters): Promise<AdminGoodsListData> {
  const supabase = await createClient();
  let query = supabase.rpc('admin_search_goods', { search_text: filters.query }, { count: 'exact' })
    .select('id,code,name,ip_id,published_at,archived_at,stock,stock_qty,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact,ip:ips!inner(title)');
  if (filters.ipId) query = query.eq('ip_id', filters.ipId);
  if (filters.status === 'archived') query = query.not('archived_at', 'is', null);
  else if (filters.status !== 'all') {
    query = query.is('archived_at', null);
    if (filters.status === 'draft') query = query.is('published_at', null);
    if (filters.status === 'published') query = query.not('published_at', 'is', null);
  }
  // Match the public effective stock: zero quantity is sold out even when the
  // operator has not manually switched the display status to soldout.
  if (filters.stock === 'soldout') query = query.or('stock.eq.soldout,stock_qty.eq.0');
  else if (filters.stock !== 'all') query = query.eq('stock', filters.stock).gt('stock_qty', 0);
  const result = await query.order('id')
    .range((filters.page - 1) * GOODS_LIST_PAGE_SIZE, filters.page * GOODS_LIST_PAGE_SIZE - 1);
  if (result.error) throw new Error('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const total = result.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / GOODS_LIST_PAGE_SIZE));
  if (filters.page > lastPage) return loadAdminGoodsList({ ...filters, page: lastPage });
  const ips: AdminGoodsListData['ips'] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from('ips').select('id,title,archived_at').order('title').order('id').range(offset, offset + 999);
    if (result.error) throw new Error('IP 필터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    ips.push(...(result.data ?? []).map((ip) => ({ id: ip.id, title: ip.title, archivedAt: ip.archived_at })));
    if ((result.data?.length ?? 0) < 1000) break;
  }
  return {
    filters, total, ips,
    goods: ((result.data ?? []) as unknown as GoodsListRow[]).map((good) => ({
      id: good.id, code: good.code, name: good.name, ipId: good.ip_id,
      ipTitle: good.ip.title,
      publishedAt: good.published_at, archivedAt: good.archived_at,
      stock: good.stock, stockQty: good.stock_qty ?? 0,
      noticeComplete: [good.notice_maker,good.notice_origin,good.notice_material,good.notice_size,good.notice_made_on,good.notice_as_manager,good.notice_as_contact].every(value=>Boolean(value?.trim())),
    })),
  };
}

/** Editor requests one good and its options; opening the list never loads these. */
export async function loadAdminGoodEditor(goodId?: string) {
  const supabase = await createClient();
  const [records, variants, verticals, origins] = await Promise.all([
    getAdminCatalogRecords({ include: goodId ? ['goods', 'ips'] : ['ips'], ...(goodId ? { goodId } : {}) }),
    goodId ? loadAdminGoodsVariants(goodId) : Promise.resolve([]),
    supabase.from('verticals').select('key,label,color').order('key'),
    loadAdminFulfillmentOrigins(),
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
  return { records, variants, catalogIps, origins };
}
