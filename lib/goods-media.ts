import { isUuid } from './uuid';

export type GoodsMediaKind = 'video' | 'shortclip';
export type GoodsMediaPriority = 'image' | GoodsMediaKind;
export const GOODS_MEDIA_KINDS: GoodsMediaKind[] = ['video', 'shortclip'];
export const GOODS_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const GOODS_MEDIA_MAX_DURATION_MS = 60_000;
export const GOODS_MEDIA_MAX_DIMENSION = 1920;
export const GOODS_MEDIA_ACCEPT = 'video/mp4';
export const GOODS_MEDIA_BUCKET = 'goods-videos';
export const GOODS_MEDIA_STAGING_BUCKET = 'goods-video-staging';
export const GOODS_MEDIA_PATH = '/admin/catalog/goods/media';
export const GOODS_MEDIA_SETTINGS_PATH = '/admin/display/detail/media';
export const GOODS_MEDIA_GUIDANCE = 'MP4(H.264, 선택 AAC 음성) · 최대 50MB · 1분 · 가로·세로 최대 1920px. 숏클립은 세로 영상을 권장합니다.';
export const GOODS_MEDIA_FILE_ERROR = 'MP4 형식의 50MB 이하, 1분 이하 H.264 영상을 선택해주세요.';

export interface GoodsMediaMetadata { width: number; height: number; durationMs: number; byteSize: number; sha256: string; videoCodec: string; audioCodec: string | null }
export interface GoodsMediaAsset extends GoodsMediaMetadata { id: string; kind: GoodsMediaKind; path: string; title: string; url: string }
export interface GoodMediaSnapshot { goodId: string; goodName: string; revision: number; video: GoodsMediaAsset | null; shortclip: GoodsMediaAsset | null; unavailable?: boolean }
export interface GoodsMediaSettings { priority: GoodsMediaPriority; shortclips: boolean }
export interface GoodsMediaSettingsSnapshot { revision: number; values: GoodsMediaSettings; unavailable?: boolean }
export interface PublicGoodMedia { settings: GoodsMediaSettings; video: GoodsMediaAsset | null; shortclip: GoodsMediaAsset | null }
export const DEFAULT_GOODS_MEDIA_SETTINGS: GoodsMediaSettings = { priority: 'image', shortclips: false };

