import { isUuid } from './uuid';
import { isSafeInternalLink } from './home-catalog';
import { normalizeHeroNewlines, type HomeHeroImageDim, type HomeHeroTextColor } from './home-hero';
import { GOOD_TYPES, isGoodType } from './goods-taxonomy';
import { SHOP_DEFAULT_SORT, SHOP_PREORDER_TYPE, SHOP_SORTS, type ShopListQuery } from './shop-catalog';
import type { GoodsReviewSummary } from './goods-review-summary';
import type { Good } from './data';
import type { HomeHeroSlide } from './home-catalog';
import type { GoodsMediaAsset } from './goods-media';
import type { HomeProductCollectionBand } from './home-product-collection';
import type { ShopListResult } from './shop-catalog';

export const CATEGORY_DISPLAY_ADMIN_PATH = '/admin/display/categories';
export const CATEGORY_DISPLAY_API_PATH = '/api/category-display';
export const CATEGORY_DISPLAY_GOODS_LIMIT = 1000;
export const CATEGORY_DISPLAY_SOURCE_LIMIT = 10;
export const CATEGORY_DISPLAY_RECOMMEND_LIMIT = 100;
export const CATEGORY_DISPLAY_PAGE_SIZE = 20;
const GOOD_ID = /^[a-z0-9][a-z0-9-]{0,199}$/;
const IMAGE = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
export const isCategoryDisplayGoodId = (value: unknown): value is string => typeof value === 'string' && GOOD_ID.test(value);
export const categoryDisplayRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function ids(value: unknown, max: number, valid: (v: unknown) => boolean): value is string[] { return Array.isArray(value) && value.length <= max && value.every(valid) && new Set(value).size === value.length; }
function text(value: unknown, max: number, lines = 1): value is string { return typeof value === 'string' && [...value].length <= max && !CONTROL.test(value) && value.split('\n').length <= lines; }
const imagePath = (value: unknown): value is string | null => value === null || typeof value === 'string' && IMAGE.test(value);

export interface CategoryDisplayBanner {
  enabled: boolean; imagePath: string | null; mobileImagePath: string | null; title: string; content: string;
  altEnabled: boolean; altTitle: string; altContent: string; linkPath: string | null; imageDim: HomeHeroImageDim; textColor: HomeHeroTextColor;
}
export interface CategoryDisplayValues {
  enabled: boolean; mode: 'categories' | 'manual'; categoryIds: string[]; goodIds: string[];
  banner: CategoryDisplayBanner;
  video: { enabled: boolean; goodId: string | null };
  recommendations: { enabled: boolean; title: string; itemCount: number; goodIds: string[] };
}
export interface CategoryDisplayCategory { id: string; name: string; parentId: string | null; depth: number; sortOrder: number; publicEnabled: boolean }
export interface CategoryDisplayNode extends CategoryDisplayCategory { archivedAt: string | null; legacyCategoryId: string | null }
export interface CategoryDisplaySnapshot { category: CategoryDisplayCategory; revision: number; values: CategoryDisplayValues; checkedAt: string }
export interface CategoryDisplayDirectory { categories: CategoryDisplayNode[]; sourceCategories: CategoryDisplayCategory[]; revision: number; checkedAt: string }
export type CategoryDisplayTreeChange = { action: 'create' | 'update'; id: string; name: string; parentId: string | null; position: number }
  | { action: 'archive' | 'restore'; id: string };
export interface CategoryDisplayNavigation { id: string; name: string; depth: number }
export interface CategoryDisplayPage {
  category: Pick<CategoryDisplayCategory, 'id' | 'name'>; checkedAt: string; token: string; offset: number; nextOffset: number | null;
  query: ShopListQuery; result: ShopListResult; navigation: CategoryDisplayNavigation[];
  banner: HomeHeroSlide | null; video: { asset: GoodsMediaAsset; poster: string | null } | null; recommendations: HomeProductCollectionBand | null;
}
export interface CategoryDisplayPageBatch {
  goods: Good[]; nextOffset: number | null; token: string; checkedAt: string;
  /** 이 묶음 굿즈의 목록 카드 별점(CL-02). 리뷰 0건 굿즈는 키가 없다. */
  reviewSummaries?: Record<string, GoodsReviewSummary>;
}

