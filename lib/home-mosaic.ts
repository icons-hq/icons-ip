import type { HomeGoodsCard } from './home-catalog';

export const HOME_MOSAIC_SLOT_COUNT = 8;
export const HOME_MOSAIC_IMAGE_MAX_BYTES = 900 * 1024;
export interface HomeMosaicSlot { good_id: string | null; image_path: string | null }
export interface HomeMosaicPayload { mosaic_title: string; mosaic_subtitle: string; slots: HomeMosaicSlot[] }
export interface HomeMosaicTile { good: HomeGoodsCard; imageUrl: string }
export interface HomeMosaicBand {
  id: string;
  title: string;
  heading: string;
  subtitle: string;
  tiles: (HomeMosaicTile | null)[];
}
const GOOD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_PATH = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function caption(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value === value.trim() && [...value].length <= limit && !CONTROL.test(value);
}
export function emptyHomeMosaicSlots(): HomeMosaicSlot[] {
  return Array.from({ length: HOME_MOSAIC_SLOT_COUNT }, () => ({ good_id: null, image_path: null }));
}
export function parseHomeMosaicPayload(value: unknown): HomeMosaicPayload | null {
  if (!object(value) || Object.keys(value).length !== 3 || !caption(value.mosaic_title, 10)
    || !caption(value.mosaic_subtitle, 20) || !Array.isArray(value.slots) || value.slots.length !== HOME_MOSAIC_SLOT_COUNT) return null;
  const slots: HomeMosaicSlot[] = [];
  for (const slot of value.slots) {
    if (!object(slot) || Object.keys(slot).length !== 2 || !('good_id' in slot) || !('image_path' in slot)
      || (slot.good_id !== null && (typeof slot.good_id !== 'string' || !GOOD_ID.test(slot.good_id)))
      || (slot.image_path !== null && (typeof slot.image_path !== 'string' || !IMAGE_PATH.test(slot.image_path)))) return null;
    slots.push({ good_id: slot.good_id, image_path: slot.image_path } as HomeMosaicSlot);
  }
  return { mosaic_title: value.mosaic_title, mosaic_subtitle: value.mosaic_subtitle, slots };
}

/** Keep slot positions when a product is missing, private, or lacks its image. */
export function buildHomeMosaicBand(id: string, title: string, payload: HomeMosaicPayload,
  goods: readonly HomeGoodsCard[], imageUrlForPath: (path: string) => string): HomeMosaicBand {
  const byId = new Map(goods.map(good => [good.id, good]));
  return { id, title, heading: payload.mosaic_title, subtitle: payload.mosaic_subtitle,
    tiles: payload.slots.map(slot => {
      const good = slot.good_id ? byId.get(slot.good_id) : undefined;
      return good && slot.image_path ? { good, imageUrl: imageUrlForPath(slot.image_path) } : null;
    }),
  };
}
