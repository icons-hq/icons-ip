import type { GoodsNoticeKey } from '@/lib/goods-notice';
import { GOODS_KC_FAMILY_LABELS, GOODS_KC_SCHEME_LABELS, goodsKcSchemeAllowed, type GoodsKcFamily, type GoodsKcScheme } from '@/lib/goods-kc';

/** A reusable classification draft, without model identity, evidence or review status. */
export interface GoodsKcPresetTemplate {family:GoodsKcFamily;scheme:GoodsKcScheme;publicNote:string}
export function normalizeGoodsKcPresetTemplate(value:unknown):GoodsKcPresetTemplate|null {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null;
  const row=value as Record<string,unknown>;
  if (Object.keys(row).length!==3 || !Object.keys(row).every(key=>['family','scheme','publicNote'].includes(key))
    || typeof row.family!=='string' || !Object.hasOwn(GOODS_KC_FAMILY_LABELS,row.family)
    || typeof row.scheme!=='string' || !Object.hasOwn(GOODS_KC_SCHEME_LABELS,row.scheme)
    || !goodsKcSchemeAllowed(row.family as GoodsKcFamily,row.scheme as GoodsKcScheme)
    || typeof row.publicNote!=='string' || row.publicNote.length>1000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.publicNote)
    || (row.scheme!=='not_applicable' && row.publicNote.trim())) return null;
  return {family:row.family as GoodsKcFamily,scheme:row.scheme as GoodsKcScheme,publicNote:row.publicNote.trim()};
}

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
  kcTemplate?: GoodsKcPresetTemplate | null;
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
