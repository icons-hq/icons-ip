import { validatePhotoLayers, type PhotoLayers } from './photo-editor-layers';
import { validatePhotoEffects, type PhotoEffects } from './photo-editor-effects';
import { validatePhotoPresentation, type PhotoPresentation } from './photo-editor-presentation';
import { validatePhotoLogo, type PhotoLogo } from './photo-editor-logo';
import { validatePhotoFilter, type PhotoFilter } from './photo-editor-filters';
import { photoStraightenPoint, validatePhotoStraighten } from './photo-editor-straighten';

/** Deterministic recipe/geometry. No DOM, network, uploads or product state. */
export type PhotoSize = { width: number; height: number };
export type PhotoCrop = { x: number; y: number; width: number; height: number };
export type PhotoAdjustments = { brightness: number; contrast: number; saturation: number; temperature?: number };
export type PhotoRecipe = PhotoAdjustments & PhotoLayers & PhotoEffects & PhotoPresentation & {
  logo: PhotoLogo | null;
  automaticLevels: boolean;
  filter: PhotoFilter;
  filterStrength: number;
  temperature: number;
  turns: 0 | 1 | 2 | 3;
  flipX: boolean;
  flipY: boolean;
  /** Clockwise degrees after quarter turns and mirroring; edges are cropped to fill. */
  straightenDegrees: number;
  /** Fractions of the complete image after rotation and mirroring. */
  crop: PhotoCrop;
};

export function initialPhotoRecipe(): PhotoRecipe {
  return { turns: 0, flipX: false, flipY: false, straightenDegrees: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, brightness: 0, contrast: 0, saturation: 0, temperature: 0,
    sharpness: 0, circularBlur: 0, linearBlur: 0, vignette: 0, mosaics: [], texts: [], stickers: [],
    automaticLevels: false, filter: 'none', filterStrength: 100, mask: 'none', frameWidth: 0, frameStyle: 'solid', frameColor: '#ffffff', logo: null };
}

export function validatePhotoRecipe(recipe: PhotoRecipe): void {
  const crop = recipe.crop;
  if (!Number.isInteger(recipe.turns) || recipe.turns < 0 || recipe.turns > 3
    || typeof recipe.flipX !== 'boolean' || typeof recipe.flipY !== 'boolean' || typeof recipe.automaticLevels !== 'boolean' || !Number.isInteger(recipe.filterStrength)
    || !crop || [crop.x, crop.y, crop.width, crop.height].some(value => !Number.isFinite(value))
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > 1 + 1e-10 || crop.y + crop.height > 1 + 1e-10
    || [recipe.brightness, recipe.contrast, recipe.saturation, recipe.temperature].some(value => !Number.isFinite(value) || value < -100 || value > 100)) {
    throw new Error('사진 편집 범위와 보정 값을 확인해주세요.');
  }
  validatePhotoLayers(recipe);
  validatePhotoEffects(recipe);
  validatePhotoPresentation(recipe);
  validatePhotoLogo(recipe.logo);
  validatePhotoFilter(recipe.filter, recipe.filterStrength);
  validatePhotoStraighten(recipe.straightenDegrees);
}

export function photoRecipeUnchanged(recipe: PhotoRecipe): boolean {
  validatePhotoRecipe(recipe);
  return recipe.turns === 0 && !recipe.flipX && !recipe.flipY && recipe.straightenDegrees === 0
    && recipe.crop.x === 0 && recipe.crop.y === 0 && recipe.crop.width === 1 && recipe.crop.height === 1
    && recipe.brightness === 0 && recipe.contrast === 0 && recipe.saturation === 0 && recipe.temperature === 0
    && recipe.sharpness === 0 && recipe.circularBlur === 0 && recipe.linearBlur === 0 && recipe.vignette === 0
    && !recipe.automaticLevels && (recipe.filter === 'none' || recipe.filterStrength === 0) && recipe.mask === 'none' && recipe.frameWidth === 0
    && (!recipe.logo || recipe.logo.opacity === 0)
    && !(recipe.stickers ?? []).some(layer => layer.opacity > 0)
    && recipe.mosaics.length === 0 && !recipe.texts.some(layer => layer.text.trim());
}

