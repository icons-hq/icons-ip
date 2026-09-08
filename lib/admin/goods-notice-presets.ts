import type { GoodsNoticeKey } from '@/lib/goods-notice';

export const GOODS_NOTICE_PRESETS_PATH = '/admin/catalog/notice-presets';
export const GOODS_NOTICE_PRESET_NAME_MAX = 80;
export const GOODS_NOTICE_PRESET_FIELD_MAX = 1000;
export const GOODS_NOTICE_PRESET_PAGE_SIZE = 20;

/** A saved template always contains all seven values; applying it copies this object. */
export interface GoodsNoticePreset {
  id: string;
  name: string;
  notice: Record<GoodsNoticeKey, string>;
  updatedAt: string;
}

export interface GoodsNoticePresetFilters { query: string; page: number }
export interface GoodsNoticePresetPageData {
  presets: GoodsNoticePreset[];
  total: number;
  filters: GoodsNoticePresetFilters;
}

export function normalizeGoodsNoticePresetFilters(params: Record<string, string | string[] | undefined>): GoodsNoticePresetFilters {
  return {
    query: typeof params.q === 'string' ? params.q.trim().slice(0, GOODS_NOTICE_PRESET_NAME_MAX) : '',
    page: Math.min(10000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)),
  };
}

export function goodsNoticePresetHref(filters: GoodsNoticePresetFilters, page = filters.page) {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (page > 1) params.set('page', String(page));
  return `${GOODS_NOTICE_PRESETS_PATH}${params.size ? `?${params}` : ''}`;
}