export function defaultCategoryDisplayValues(categoryId: string): CategoryDisplayValues {
  return { enabled: false, mode: 'categories', categoryIds: [categoryId], goodIds: [],
    banner: { enabled: false, imagePath: null, mobileImagePath: null, title: '', content: '', altEnabled: false, altTitle: '', altContent: '', linkPath: null, imageDim: 'none', textColor: 'white' },
    video: { enabled: false, goodId: null }, recommendations: { enabled: false, title: '추천상품', itemCount: 3, goodIds: [] } };
}
export function parseCategoryDisplayValues(value: unknown): CategoryDisplayValues | null {
  if (!categoryDisplayRecord(value) || !exact(value, ['enabled', 'mode', 'categoryIds', 'goodIds', 'banner', 'video', 'recommendations'])
    || typeof value.enabled !== 'boolean' || !['categories', 'manual'].includes(String(value.mode))
    || !ids(value.categoryIds, CATEGORY_DISPLAY_SOURCE_LIMIT, isUuid) || !ids(value.goodIds, CATEGORY_DISPLAY_GOODS_LIMIT, isCategoryDisplayGoodId)
    || !categoryDisplayRecord(value.banner) || !categoryDisplayRecord(value.video) || !categoryDisplayRecord(value.recommendations)) return null;
  const b = { ...value.banner }, v = value.video, r = value.recommendations;
  if (typeof b.content === 'string') b.content = normalizeHeroNewlines(b.content);
  if (typeof b.altContent === 'string') b.altContent = normalizeHeroNewlines(b.altContent);
  if (!exact(b, ['enabled', 'imagePath', 'mobileImagePath', 'title', 'content', 'altEnabled', 'altTitle', 'altContent', 'linkPath', 'imageDim', 'textColor'])
    || typeof b.enabled !== 'boolean' || typeof b.altEnabled !== 'boolean' || !imagePath(b.imagePath) || !imagePath(b.mobileImagePath)
    || !text(b.title, 40) || !text(b.content, 150, 3) || !text(b.altTitle, 40) || !text(b.altContent, 150, 3)
    || (b.linkPath !== null && (typeof b.linkPath !== 'string' || !isSafeInternalLink(b.linkPath)))
    || !['none', 'white', 'black'].includes(String(b.imageDim)) || !['white', 'black'].includes(String(b.textColor))
    || b.enabled && !b.imagePath
    || !exact(v, ['enabled', 'goodId']) || typeof v.enabled !== 'boolean' || v.goodId !== null && !isCategoryDisplayGoodId(v.goodId)
    || v.enabled && !v.goodId
    || !exact(r, ['enabled', 'title', 'itemCount', 'goodIds']) || typeof r.enabled !== 'boolean' || (!text(r.title, 15) || /[\t\r\n]/.test(String(r.title)))
    || !Number.isSafeInteger(r.itemCount) || Number(r.itemCount) < 3 || Number(r.itemCount) > 12
    || !ids(r.goodIds, CATEGORY_DISPLAY_RECOMMEND_LIMIT, isCategoryDisplayGoodId) || r.enabled && !r.title.trim()
    || value.enabled && value.mode === 'categories' && value.categoryIds.length === 0) return null;
  return { enabled: value.enabled, mode: value.mode as CategoryDisplayValues['mode'], categoryIds: [...value.categoryIds], goodIds: [...value.goodIds],
    banner: { enabled: b.enabled, imagePath: b.imagePath, mobileImagePath: b.mobileImagePath, title: b.title, content: b.content,
      altEnabled: b.altEnabled, altTitle: b.altTitle, altContent: b.altContent, linkPath: b.linkPath as string | null,
      imageDim: b.imageDim as HomeHeroImageDim, textColor: b.textColor as HomeHeroTextColor },
    video: { enabled: v.enabled, goodId: v.goodId as string | null },
    recommendations: { enabled: r.enabled, title: r.title, itemCount: Number(r.itemCount), goodIds: [...r.goodIds] } };
}
export function parseCategoryDisplayCategory(value: unknown): CategoryDisplayCategory | null {
  if (!categoryDisplayRecord(value) || !isUuid(value.id) || typeof value.name !== 'string' || value.parentId !== null && !isUuid(value.parentId)
    || !Number.isInteger(value.depth) || Number(value.depth) < 1 || Number(value.depth) > 4 || !Number.isSafeInteger(value.sortOrder)
    || typeof value.publicEnabled !== 'boolean') return null;
  return { id: value.id, name: value.name, parentId: value.parentId as string | null, depth: Number(value.depth), sortOrder: Number(value.sortOrder), publicEnabled: value.publicEnabled };
}
export function parseCategoryDisplayDirectory(value: unknown): CategoryDisplayDirectory | null {
  if (!categoryDisplayRecord(value) || !Array.isArray(value.categories) || !Array.isArray(value.sourceCategories)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))) return null;
  const categories: CategoryDisplayNode[] = [];
  for (const item of value.categories) {
    const category = parseCategoryDisplayCategory(item);
    if (!category || !categoryDisplayRecord(item) || item.archivedAt !== null && (typeof item.archivedAt !== 'string' || !Number.isFinite(Date.parse(item.archivedAt)))
      || item.legacyCategoryId !== null && !isUuid(item.legacyCategoryId)) return null;
    categories.push({ ...category, archivedAt: item.archivedAt as string | null, legacyCategoryId: item.legacyCategoryId as string | null });
  }
  const sourceCategories = value.sourceCategories.map(parseCategoryDisplayCategory);
  const byId = new Map(categories.map(category => [category.id, category]));
  if (byId.size !== categories.length || sourceCategories.some(category => !category)
    || new Set(sourceCategories.map(category => category?.id)).size !== sourceCategories.length
    || categories.some(category => category.parentId === null ? category.depth !== 1 : byId.get(category.parentId)?.depth !== category.depth - 1)) return null;
  return { categories, sourceCategories: sourceCategories as CategoryDisplayCategory[], revision: Number(value.revision), checkedAt: value.checkedAt };
}
export function parseCategoryDisplayTreeChange(value: unknown): CategoryDisplayTreeChange | null {
  if (!categoryDisplayRecord(value) || !isUuid(value.id)) return null;
  if ((value.action === 'archive' || value.action === 'restore') && exact(value, ['action', 'id'])) return { action: value.action, id: value.id };
  if ((value.action !== 'create' && value.action !== 'update') || !exact(value, ['action', 'id', 'name', 'parentId', 'position'])
    || typeof value.name !== 'string' || !value.name.trim() || value.name !== value.name.trim() || /[\u0000-\u001f\u007f]/.test(value.name)
    || value.action === 'create' && [...value.name].length > 20 || value.parentId !== null && !isUuid(value.parentId)
    || value.parentId === value.id || !Number.isSafeInteger(value.position) || Number(value.position) < 0 || Number(value.position) > 999999) return null;
  return { action: value.action, id: value.id, name: value.name, parentId: value.parentId as string | null, position: Number(value.position) };
}
/** Parent choices exclude the node and its descendants; SQL enforces the same invariant under its tree lock. */
export function categoryDisplayParentChoices(directory: CategoryDisplayDirectory, nodeId: string | null): CategoryDisplayNode[] {
  const byId = new Map(directory.categories.map(category => [category.id, category]));
  return directory.categories.filter(category => {
    if (category.depth >= 3) return false;
    let current: CategoryDisplayNode | undefined = category;
    while (current) { if (current.id === nodeId || current.archivedAt !== null) return false; current = current.parentId ? byId.get(current.parentId) : undefined; }
    return true;
  });
}
export function parseCategoryDisplaySnapshot(value: unknown): CategoryDisplaySnapshot | null {
  if (!categoryDisplayRecord(value)) return null;
  const category = parseCategoryDisplayCategory(value.category), values = parseCategoryDisplayValues(value.values);
  return category && values && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt))
    ? { category, values, revision: Number(value.revision), checkedAt: value.checkedAt } : null;
}

