import 'server-only';
import { createClient } from './supabase/server';
import { getSupabaseConfig } from './supabase/config';
import { publicMediaUrl } from './media';
import { toGood, type GoodRow } from './catalog';
import { parseGoodsMediaAsset } from './goods-media';
import { loadGoodsListingAppearance } from './goods-listing-appearance.server';
import { isSafeInternalLink, isCommunityDestination, isCardRewardDestination } from './home-catalog';
import { COMMUNITY_ENABLED } from './community-visibility';
import { readCardRewardsEnabled } from './card-rewards/gate.server';
import { isUuid } from './uuid';
import { goodDetailHref } from './goods-display';
import { categoryDisplayRecord as record, CATEGORY_DISPLAY_PAGE_SIZE, isCategoryDisplayGoodId, type CategoryDisplayPage, type CategoryDisplayNavigation } from './category-display';
import type { ShopFacetOption, ShopListQuery } from './shop-catalog';
import type { Good } from './data';
import type { SupabaseClient } from '@supabase/supabase-js';

const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const failure = () => new Error('카테고리 전시를 불러오지 못했습니다. 다시 시도해주세요.');
export class CategoryDisplayStaleError extends Error { constructor() { super('전시 상품이 변경되었습니다. 목록을 새로 불러와주세요.'); } }

/** The DTO is explicitly projected by SQL, then mapped through the catalog's
 * exact option price, stock, custom-input and purchase-constraint normalizer. */
