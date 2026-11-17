import type { HomeGoodsCard } from './home-catalog';

export const HOME_FREE_PRODUCT_LIMIT = 5;
export const HOME_PRODUCT_CANDIDATE_LIMIT = 100;
export const HOME_PRODUCT_TITLE_LIMIT = 15;
/** 'grid'(그리드형 5열)는 X SQUARE 홈의 IP 상품 섹션이다(ADR-0043) — 5개 또는 10개, 정사각 이미지 고정. */
export type HomeProductLayout = 'list' | 'full_image' | 'grid';
export const HOME_GRID_ITEM_COUNTS = [5, 10] as const;
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
  /** 'grid'일 때만: 고른 상품이 모두 한 IP면 그 IP의 공개 주소, 아니면 null(전체보기 알약 없음). */
  moreHref?: string | null;
}

const GOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const PAYLOAD_KEYS = ['layout', 'image_shape', 'item_count', 'good_ids'];

export function isHomeProductLayout(value: unknown): value is HomeProductLayout {
  return value === 'list' || value === 'full_image' || value === 'grid';
}
export function isHomeProductImageShape(value: unknown): value is HomeProductImageShape {
  return value === 'square' || value === 'portrait' || value === 'landscape';
}
export function homeProductCountRange(layout: HomeProductLayout): readonly [number, number] {
  return layout === 'list' ? [3, 12] : layout === 'grid' ? [HOME_GRID_ITEM_COUNTS[0], HOME_GRID_ITEM_COUNTS[1]] : [1, 8];
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
  /* 그리드형은 5·10 두 값만, 이미지는 정사각 고정이다 — DB `private.is_valid_home_product_collection`과 같은 규칙. */
  if (input.layout === 'grid' && (!(HOME_GRID_ITEM_COUNTS as readonly number[]).includes(input.item_count) || input.image_shape !== 'square')) return null;
  return { layout: input.layout, image_shape: input.image_shape, item_count: input.item_count, good_ids: [...input.good_ids] };
}

/**
 * '전체보기' 목적지: 보이는 상품이 전부 같은 IP면 그 IP의 공개 주소, 아니면(여러 IP·IP 주소 없음·상품 없음) null.
 * 링크는 어드민이 고르지 않는다 — 상품 모음 행은 링크가 없는 레코드라(DB 제약) 목적지를 상품에서 파생한다.
 */
export function collectionMoreHref(goods: readonly Pick<HomeGoodsCard, 'ipHref'>[]): string | null {
  const first = goods[0]?.ipHref;
  if (!first) return null;
  return goods.every((good) => good.ipHref === first) ? first : null;
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
  return { id, title, layout: payload.layout, imageShape: payload.image_shape, goods,
    ...(payload.layout === 'grid' ? { moreHref: collectionMoreHref(goods) } : {}) };
}
