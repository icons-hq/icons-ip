import type { PhotoSize } from './photo-editor';
import { validatePhotoSticker, validatePhotoTextDecoration, type PhotoSticker, type PhotoTextDecoration } from './photo-editor-decorations';

export const PHOTO_LAYER_LIMIT = 8;
export const PHOTO_TEXT_LIMIT = 300;
export const PHOTO_TEXT_LINES = 8;
export type PhotoMosaic = { id: string; shape: 'rectangle' | 'circle'; x: number; y: number; width: number; height: number; blockSize: number };
export type PhotoText = PhotoTextDecoration & { id: string; text: string; x: number; y: number; fontSize: number; color: string };
export type PhotoLayers = { mosaics: PhotoMosaic[]; texts: PhotoText[]; stickers?: PhotoSticker[] };
const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

/** Layers use pixels of the EXIF-oriented source, before the editor's rotation/crop. */
export function validatePhotoLayers(layers: PhotoLayers, size?: PhotoSize): void {
  const stickers = layers.stickers === undefined ? [] : layers.stickers;
  if (!Array.isArray(layers.mosaics) || !Array.isArray(layers.texts) || !Array.isArray(stickers)
    || layers.mosaics.length > PHOTO_LAYER_LIMIT || layers.texts.length > PHOTO_LAYER_LIMIT || stickers.length > PHOTO_LAYER_LIMIT) throw new Error('편집 영역은 도구별 8개까지 추가할 수 있습니다.');
  const all = [...layers.mosaics, ...layers.texts, ...stickers];
  if (all.some(layer => !layer || typeof layer.id !== 'string' || !layer.id || layer.id.length > 80)
    || new Set(all.map(layer => layer.id)).size !== all.length) throw new Error('사진 편집 영역을 확인해주세요.');
  const width = size?.width ?? 4096, height = size?.height ?? 4096;
  if (all.some(layer => !finite(layer.x, 0, width - 1) || !finite(layer.y, 0, height - 1))
    || layers.mosaics.some(layer => !['rectangle', 'circle'].includes(layer.shape)
      || !finite(layer.width, 1, width - layer.x) || !finite(layer.height, 1, height - layer.y)
      || layer.shape === 'circle' && layer.width !== layer.height
      || !Number.isInteger(layer.blockSize) || !finite(layer.blockSize, 2, 128))
    || layers.texts.some(layer => typeof layer.text !== 'string' || layer.text.length > PHOTO_TEXT_LIMIT
      || layer.text.split('\n').length > PHOTO_TEXT_LINES || !finite(layer.fontSize, 8, 512)
      || typeof layer.color !== 'string' || !/^#[\da-f]{6}$/i.test(layer.color))) {
    throw new Error('사진 편집 영역과 텍스트 값을 확인해주세요.');
  }
  layers.texts.forEach(layer => validatePhotoTextDecoration(layer, layer.text));
  stickers.forEach(layer => validatePhotoSticker(layer, { width, height }));
}

export function fitPhotoMosaic(size: PhotoSize, current: PhotoMosaic, patch: Partial<PhotoMosaic>): PhotoMosaic {
  const next = { ...current, ...patch };
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
  if ([next.x, next.y, next.width, next.height, next.blockSize].some(value => !Number.isFinite(value))) return current;
  next.width = clamp(next.width, 1, size.width); next.height = clamp(next.height, 1, size.height);
  if (next.shape === 'circle') next.width = next.height = clamp(patch.height ?? next.width, 1, Math.min(size.width, size.height));
  next.x = clamp(next.x, 0, size.width - next.width); next.y = clamp(next.y, 0, size.height - next.height);
  next.blockSize = clamp(next.blockSize, 2, 128);
  return next;
}

/** Each block reads its original pixels before writing. Alpha and pixels outside the ROI stay exact.
 * Later regions deliberately operate on earlier regions; transparent RGB never bleeds into averages.
 * Yield counts are bounded even when a region covers the complete 4MP image. */
export function* mosaicPhotoPixels(pixels: Uint8ClampedArray, size: PhotoSize, regions: readonly PhotoMosaic[]): Generator<void> {
  let work = 0;
  for (const region of regions) {
    const left = Math.round(region.x), top = Math.round(region.y);
    const right = Math.min(size.width, Math.round(region.x + region.width)), bottom = Math.min(size.height, Math.round(region.y + region.height));
    const cx = region.x + region.width / 2, cy = region.y + region.height / 2, radiusSquared = (region.width / 2) ** 2;
    const includes = region.shape === 'rectangle' ? () => true : (x: number, y: number) => (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= radiusSquared;
    for (let y = top; y < bottom; y += region.blockSize) for (let x = left; x < right; x += region.blockSize) {
      const endX = Math.min(x + region.blockSize, right), endY = Math.min(y + region.blockSize, bottom);
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let py = y; py < endY; py++) for (let px = x; px < endX; px++) {
        if (!includes(px, py)) continue;
        const index = (py * size.width + px) * 4, weight = pixels[index + 3];
        red += pixels[index] * weight; green += pixels[index + 1] * weight; blue += pixels[index + 2] * weight; alpha += weight;
      }
      if (alpha) {
        red = Math.round(red / alpha); green = Math.round(green / alpha); blue = Math.round(blue / alpha);
        for (let py = y; py < endY; py++) for (let px = x; px < endX; px++) {
          const index = (py * size.width + px) * 4;
          if (!pixels[index + 3] || !includes(px, py)) continue;
          pixels[index] = red; pixels[index + 1] = green; pixels[index + 2] = blue;
        }
      }
      work += (endX - x) * (endY - y) * 2;
      if (work >= 32768) { work = 0; yield; }
    }
  }
}
