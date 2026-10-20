import { parseGoodsSalePeriod } from './goods-sale-period';
import 'server-only';
import { loadGoodsListingAppearance } from './goods-listing-appearance.server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { isUuid } from '@/lib/uuid';
import { imageBg, publicMediaUrl } from '@/lib/media';
import { goodCompareAtPrice } from '@/lib/goods-options';
import { parseGoodsVariantPricing } from '@/lib/goods-sales';
import { parseGoodsVariantSupply } from '@/lib/goods-preorders';
import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { SHOPPING_STORY_IMAGE_PATTERN, type PublicShoppingStory, type PublicShoppingStoryGood, type PublicShoppingStoryList,
  type PublicShoppingStorySection, type PublicShoppingStorySummary } from '@/lib/shopping-stories';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalInstant = (value: unknown) => value === null || instant(value);
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function publicStorySource(value: unknown) {
  if (!record(value) || !isUuid(value.id) || !nonnegative(value.reference) || value.reference < 1 || typeof value.title !== 'string'
    || typeof value.bodyHtml !== 'string' || !Array.isArray(value.imagePaths) || value.imagePaths.length > 20
    || value.imagePaths.some(path => typeof path !== 'string' || !SHOPPING_STORY_IMAGE_PATTERN.test(path))
    || !instant(value.createdAt) || !optionalInstant(value.startsAt) || !optionalInstant(value.endsAt)) return null;
  const content = sanitizeShoppingStoryContent(value.bodyHtml, { imagePaths: value.imagePaths as string[] });
  return { id: value.id, reference: value.reference, title: value.title, bodyHtml: content.html, imagePaths: content.imagePaths,
    description: content.description, imageUrl: content.representativeImagePath ? publicMediaUrl(content.representativeImagePath) : null,
    createdAt: value.createdAt, startsAt: value.startsAt as string | null, endsAt: value.endsAt as string | null };
}
export function parsePublicShoppingStorySummary(value: unknown): PublicShoppingStorySummary | null {
  const source = publicStorySource(value);
  return source ? { id: source.id, reference: source.reference, title: source.title, description: source.description,
    imageUrl: source.imageUrl, createdAt: source.createdAt, startsAt: source.startsAt, endsAt: source.endsAt } : null;
}

/** This leaf module deliberately never imports catalog.ts: the home snapshot also
 * consumes its summary function. The RPC recomputes time gates on each request. */
export async function getPublicShoppingStories(input: { page?: number; limit?: number } = {}): Promise<PublicShoppingStoryList> {
  const page = Number.isSafeInteger(input.page) && Number(input.page) >= 1 && Number(input.page) <= 1_000_000 ? Number(input.page) : 1;
  const pageSize = Number.isSafeInteger(input.limit) && Number(input.limit) >= 1 && Number(input.limit) <= 100 ? Number(input.limit) : 12;
  const empty: PublicShoppingStoryList = { stories: [], total: 0, page, pageSize, nextChangeAt: null };
  if (!getSupabaseConfig().isConfigured) return empty;
  const client = await createClient();
  const { data, error } = await client.rpc('get_shopping_stories', { p_limit: pageSize, p_offset: (page - 1) * pageSize });
  if (error || !record(data) || !nonnegative(data.total) || !Array.isArray(data.rows) || !optionalInstant(data.nextChangeAt)) return { ...empty, unavailable: true };
  const stories = data.rows.map(parsePublicShoppingStorySummary);
  if (stories.some(story => story === null)) return { ...empty, unavailable: true };
  const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
  if (page > lastPage) return getPublicShoppingStories({ page: lastPage, limit: pageSize });
  return { stories: stories as PublicShoppingStorySummary[], total: data.total, page, pageSize, nextChangeAt: data.nextChangeAt as string | null };
}