export function isGoodsMediaKind(value: unknown): value is GoodsMediaKind { return value === 'video' || value === 'shortclip'; }
export function goodsMediaPath(kind: GoodsMediaKind, id: string) { if (!isUuid(id)) throw new Error('Invalid media id'); return `${kind}/${id.toLowerCase()}.mp4`; }
export function parseGoodsMediaPath(value: unknown): { kind: GoodsMediaKind; id: string; path: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(video|shortclip)\/([0-9a-f-]{36})\.mp4$/.exec(value);
  return match && isUuid(match[2]) ? { kind: match[1] as GoodsMediaKind, id: match[2], path: value } : null;
}
export function validGoodsMediaUpload(input: { kind: unknown; mimeType: unknown; size: unknown }): input is { kind: GoodsMediaKind; mimeType: 'video/mp4'; size: number } {
  return isGoodsMediaKind(input.kind) && input.mimeType === GOODS_MEDIA_ACCEPT && Number.isSafeInteger(input.size) && Number(input.size) > 0 && Number(input.size) <= GOODS_MEDIA_MAX_BYTES;
}
export function parseGoodsMediaMetadata(value: unknown): GoodsMediaMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.width) || Number(v.width) < 1 || Number(v.width) > GOODS_MEDIA_MAX_DIMENSION
    || !Number.isSafeInteger(v.height) || Number(v.height) < 1 || Number(v.height) > GOODS_MEDIA_MAX_DIMENSION
    || !Number.isSafeInteger(v.durationMs) || Number(v.durationMs) < 1 || Number(v.durationMs) > GOODS_MEDIA_MAX_DURATION_MS
    || !Number.isSafeInteger(v.byteSize) || Number(v.byteSize) < 1 || Number(v.byteSize) > GOODS_MEDIA_MAX_BYTES
    || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)
    || typeof v.videoCodec !== 'string' || !/^avc1\.[a-fA-F0-9]{6}$/.test(v.videoCodec)
    || v.audioCodec !== null && v.audioCodec !== 'mp4a.40.2') return null;
  return { width: Number(v.width), height: Number(v.height), durationMs: Number(v.durationMs), byteSize: Number(v.byteSize), sha256: v.sha256, videoCodec: v.videoCodec, audioCodec: v.audioCodec as string | null };
}
export function parseGoodsMediaSettings(value: unknown): GoodsMediaSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !['image', 'video', 'shortclip'].includes(String(v.priority)) || typeof v.shortclips !== 'boolean') return null;
  return { priority: v.priority as GoodsMediaPriority, shortclips: v.shortclips };
}
export function normalizeGoodsMediaTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim(); return title.length >= 1 && Array.from(title).length <= 20 && !/[\u0000-\u001f\u007f]/.test(title) ? title : null;
}
export function goodsVideoUrl(path: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  return base && parseGoodsMediaPath(path) ? `${base.replace(/\/+$/, '')}/storage/v1/object/public/${GOODS_MEDIA_BUCKET}/${path}` : null;
}
export function parseGoodsMediaAsset(value: unknown): GoodsMediaAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>, metadata = parseGoodsMediaMetadata(v), parsed = parseGoodsMediaPath(v.path), title = normalizeGoodsMediaTitle(v.title);
  if (!metadata || !parsed || v.id !== parsed.id || v.kind !== parsed.kind || !title) return null;
  const url = goodsVideoUrl(parsed.path); return url ? { ...metadata, id: parsed.id, kind: parsed.kind, path: parsed.path, title, url } : null;
}
export function parseGoodMediaSnapshot(value: unknown): GoodMediaSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>, video = v.video === null ? null : parseGoodsMediaAsset(v.video), shortclip = v.shortclip === null ? null : parseGoodsMediaAsset(v.shortclip);
  if (typeof v.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(v.goodId) || typeof v.goodName !== 'string' || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0
    || v.video !== null && !video || v.shortclip !== null && !shortclip || video && video.kind !== 'video' || shortclip && shortclip.kind !== 'shortclip') return null;
  return { goodId: v.goodId, goodName: v.goodName, revision: Number(v.revision), video, shortclip };
}
export type GoodsMediaSelection = Record<GoodsMediaKind, { id: string; title: string } | null>;
export function parseGoodsMediaSelection(value: unknown): GoodsMediaSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return null;
  const v = value as Record<string, unknown>, result: GoodsMediaSelection = { video: null, shortclip: null };
  for (const kind of GOODS_MEDIA_KINDS) {
    if (v[kind] === null) continue;
    if (!v[kind] || typeof v[kind] !== 'object' || Array.isArray(v[kind])) return null;
    const item = v[kind] as Record<string, unknown>, title = normalizeGoodsMediaTitle(item.title);
    if (Object.keys(item).length !== 2 || !isUuid(item.id) || !title) return null;
    result[kind] = { id: item.id, title };
  }
  return result.video && result.video.id === result.shortclip?.id ? null : result;
}
export type GoodsGallerySlide = { id: string; kind: 'image'; frame: string } | { id: string; kind: GoodsMediaKind; asset: GoodsMediaAsset };
export function buildGoodsGallerySlides(frames: string[], media?: PublicGoodMedia | null): GoodsGallerySlide[] {
  const images: GoodsGallerySlide[] = frames.map((frame, index) => ({ id: `image-${index}`, kind: 'image', frame }));
  if (!media) return images;
  const videos: GoodsGallerySlide[] = GOODS_MEDIA_KINDS.flatMap(kind => media[kind] ? [{ id: media[kind]!.id, kind, asset: media[kind]! }] : []);
  const preferred = media.settings.priority === 'image' ? null : videos.find(slide => slide.kind === media.settings.priority);
  return preferred ? [preferred, ...images, ...videos.filter(slide => slide !== preferred)] : [...images, ...videos];
}
