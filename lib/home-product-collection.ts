import type { HomeGoodsCard } from './home-catalog';

export const HOME_FREE_PRODUCT_LIMIT = 5;
export const HOME_PRODUCT_CANDIDATE_LIMIT = 100;
export const HOME_PRODUCT_TITLE_LIMIT = 15;
export type HomeProductLayout = 'list' | 'full_image';
export type HomeProductImageShape = 'square' | 'portrait' | 'landscape';
export interface HomeProductCollectionPayload {
  layout: HomeProductLayout;
  image_shape: HomeProductImageShape;
  item_count: number;
  good_ids: string[];
}
export interface HomeProductCollectionBand {
  id: string;
  title: string;
  layout: HomeProductLayout;
  imageShape: HomeProductImageShape;
  goods: HomeGoodsCard[];
}

const GOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const PAYLOAD_KEYS = ['layout', 'image_shape', 'item_count', 'good_ids'];

export function isHomeProductLayout(value: unknown): value is HomeProductLayout {
  return value === 'list' || value === 'full_image';
}
export function isHomeProductImageShape(value: unknown): value is HomeProductImageShape {
  return value === 'square' || value === 'portrait' || value === 'landscape';
}
export function homeProductCountRange(layout: HomeProductLayout): readonly [number, number] {
  return layout === 'list' ? [3, 12] : [1, 8];
}
export function isHomeProductCollectionTitle(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && [...value].length >= 1
    && [...value].length <= HOME_PRODUCT_TITLE_LIMIT && !CONTROL.test(value);
}
export function parseHomeProductCollectionPayload(value: unknown): HomeProductCollectionPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== PAYLOAD_KEYS.length || Object.keys(input).some(key => !PAYLOAD_KEYS.includes(key))
    || !isHomeProductLayout(input.layout) || !isHomeProductImageShape(input.image_shape)
    || typeof input.item_count !== 'number' || !Number.isInteger(input.item_count)
    || !Array.isArray(input.good_ids) || input.good_ids.length > HOME_PRODUCT_CANDIDATE_LIMIT
    || input.good_ids.some(id => typeof id !== 'string' || !GOOD_ID.test(id))
    || new Set(input.good_ids).size !== input.good_ids.length) return null;
  const [min, max] = homeProductCountRange(input.layout);
  if (input.item_count < min || input.item_count > max) return null;
  return { layout: input.layout, image_shape: input.image_shape, item_count: input.item_count, good_ids: [...input.good_ids] };
}

/** Public eligibility is resolved before the display count; the saved candidate list stays untouched. */
export function buildHomeProductCollectionBand(id: string, title: string, payload: HomeProductCollectionPayload,
  publicGoods: readonly HomeGoodsCard[]): HomeProductCollectionBand {
  const byId = new Map(publicGoods.map(good => [good.id, good]));
  const goods: HomeGoodsCard[] = [];
  for (const goodId of payload.good_ids) {
    const good = byId.get(goodId);
    if (!good) continue;
    goods.push(good);
    if (goods.length === payload.item_count) break;
  }
  return { id, title, layout: payload.layout, imageShape: payload.image_shape, goods };
}