export function parseCategoryDisplayGood(value: unknown): Good | null {
  if (!record(value) || !isCategoryDisplayGoodId(value.id) || typeof value.name !== 'string' || typeof value.ip_id !== 'string'
    || typeof value.type !== 'string' || !number(value.price) || !number(value.stock_qty) || typeof value.stock !== 'string'
    || !nullableString(value.image_path) || !nullableString(value.bg) || !nullableString(value.badge)
    || !Array.isArray(value.goods_variants) || typeof value.custom_inputs_enabled !== 'boolean' || !number(value.custom_inputs_revision)
    || !Array.isArray(value.custom_input_fields) || (value.sale_restriction !== 'none' && value.sale_restriction !== 'adult')) return null;
  for (const variant of value.goods_variants) {
    if (!record(variant) || !isUuid(variant.id) || typeof variant.name !== 'string' || typeof variant.code !== 'string'
      || !number(variant.price) || !number(variant.stock_qty) || typeof variant.is_default !== 'boolean' || !record(variant.attributes)
      || Object.values(variant.attributes).some(item => typeof item !== 'string') || variant.archived_at !== null || !Number.isInteger(variant.sort_order)
      || !record(variant.pricing) || !record(variant.supply)) return null;
  }
  try {
    const good = toGood(value as unknown as GoodRow, path => publicMediaUrl(path) ?? '');
    return good.options?.length === value.goods_variants.length ? good : null;
  } catch { return null; }
}
function facets(value: unknown): ShopFacetOption[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>(), result: ShopFacetOption[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.value !== 'string' || typeof item.label !== 'string' || !number(item.count) || seen.has(item.value)) return null;
    seen.add(item.value); result.push({ value: item.value, label: item.label, count: item.count });
  }
  return result;
}
export function categoryDisplaySqlQuery(query: ShopListQuery) {
  return { ips: [...query.ips].sort(), types: [...query.types].sort(), min: query.priceMin, max: query.priceMax, sort: query.sort };
}
export function parseCategoryDisplayPage(value: unknown, query: ShopListQuery): CategoryDisplayPage | null {
  if (!record(value) || !record(value.category) || !isUuid(value.category.id) || typeof value.category.name !== 'string'
    || !instant(value.checkedAt) || typeof value.token !== 'string' || !/^[a-f0-9]{32}$/.test(value.token)
    || !number(value.offset) || value.offset % CATEGORY_DISPLAY_PAGE_SIZE !== 0 || !number(value.total) || !number(value.filteredTotal)
    || value.filteredTotal > value.total || !number(value.priceCeil) || !Array.isArray(value.rows) || value.rows.length > CATEGORY_DISPLAY_PAGE_SIZE
    || value.nextOffset !== null && (!number(value.nextOffset) || value.nextOffset !== value.offset + CATEGORY_DISPLAY_PAGE_SIZE)
    || value.rows.length !== Math.max(0, Math.min(CATEGORY_DISPLAY_PAGE_SIZE, value.filteredTotal - value.offset))
    || (value.nextOffset !== null) !== (value.filteredTotal > value.offset + CATEGORY_DISPLAY_PAGE_SIZE)) return null;
  const goods = value.rows.map(parseCategoryDisplayGood), ipFacets = facets(value.ipFacets), typeFacets = facets(value.typeFacets);
  if (goods.some(good => !good) || new Set(goods.map(good => good?.id)).size !== goods.length || !ipFacets || !typeFacets) return null;
  const page: CategoryDisplayPage = { category: { id: value.category.id, name: value.category.name }, checkedAt: value.checkedAt,
    token: value.token, offset: value.offset, nextOffset: value.nextOffset as number | null, query,
    result: { goods: goods as Good[], total: value.total, filteredTotal: value.filteredTotal, priceCeil: value.priceCeil, ipFacets, typeFacets },
    banner: null, video: null, recommendations: null, navigation: [] };
  if (value.banner !== null) {
    const b = value.banner;
    if (!record(b) || typeof b.title !== 'string' || typeof b.content !== 'string' || typeof b.imagePath !== 'string'
      || !publicMediaUrl(b.imagePath) || !nullableString(b.mobileImagePath) || b.mobileImagePath && !publicMediaUrl(b.mobileImagePath)
      || !nullableString(b.linkPath) || b.linkPath && !isSafeInternalLink(b.linkPath) || typeof b.altText !== 'string'
      || !['none', 'white', 'black'].includes(String(b.imageDim)) || !['white', 'black'].includes(String(b.textColor))) return null;
    page.banner = { id: `category-${page.category.id}`, title: b.title, subtitle: b.content || null, imageUrl: publicMediaUrl(b.imagePath)!,
      mobileImageUrl: b.mobileImagePath ? publicMediaUrl(b.mobileImagePath) : null, href: b.linkPath,
      imageAlt: b.altText, imageDim: b.imageDim as 'none' | 'white' | 'black', textColor: b.textColor as 'white' | 'black' };
  }
  if (value.video !== null) {
    if (!record(value.video) || !nullableString(value.video.poster)) return null;
    const asset = parseGoodsMediaAsset(value.video.asset); if (!asset) return null;
    page.video = { asset, poster: value.video.poster ? publicMediaUrl(value.video.poster) : null };
  }
  if (value.recommendations !== null) {
    const r = value.recommendations;
    if (!record(r) || typeof r.title !== 'string' || !Array.isArray(r.rows) || r.rows.length > 12) return null;
    const recommendationRows = r.rows;
    const recommended = recommendationRows.map(parseCategoryDisplayGood);
    if (recommendationRows.some(row => !record(row) || typeof row.ip_name !== 'string') || recommended.some(good => !good) || new Set(recommended.map(good => good?.id)).size !== recommended.length) return null;
    page.recommendations = { id: `category-${page.category.id}`, title: r.title, layout: 'list', imageShape: 'square', goods: (recommended as Good[]).map((good, index) => ({
      id: good.id, name: good.name, href: goodDetailHref(good.id), imageBg: good.img, price: good.price, priceMax: good.priceMax,
      soldOut: good.stock === 'soldout', salePeriod: good.salePeriod, badge: good.badge ?? null,
      brand: (recommendationRows[index] as { ip_name: string }).ip_name,
    })) };
  }
  return page;
}
export async function loadCategoryDisplayNavigation(): Promise<CategoryDisplayNavigation[]> {
  if (!getSupabaseConfig().isConfigured) return [];
  const client = await createClient(), { data, error } = await client.rpc('get_category_display_navigation');
  if (error || !Array.isArray(data)) throw failure();
  const rows: CategoryDisplayNavigation[] = [], ids = new Set<string>();
  for (const row of data) {
    if (!record(row) || !isUuid(row.id) || typeof row.name !== 'string' || !number(row.depth) || row.depth < 1 || row.depth > 4 || ids.has(row.id)) throw failure();
    ids.add(row.id); rows.push({ id: row.id, name: row.name, depth: row.depth });
  }
  return rows;
}
export async function loadCategoryDisplayPage(categoryId: string, query: ShopListQuery, offset = 0, token: string | null = null): Promise<CategoryDisplayPage | null> {
  if (!getSupabaseConfig().isConfigured || !isUuid(categoryId)) return null;
  const client = await createClient();
  const { data, error } = await client.rpc('get_category_display_page', { p_category_id: categoryId, p_query: categoryDisplaySqlQuery(query), p_offset: offset, p_token: token });
  if (error?.code === 'PT409') throw new CategoryDisplayStaleError();
  if (error) throw failure(); if (data === null) return null;
  const page = parseCategoryDisplayPage(data, query); if (!page || page.category.id !== categoryId || page.offset !== offset) throw failure();
  return hydrateCategoryDisplayPage(page, client);
}
/** Public pages and the unsaved preview share presentation and destination gates. */
export async function hydrateCategoryDisplayPage(page: CategoryDisplayPage, client: SupabaseClient): Promise<CategoryDisplayPage> {
  const [appearance, rewards] = await Promise.all([loadGoodsListingAppearance(client, page.result.goods.map(good => good.id)), readCardRewardsEnabled()]);
  for (const good of page.result.goods) good.listingAppearance = appearance.get(good.id);
  if (page.banner?.href && ((!COMMUNITY_ENABLED && isCommunityDestination(page.banner.href)) || (!rewards && isCardRewardDestination(page.banner.href)))) page.banner = null;
  return page;
}