/** A display scope never silently becomes the unfiltered whole catalog. */
export function parseCategoryDisplayRequest(params: Record<string, string | string[] | undefined>): { categoryId: string; query: ShopListQuery } | null {
  if (typeof params.displayCategory !== 'string' || !isUuid(params.displayCategory) || params.category !== undefined) return null;
  const array = (v: string | string[] | undefined) => v === undefined ? [] : Array.isArray(v) ? v : [v];
  const ips = [...new Set(array(params.ip))], types = [...new Set(array(params.type))];
  const price = (v: string | string[] | undefined) => v === undefined ? null : typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) <= 100_000_000 ? Number(v) : NaN;
  const min = price(params.min), max = price(params.max);
  /* 타입 축은 굿즈 분류 + '예약판매'(옵션 공급 방식 파생 값, 컬렉션과 같은 축 — DB get_category_display_page 화이트리스트와 같다). */
  if (ips.length > 100 || ips.some(id => !GOOD_ID.test(id)) || types.length > GOOD_TYPES.length + 1 || types.some(type => !isGoodType(type) && type !== SHOP_PREORDER_TYPE)
    || Number.isNaN(min) || Number.isNaN(max) || min !== null && max !== null && min > max
    || params.sort !== undefined && (typeof params.sort !== 'string' || !SHOP_SORTS.includes(params.sort as ShopListQuery['sort']))) return null;
  return { categoryId: params.displayCategory, query: { displayCategory: params.displayCategory, view: 'all', ips, types, priceMin: min, priceMax: max, sort: (params.sort as ShopListQuery['sort'] | undefined) ?? SHOP_DEFAULT_SORT.all } };
}

/** 다음 20개 응답의 카드 별점. 요청한 묶음의 굿즈 몫만 받고 형식이 틀린 값은 버린다 — 별점은 장식이라
 *  목록을 실패시키지 않지만 틀린 숫자를 그리지도 않는다(lib/goods-review-summary.ts 와 같은 규칙). */
export function categoryDisplayReviewSummaries(value: unknown, goodIds: readonly string[]): Record<string, GoodsReviewSummary> {
  const output: Record<string, GoodsReviewSummary> = {};
  if (!categoryDisplayRecord(value)) return output;
  const allowed = new Set(goodIds);
  for (const [id, summary] of Object.entries(value)) {
    if (!allowed.has(id) || !categoryDisplayRecord(summary)) continue;
    const { count, average } = summary;
    if (!Number.isSafeInteger(count) || Number(count) < 1 || typeof average !== 'number' || !Number.isFinite(average) || average < 1 || average > 5) continue;
    output[id] = { count: Number(count), average };
  }
  return output;
}

export function categoryDisplayQueryKey(categoryId: string, query: ShopListQuery): string {
  return JSON.stringify([categoryId, [...query.ips].sort(), [...query.types].sort(), query.priceMin, query.priceMax, query.sort]);
}