export function orientedPhotoSize(source: PhotoSize, recipe: PhotoRecipe): PhotoSize {
  return recipe.turns % 2 ? { width: source.height, height: source.width } : source;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Map normalized points in either direction; annotations remain in source pixels. */
export function photoSourcePoint(point: { x: number; y: number }, recipe: PhotoRecipe, source: PhotoSize): { x: number; y: number } {
  const level = photoStraightenPoint(point, orientedPhotoSize(source, recipe), recipe.straightenDegrees, true);
  const x = recipe.flipX ? 1 - level.x : level.x, y = recipe.flipY ? 1 - level.y : level.y;
  switch (recipe.turns) {
    case 1: return { x: y, y: 1 - x };
    case 2: return { x: 1 - x, y: 1 - y };
    case 3: return { x: 1 - y, y: x };
    default: return { x, y };
  }
}

export function photoOrientedPoint(point: { x: number; y: number }, recipe: PhotoRecipe, source: PhotoSize): { x: number; y: number } {
  const turned = recipe.turns === 1 ? { x: 1 - point.y, y: point.x }
    : recipe.turns === 2 ? { x: 1 - point.x, y: 1 - point.y }
      : recipe.turns === 3 ? { x: point.y, y: 1 - point.x } : point;
  return photoStraightenPoint({ x: recipe.flipX ? 1 - turned.x : turned.x, y: recipe.flipY ? 1 - turned.y : turned.y }, orientedPhotoSize(source, recipe), recipe.straightenDegrees);
}

export function photoCropPixels(source: PhotoSize, recipe: PhotoRecipe): PhotoCrop {
  validatePhotoRecipe(recipe);
  const { width, height } = orientedPhotoSize(source, recipe);
  const x = clamp(Math.round(recipe.crop.x * width), 0, width - 1);
  const y = clamp(Math.round(recipe.crop.y * height), 0, height - 1);
  const right = clamp(Math.round((recipe.crop.x + recipe.crop.width) * width), x + 1, width);
  const bottom = clamp(Math.round((recipe.crop.y + recipe.crop.height) * height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

/** A screen-clockwise quarter turn also rotates mirrors and the selected rectangle. */
export function rotatePhotoRecipe(recipe: PhotoRecipe, direction: -1 | 1): PhotoRecipe {
  const c = recipe.crop;
  return { ...recipe, turns: ((recipe.turns + direction + 4) % 4) as PhotoRecipe['turns'], flipX: recipe.flipY, flipY: recipe.flipX,
    crop: direction === 1
      ? { x: Math.max(0, 1 - c.y - c.height), y: c.x, width: c.height, height: c.width }
      : { x: c.y, y: Math.max(0, 1 - c.x - c.width), width: c.height, height: c.width } };
}

export function flipPhotoRecipe(recipe: PhotoRecipe, axis: 'x' | 'y'): PhotoRecipe {
  return axis === 'x'
    ? { ...recipe, flipX: !recipe.flipX, straightenDegrees: -recipe.straightenDegrees || 0, crop: { ...recipe.crop, x: Math.max(0, 1 - recipe.crop.x - recipe.crop.width) } }
    : { ...recipe, flipY: !recipe.flipY, straightenDegrees: -recipe.straightenDegrees || 0, crop: { ...recipe.crop, y: Math.max(0, 1 - recipe.crop.y - recipe.crop.height) } };
}

export function setPhotoCrop(source: PhotoSize, recipe: PhotoRecipe, patch: Partial<PhotoCrop>, ratio?: number): PhotoRecipe {
  if (Object.values(patch).some(value => !Number.isFinite(value)) || ratio !== undefined && (!Number.isFinite(ratio) || ratio <= 0)) return recipe;
  const size = orientedPhotoSize(source, recipe), old = photoCropPixels(source, recipe);
  const resizing = patch.width !== undefined || patch.height !== undefined;
  const x = clamp(Math.round(patch.x ?? old.x), 0, size.width - (resizing ? 1 : old.width));
  const y = clamp(Math.round(patch.y ?? old.y), 0, size.height - (resizing ? 1 : old.height));
  let width = clamp(Math.round(patch.width ?? old.width), 1, size.width - x);
  let height = clamp(Math.round(patch.height ?? old.height), 1, size.height - y);
  if (ratio && resizing) {
    if (patch.height !== undefined && patch.width === undefined) width = height * ratio;
    else height = width / ratio;
    const fit = Math.min(1, (size.width - x) / width, (size.height - y) / height);
    width = Math.max(1, Math.round(width * fit)); height = Math.max(1, Math.round(height * fit));
  }
  return { ...recipe, crop: { x: x / size.width, y: y / size.height, width: width / size.width, height: height / size.height } };
}

export function fitPhotoCrop(source: PhotoSize, recipe: PhotoRecipe, ratio: number): PhotoRecipe {
  const size = orientedPhotoSize(source, recipe);
  const width = Math.min(size.width, size.height * ratio), height = width / ratio;
  return setPhotoCrop(source, recipe, { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height });
}

/** Pure RGB calculation. Alpha is untouched, including fully transparent pixels. */
export function adjustedPhotoPixels(input: Uint8ClampedArray, adjustments: PhotoAdjustments): Uint8ClampedArray {
  const output = new Uint8ClampedArray(input);
  adjustPhotoPixelBlock(output, adjustments);
  return output;
}

/** Internal render seam: process a bounded block in place, yielding between blocks. */
export function adjustPhotoPixelBlock(pixels: Uint8ClampedArray, { brightness, contrast, saturation, temperature = 0 }: PhotoAdjustments, start = 0, end = pixels.length): void {
  if (brightness === 0 && contrast === 0 && saturation === 0 && temperature === 0) return;
  const offset = brightness * 2.55, contrastScale = 1 + contrast / 100, saturationScale = 1 + saturation / 100;
  for (let index = start; index < end; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const red = (pixels[index] + offset - 127.5) * contrastScale + 127.5;
    const green = (pixels[index + 1] + offset - 127.5) * contrastScale + 127.5;
    const blue = (pixels[index + 2] + offset - 127.5) * contrastScale + 127.5;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    // ICONS relative warmth, not Kelvin: symmetric red/blue offset after tone adjustment.
    pixels[index] = Math.round(luminance + (red - luminance) * saturationScale + temperature * .4);
    pixels[index + 1] = Math.round(luminance + (green - luminance) * saturationScale);
    pixels[index + 2] = Math.round(luminance + (blue - luminance) * saturationScale - temperature * .4);
  }
}
