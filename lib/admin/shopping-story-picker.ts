import { isUuid } from '@/lib/uuid';
import type { ShoppingStoryGoodOption } from './shopping-stories';

export const STORY_GOOD_SORTS = { latest: '등록일 최신순', popular: '인기순 (찜)', sales: '최근 30일 판매순', reviews: '리뷰 많은순', rating: '평점 높은순', price_asc: '낮은 가격순', price_desc: '높은 가격순', name: '상품명순' } as const;
export interface StoryGoodFilters {
  field: 'all' | 'name' | 'code' | 'id'; categoryId: string | null;
  visibility: 'all' | 'published' | 'draft'; stock: 'all' | 'available' | 'soldout'; saleType: 'all' | 'stock' | 'preorder';
  freeShipping: boolean; discounted: boolean; reviews: 'all' | 'with' | 'without'; minRating: 0 | 3 | 4 | 4.5;
  sort: keyof typeof STORY_GOOD_SORTS; minPrice: number | null; maxPrice: number | null;
}
export const DEFAULT_STORY_GOOD_FILTERS: StoryGoodFilters = { field: 'all', categoryId: null, visibility: 'all', stock: 'all', saleType: 'all', freeShipping: false, discounted: false, reviews: 'all', minRating: 0, sort: 'latest', minPrice: null, maxPrice: null };
export interface StoryGoodCandidate extends ShoppingStoryGoodOption { reviewCount: number; ratingAverage: number | null; wishCount: number; salesQuantity: number; freeShipping: boolean; discounted: boolean; saleType: 'stock' | 'preorder' }
export interface StoryGoodCandidates { rows: StoryGoodCandidate[]; total: number; page: number; pageSize: 20; checkedAt: string; categories: { id: string; path: string }[] }
export function validStoryGoodFilters(value: unknown): value is StoryGoodFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== Object.keys(DEFAULT_STORY_GOOD_FILTERS).length || Object.keys(row).some(key => !Object.hasOwn(DEFAULT_STORY_GOOD_FILTERS, key))) return false;
  const amount = (raw: unknown) => raw === null || (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= 100_000_000);
  return ['all', 'name', 'code', 'id'].includes(String(row.field)) && (row.categoryId === null || isUuid(row.categoryId))
    && ['all', 'published', 'draft'].includes(String(row.visibility)) && ['all', 'available', 'soldout'].includes(String(row.stock))
    && ['all', 'stock', 'preorder'].includes(String(row.saleType)) && typeof row.freeShipping === 'boolean' && typeof row.discounted === 'boolean'
    && ['all', 'with', 'without'].includes(String(row.reviews)) && [0, 3, 4, 4.5].includes(Number(row.minRating)) && typeof row.minRating === 'number'
    && typeof row.sort === 'string' && Object.hasOwn(STORY_GOOD_SORTS, row.sort) && amount(row.minPrice) && amount(row.maxPrice)
    && (row.minPrice === null || row.maxPrice === null || Number(row.minPrice) <= Number(row.maxPrice));
}

/** Keep choices across pages, but count only genuinely new goods toward both limits. */
export function storyGoodSelectionCapacity(existingIds: string[], sectionCount: number) { return Math.max(0, Math.min(200 - sectionCount, 300 - new Set(existingIds).size)); }
