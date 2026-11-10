import type { PhotoSize } from './photo-editor';
import { inspectPhotoSource, PHOTO_EDIT_MAX_BYTES } from './photo-editor-source';

export type PhotoLogo = { assetId: string; x: number; y: number; width: number; opacity: number };
export type PhotoLogoDescriptor = Readonly<PhotoSize & { assetId: string; sha256: string; mimeType: string; filename: string }>;
export type PhotoLogoPreset = 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';
export const PHOTO_LOGO_MAX_PIXELS = 1_000_000;
export const PHOTO_LOGO_MAX_EDGE = 2048;

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('로고 불러오기를 취소했습니다.', 'AbortError');
}

/** A local file only. Validate the container before decoding; never fetch or create an object URL. */
export async function decodePhotoLogo(file: File, signal: AbortSignal): Promise<{ descriptor: PhotoLogoDescriptor; bitmap: ImageBitmap }> {
  checkAbort(signal);
  if (!file.size || file.size > PHOTO_EDIT_MAX_BYTES) throw new Error('로고는 5MB 이하의 정지 이미지 파일을 선택해주세요.');
  const bytes = await file.arrayBuffer(); checkAbort(signal);
  const metadata = inspectPhotoSource(new Uint8Array(bytes), file.type || undefined);
  if (metadata.width * metadata.height > PHOTO_LOGO_MAX_PIXELS || Math.max(metadata.width, metadata.height) > PHOTO_LOGO_MAX_EDGE)
    throw new Error('로고는 100만 픽셀 이하, 가로·세로 2048px 이하로 준비해주세요.');
  const digest = await crypto.subtle.digest('SHA-256', bytes); checkAbort(signal);
  const assetId = crypto.randomUUID();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: metadata.mimeType }), { imageOrientation: 'from-image' }); }
  catch { checkAbort(signal); throw new Error('로고 이미지를 해석하지 못했습니다. 기존 로고는 유지됩니다.'); }
  try {
    checkAbort(signal);
    const swaps = (metadata.orientation ?? 1) >= 5;
    if (bitmap.width !== (swaps ? metadata.height : metadata.width) || bitmap.height !== (swaps ? metadata.width : metadata.height))
      throw new Error('로고의 방향 또는 크기를 확인하지 못했습니다. 기존 로고는 유지됩니다.');
    return { bitmap, descriptor: Object.freeze({ assetId, width: bitmap.width, height: bitmap.height, mimeType: metadata.mimeType,
      filename: file.name, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') }) };
  } catch (error) { bitmap.close(); throw error; }
}

export function validatePhotoLogo(logo: PhotoLogo | null, source?: PhotoSize, asset?: PhotoLogoDescriptor): void {
  if (logo === null) return;
  if (!logo || typeof logo.assetId !== 'string' || !logo.assetId || logo.assetId.length > 128
    || [logo.x, logo.y, logo.width, logo.opacity].some(value => !Number.isFinite(value))
    || logo.x < 0 || logo.y < 0 || logo.width <= 0 || !Number.isInteger(logo.opacity) || logo.opacity < 0 || logo.opacity > 100)
    throw new Error('로고 위치·크기·불투명도를 확인해주세요.');
  if (source && asset) {
    const maximum = photoLogoMaximum(source, asset), height = logo.width * asset.height / asset.width;
    if (logo.assetId !== asset.assetId || logo.width < maximum / 100 - 1e-8 || logo.width > maximum + 1e-8
      || logo.x + logo.width > source.width + 1e-8 || logo.y + height > source.height + 1e-8)
      throw new Error('현재 로고와 사진 안의 배치 범위를 확인해주세요.');
  }
}

export function photoLogoMaximum(source: PhotoSize, asset: PhotoSize): number {
  return Math.min(source.width, source.height * asset.width / asset.height);
}

/** Aspect-locked placement in EXIF-oriented source pixels, before crop/rotation/mirroring. */
export function fitPhotoLogo(source: PhotoSize, asset: PhotoLogoDescriptor, logo?: PhotoLogo | null, patch: Partial<PhotoLogo> = {}): PhotoLogo {
  const maximum = photoLogoMaximum(source, asset), base = logo ?? { assetId: asset.assetId, width: maximum * .25, x: 0, y: 0, opacity: 100 };
  const next = { ...base, ...patch, assetId: asset.assetId };
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  next.width = clamp(Number.isFinite(next.width) ? next.width : base.width, maximum / 100, maximum);
  next.opacity = Math.round(clamp(Number.isFinite(next.opacity) ? next.opacity : base.opacity, 0, 100));
  next.x = clamp(Number.isFinite(next.x) ? next.x : base.x, 0, source.width - next.width);
  next.y = clamp(Number.isFinite(next.y) ? next.y : base.y, 0, Math.max(0, source.height - next.width * asset.height / asset.width));
  return next;
}

export function positionPhotoLogo(source: PhotoSize, asset: PhotoLogoDescriptor, logo: PhotoLogo, preset: PhotoLogoPreset): PhotoLogo {
  const width = logo.width, height = width * asset.height / asset.width, padding = Math.min(source.width, source.height) * .02;
  return fitPhotoLogo(source, asset, logo, { x: preset === 'center' ? (source.width - width) / 2 : preset.endsWith('right') ? source.width - width - padding : padding,
    y: preset === 'center' ? (source.height - height) / 2 : preset.startsWith('bottom') ? source.height - height - padding : padding });
}

export function drawPhotoLogo(context: CanvasRenderingContext2D, bitmap: ImageBitmap, logo: PhotoLogo): void {
  if (!logo.opacity) return;
  context.save();
  try {
    context.globalCompositeOperation = 'source-over'; context.globalAlpha = logo.opacity / 100;
    context.drawImage(bitmap, logo.x, logo.y, logo.width, logo.width * bitmap.height / bitmap.width);
  } finally { context.restore(); }
}