export function parseShoppingStoryGood(value: unknown): PublicShoppingStoryGood | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !nonnegative(value.price)
    || (value.compareAtPrice !== null && !nonnegative(value.compareAtPrice)) || typeof value.showDiscountRate !== 'boolean'
    || (value.badge !== null && typeof value.badge !== 'string') || (value.imagePath !== null && typeof value.imagePath !== 'string')
    || (value.bg !== null && typeof value.bg !== 'string') || !['ok', 'low', 'soldout'].includes(String(value.stock)) || !Array.isArray(value.variants)) return null;
  const salePeriod = value.salePeriod === undefined ? undefined : parseGoodsSalePeriod(value.salePeriod);
  if (salePeriod === null) return null;
  const options = [];
  for (const variant of value.variants) {
    if (!record(variant) || !nonnegative(variant.price)) return null;
    const pricing = parseGoodsVariantPricing(variant.pricing), supply = parseGoodsVariantSupply(variant.supply);
    if (!pricing || !supply) return null;
    options.push({ price: pricing.effectivePrice, stockQty: supply.availableQty, pricing });
  }
  const prices = options.map(option => option.price);
  const imageUrl = value.imagePath ? publicMediaUrl(value.imagePath as string) : null;
  return { id: value.id, name: value.name, salePeriod, price: prices.length ? Math.min(...prices) : value.price,
    priceMax: prices.length ? Math.max(...prices) : value.price,
    compareAtPrice: goodCompareAtPrice({ price: value.price, compareAtPrice: value.compareAtPrice as number | null }, options),
    showDiscountRate: value.showDiscountRate, imageBackground: imageUrl ? imageBg(imageUrl) : (value.bg as string | null) ?? '',
    badge: value.badge as string | null, soldOut: options.reduce((sum, option) => sum + option.stockQty, 0) <= 0 };
}
export function parsePublicShoppingStory(value: unknown): PublicShoppingStory | null {
  const source = publicStorySource(value);
  if (!source || !record(value) || !optionalInstant(value.nextChangeAt) || !Array.isArray(value.sections) || value.sections.length > 10
    || !Array.isArray(value.goods) || value.goods.length > 300) return null;
  const goods = value.goods.map(parseShoppingStoryGood);
  if (goods.some(good => good === null)) return null;
  const goodsById = new Map((goods as PublicShoppingStoryGood[]).map(good => [good.id, good]));
  if (goodsById.size !== goods.length) return null;
  const sections: PublicShoppingStorySection[] = []; const seen = new Set<string>();
  for (const section of value.sections) {
    if (!record(section) || !isUuid(section.id) || typeof section.title !== 'string' || !['square', 'portrait'].includes(String(section.imageShape))
      || !Array.isArray(section.goodIds) || section.goodIds.length > 200) return null;
    const selected: PublicShoppingStoryGood[] = [];
    for (const id of section.goodIds) {
      if (typeof id !== 'string' || seen.has(id) || !goodsById.has(id)) return null;
      seen.add(id); selected.push(goodsById.get(id)!);
    }
    if (selected.length) sections.push({ id: section.id, title: section.title, imageShape: section.imageShape as PublicShoppingStorySection['imageShape'], goods: selected });
  }
  if (seen.size !== goods.length) return null;
  const boundaries = [value.nextChangeAt, ...goods.map(good => good?.salePeriod?.nextChangeAt), ...value.goods.flatMap(item => {
    const raw = item as { variants: { pricing: { nextChangeAt?: string | null }; supply: { nextChangeAt: string | null } }[] };
    return raw.variants.flatMap(variant => [variant.pricing.nextChangeAt, variant.supply.nextChangeAt]);
  })].filter((boundary): boundary is string => typeof boundary === 'string');
  const nextChangeAt = boundaries.length ? new Date(Math.min(...boundaries.map(boundary => Date.parse(boundary)))).toISOString() : null;
  return { ...source, sections, nextChangeAt, goodsUnavailable: false };
}
export async function getPublicShoppingStory(id: string): Promise<PublicShoppingStory | null> {
  if (!isUuid(id) || !getSupabaseConfig().isConfigured) return null;
  const client = await createClient(); const { data, error } = await client.rpc('get_shopping_story', { p_id: id });
  if (error) throw new Error('쇼핑스토리를 불러오지 못했습니다.');
  if (data === null) return null;
  const story = parsePublicShoppingStory(data);
  if (!story) throw new Error('쇼핑스토리의 공개 내용을 확인하지 못했습니다.');
  const listing = await loadGoodsListingAppearance(client, story.sections.flatMap(section => section.goods.map(good => good.id)));
  for (const section of story.sections) for (const good of section.goods) good.listingAppearance = listing.get(good.id);
  return story;
}
