import type { Stock } from '@/lib/data';
import { GOODS_READINESS_REASONS, goodsReadinessAnchor, type AdminGoodsReadiness, type GoodsReadinessFilter, type GoodsReadinessTarget } from './goods-readiness';

export const GOODS_LIST_PATH = '/admin/catalog/goods';
export const GOODS_LIST_PAGE_SIZE = 20;
export type GoodsListStatus = 'active' | 'all' | 'draft' | 'published' | 'archived';
export type GoodsListStock = Stock | 'all';
export interface GoodsListFilters {
  query: string;
  ipId: string;
  categoryId: string;
  readiness: GoodsReadinessFilter;
  page: number;
  status: GoodsListStatus;
  stock: GoodsListStock;
}
export interface AdminGoodSummary {
  id: string;
  code: string;
  name: string;
  ipId: string;
  ipTitle: string;
  publishedAt: string | null;
  archivedAt: string | null;
  stock: Stock;
  stockQty: number;
  activeStockQty: number;
  saleAvailableQty?: number;
  lowStockOptionCount: number;
  allowCardPayment?: boolean;
  allowBankTransfer?: boolean;
  saleRestriction?: 'none' | 'adult';
  noticeComplete: boolean;
  imageUrl?: string | null;
  categoryName?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  readiness?: AdminGoodsReadiness;
}
export interface AdminGoodsListData {
  filters: GoodsListFilters;
  goods: AdminGoodSummary[];
  total: number;
  checkedAt?: string;
  categories?: { id: string; name: string; depth: number; archivedAt: string | null }[];
  ips: { id: string; title: string; archivedAt: string | null }[];
}
const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
export function normalizeGoodsListFilters(values: Record<string, string | string[] | undefined>): GoodsListFilters {
  const page = Number(single(values.page));
  const ipId = single(values.ipId);
  const status = single(values.status);
  const categoryId = single(values.categoryId);
  const readiness = single(values.readiness);
  const stock = single(values.stock);
  return {
    categoryId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId) ? categoryId.toLowerCase() : '',
    readiness: ['ready', 'review_required'].includes(readiness) || Object.hasOwn(GOODS_READINESS_REASONS, readiness) ? readiness as GoodsReadinessFilter : 'all',
    query: single(values.q).trim().slice(0, 100),
    ipId: /^[a-z0-9][a-z0-9-]*$/.test(ipId) ? ipId.slice(0, 100) : '',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    status: ['active', 'all', 'draft', 'published', 'archived'].includes(status) ? status as GoodsListStatus : 'active',
    stock: ['ok', 'low', 'soldout'].includes(stock) ? stock as Stock : 'all',
  };
}
export function goodsListHref(filters: GoodsListFilters, page = filters.page): string {
  const params = new URLSearchParams({ status: filters.status, stock: filters.stock, page: String(page) });
  if (filters.query) params.set('q', filters.query);
  if (filters.ipId) params.set('ipId', filters.ipId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.readiness && filters.readiness !== 'all') params.set('readiness', filters.readiness);
  return `${GOODS_LIST_PATH}?${params}`;
}
export function goodEditorHref(filters: GoodsListFilters, id: string, target?: GoodsReadinessTarget): string {
  return `${goodsListHref(filters)}&${new URLSearchParams({ goodId: id })}${target ? `#${goodsReadinessAnchor(target)}` : ""}`;
}
