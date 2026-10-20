import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseShoppingStoryGood } from '@/lib/shopping-stories.server';
import { imageUrlFromBg, publicMediaUrl } from '@/lib/media';
import { isUuid } from '@/lib/uuid';
import { SHOPPING_STORY_IMAGE_PATTERN, type ShoppingStorySectionInput } from '@/lib/shopping-stories';
import { SHOPPING_STORY_STATE_LABELS, type AdminShoppingStory, type AdminShoppingStoryList, type AdminShoppingStoryRow,
  type ShoppingStoryFilters, type ShoppingStoryGoodOption } from './shopping-stories';
import { DEFAULT_STORY_GOOD_FILTERS, type StoryGoodCandidates, type StoryGoodFilters } from './shopping-story-picker';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalInstant = (value: unknown) => value === null || instant(value);
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const LIST_ERROR = '쇼핑스토리를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';

export function parseShoppingStoryRow(value: unknown): AdminShoppingStoryRow | null {
  if (!record(value) || !isUuid(value.id) || !nonnegative(value.reference) || value.reference < 1
    || typeof value.title !== 'string' || !optionalInstant(value.startsAt) || !optionalInstant(value.endsAt)
    || !instant(value.createdAt) || !instant(value.updatedAt) || !nonnegative(value.revision) || value.revision < 1
    || typeof value.state !== 'string' || !Object.hasOwn(SHOPPING_STORY_STATE_LABELS, value.state)
    || !nonnegative(value.sectionCount) || value.sectionCount > 10 || !nonnegative(value.goodCount) || value.goodCount > 300) return null;
  return { id: value.id, reference: value.reference, title: value.title, startsAt: value.startsAt as string | null,
    endsAt: value.endsAt as string | null, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    state: value.state as AdminShoppingStoryRow['state'], sectionCount: value.sectionCount, goodCount: value.goodCount };
}
export function parseShoppingStoryGoods(value: unknown): ShoppingStoryGoodOption[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>(); const rows: ShoppingStoryGoodOption[] = [];
  for (const row of value) {
    const good = parseShoppingStoryGood(row);
    if (!good || !record(row) || ids.has(good.id) || typeof row.code !== 'string' || typeof row.archived !== 'boolean' || typeof row.published !== 'boolean') return null;
    ids.add(good.id);
    rows.push({ ...good, code: row.code, imageUrl: row.imagePath ? publicMediaUrl(row.imagePath as string) : imageUrlFromBg(good.imageBackground),
      archived: row.archived, published: row.published });
  }
  return rows;
}
export function parseAdminShoppingStory(value: unknown): AdminShoppingStory | null {
  const row = parseShoppingStoryRow(value);
  if (!row || !record(value) || typeof value.bodyHtml !== 'string' || !Array.isArray(value.imagePaths)
    || value.imagePaths.some(path => typeof path !== 'string' || !SHOPPING_STORY_IMAGE_PATTERN.test(path)) || value.imagePaths.length > 20
    || !Array.isArray(value.sections) || value.sections.length !== row.sectionCount) return null;
  const goods = parseShoppingStoryGoods(value.goods);
  if (!goods || goods.length !== row.goodCount) return null;
  const sectionIds = new Set<string>(), ids = new Set<string>(), available = new Set(goods.map(good => good.id));
  const sections: ShoppingStorySectionInput[] = [];
  for (const section of value.sections) {
    if (!record(section) || !isUuid(section.id) || sectionIds.has(section.id) || typeof section.title !== 'string'
      || !['square', 'portrait'].includes(String(section.imageShape)) || !Array.isArray(section.goodIds) || section.goodIds.length > 200) return null;
    sectionIds.add(section.id);
    for (const id of section.goodIds) { if (typeof id !== 'string' || ids.has(id) || !available.has(id)) return null; ids.add(id); }
    sections.push({ id: section.id, title: section.title, imageShape: section.imageShape as ShoppingStorySectionInput['imageShape'], goodIds: section.goodIds as string[] });
  }
  if (ids.size !== row.goodCount) return null;
  return { ...row, bodyHtml: value.bodyHtml, imagePaths: value.imagePaths as string[], sections, goods };
}
export async function loadAdminShoppingStories(filters: ShoppingStoryFilters): Promise<AdminShoppingStoryList> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_shopping_stories', { p_query: filters.query, p_state: filters.state,
    p_from: filters.from || null, p_to: filters.to || null, p_sort: filters.sort, p_limit: filters.pageSize, p_offset: (filters.page - 1) * filters.pageSize });
  if (error || !record(data) || !nonnegative(data.total) || !instant(data.checkedAt) || !Array.isArray(data.rows)) throw new Error(LIST_ERROR);
  const rows = data.rows.map(parseShoppingStoryRow);
  if (rows.some(row => row === null)) throw new Error(LIST_ERROR);
  const lastPage = Math.max(1, Math.ceil(data.total / filters.pageSize));
  if (filters.page > lastPage) return loadAdminShoppingStories({ ...filters, page: lastPage });
  return { rows: rows as AdminShoppingStoryRow[], total: data.total, checkedAt: data.checkedAt, filters };
}
export async function loadAdminShoppingStory(id: string): Promise<AdminShoppingStory | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_shopping_story', { p_id: id });
  if (error) throw new Error(LIST_ERROR);
  if (data === null) return null;
  const story = parseAdminShoppingStory(data);
  if (!story) throw new Error('쇼핑스토리의 저장 내용을 확인하지 못했습니다.');
  return story;
}
export async function searchShoppingStoryGoods(query: string, page: number, filters: StoryGoodFilters = DEFAULT_STORY_GOOD_FILTERS): Promise<StoryGoodCandidates> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_search_shopping_story_goods_filtered', { p_query: query, p_page: page, p_filters: filters });
  const rows = record(data) ? parseShoppingStoryGoods(data.rows) : null;
  const failure = () => new Error('관련상품을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (error || !record(data) || !rows || !nonnegative(data.total) || !nonnegative(data.page) || data.page < 1 || data.pageSize !== 20 || !instant(data.checkedAt)
    || !Array.isArray(data.categories) || data.categories.some(row => !record(row) || !isUuid(row.id) || typeof row.path !== 'string')) throw failure();
  const metadata = data.rows as Record<string, unknown>[];
  const candidates = rows.map((good, index) => {
    const raw = metadata[index];
    if (!nonnegative(raw.reviewCount) || !nonnegative(raw.wishCount) || !nonnegative(raw.salesQuantity)
      || !(raw.ratingAverage === null || (typeof raw.ratingAverage === 'number' && raw.ratingAverage >= 1 && raw.ratingAverage <= 5))
      || (raw.reviewCount === 0) !== (raw.ratingAverage === null) || typeof raw.freeShipping !== 'boolean' || typeof raw.discounted !== 'boolean'
      || !['stock', 'preorder'].includes(String(raw.saleType))) throw failure();
    return { ...good, reviewCount: raw.reviewCount, wishCount: raw.wishCount, salesQuantity: raw.salesQuantity, ratingAverage: raw.ratingAverage as number | null,
      freeShipping: raw.freeShipping, discounted: raw.discounted, saleType: raw.saleType as 'stock' | 'preorder' };
  });
  return { rows: candidates, total: data.total, page: data.page, pageSize: 20, checkedAt: data.checkedAt, categories: data.categories as StoryGoodCandidates['categories'] };
}
