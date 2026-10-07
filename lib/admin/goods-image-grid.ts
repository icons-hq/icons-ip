import { GOODS_GALLERY_MAX } from './catalog';

/*
 * 상품 이미지 썸네일 그리드의 순수 상태 (2026-10-07 MD 요청 — 스마트스토어처럼
 * 대표 이미지 1장 + 추가 이미지 여러 장을 작은 타일로 보고 교체·삭제·순서 변경).
 *
 * 0번 자리는 대표 이미지(`imagePath`), 1…N번은 추가 이미지(`galleryPath0…N-1`)다.
 * 폼 저장 계약은 그대로이고 순서 변경은 값의 재배치다. 추가 이미지의 빈 자리는
 * 항상 뒤로 모은다 — 공개 상세의 노출 순서가 곧 화면의 타일 순서다.
 * 업로드가 끝나기 전에 자리를 옮겨도 결과가 따라가도록 타일은 key로 찾는다.
 */

export const GOODS_IMAGE_FIELD_NAMES: readonly string[] = [
  'imagePath',
  ...Array.from({ length: GOODS_GALLERY_MAX }, (_, index) => `galleryPath${index}`),
];

export type GoodsImageTileStatus = 'saved' | 'uploading' | 'uploaded' | 'failed';

export interface GoodsImageTile<F = unknown> {
  key: string;
  /** hidden input으로 제출되는 검증 완료 경로. 새 업로드가 끝나기 전에는 빈 값이다. */
  path: string;
  /** 타일과 공개 화면 미리보기에 보이는 주소(저장된 공개 URL 또는 선택한 파일의 object URL). */
  url: string | null;
  status: GoodsImageTileStatus;
  error?: string;
  /** 실패한 새 업로드를 다시 시도할 파일. */
  file?: F;
  /** 교체 업로드 중인 원래 이미지. 실패하면 이 값으로 되돌린다. */
  previous?: { path: string; url: string | null; status: 'saved' | 'uploaded' };
}

export type GoodsImageSlots<F = unknown> = readonly (GoodsImageTile<F> | null)[];

export const GOODS_IMAGE_SLOT_COUNT = GOODS_IMAGE_FIELD_NAMES.length;

export function goodsImageLabel(position: number) {
  return position === 0 ? '대표 이미지' : `추가 이미지 ${position}`;
}

/** 숫자로 끝나는 라벨 뒤 목적격 조사(일·삼·육·칠·팔·십 → 을, 이·사·오·구 → 를). */
export function goodsImageObjectParticle(position: number) {
  if (position === 0) return '를';
  return [2, 4, 5, 9].includes(position % 10) ? '를' : '을';
}

export function compactGoodsGallery<F>(slots: GoodsImageSlots<F>): (GoodsImageTile<F> | null)[] {
  const gallery = slots.slice(1).filter((tile): tile is GoodsImageTile<F> => Boolean(tile));
  return Array.from({ length: GOODS_IMAGE_SLOT_COUNT }, (_, position) =>
    position === 0 ? slots[0] ?? null : gallery[position - 1] ?? null);
}

export function createGoodsImageSlots(
  paths: readonly (string | null | undefined)[],
  urls: readonly (string | null | undefined)[],
): (GoodsImageTile<never> | null)[] {
  return compactGoodsGallery(Array.from({ length: GOODS_IMAGE_SLOT_COUNT }, (_, position) => {
    const path = paths[position]?.trim() ?? '';
    return path ? { key: `saved-${position}`, path, url: urls[position] ?? null, status: 'saved' as const } : null;
  }));
}

export function goodsGalleryCount(slots: GoodsImageSlots<unknown>) {
  return slots.slice(1).filter(Boolean).length;
}

/** 추가 이미지 순서 변경. 자리는 1…채워진 개수 안으로만 움직인다. */
export function moveGoodsGalleryImage<F>(slots: GoodsImageSlots<F>, from: number, to: number): (GoodsImageTile<F> | null)[] {
  const count = goodsGalleryCount(slots);
  const target = Math.max(1, Math.min(count, to));
  const next = compactGoodsGallery(slots);
  if (from < 1 || from > count || target === from) return next;
  const gallery = next.slice(1, count + 1);
  const [moved] = gallery.splice(from - 1, 1);
  gallery.splice(target - 1, 0, moved);
  return compactGoodsGallery([next[0], ...gallery]);
}

/** 추가 이미지를 대표 이미지와 맞바꾼다. 대표 이미지가 비어 있으면 그 자리로 옮긴다. */
export function promoteGoodsImage<F>(slots: GoodsImageSlots<F>, position: number): (GoodsImageTile<F> | null)[] {
  const next = [...slots];
  const tile = next[position];
  if (position < 1 || !tile) return compactGoodsGallery(next);
  next[position] = next[0] ?? null;
  next[0] = tile;
  return compactGoodsGallery(next);
}

export function removeGoodsImage<F>(slots: GoodsImageSlots<F>, position: number): (GoodsImageTile<F> | null)[] {
  return compactGoodsGallery(slots.map((tile, index) => (index === position ? null : tile)));
}

export function replaceGoodsImageTile<F>(
  slots: GoodsImageSlots<F>,
  key: string,
  update: (tile: GoodsImageTile<F>) => GoodsImageTile<F> | null,
): (GoodsImageTile<F> | null)[] {
  return compactGoodsGallery(slots.map((tile) => (tile?.key === key ? update(tile) : tile)));
}

export function findGoodsImagePosition(slots: GoodsImageSlots<unknown>, key: string) {
  return slots.findIndex((tile) => tile?.key === key);
}

/**
 * 새 파일을 놓을 자리. `fromMain`이면 비어 있는 대표 이미지부터 채운다.
 * 남는 파일 수는 overflow로 돌려준다.
 */
export function goodsImageTargets(slots: GoodsImageSlots<unknown>, fileCount: number, fromMain: boolean) {
  const free: number[] = [];
  if (fromMain && !slots[0]) free.push(0);
  for (let position = 1; position < GOODS_IMAGE_SLOT_COUNT; position += 1) if (!slots[position]) free.push(position);
  const targets = free.slice(0, fileCount);
  return { targets, overflow: Math.max(0, fileCount - targets.length) };
}

/** 저장을 막아야 하는 타일 — 업로드 중이거나 실패한 새 이미지는 아직 제출할 경로가 없다. */
export function goodsImageBlockingMessage(tile: GoodsImageTile<unknown> | null | undefined) {
  if (tile?.status === 'uploading') return '이미지 업로드가 끝난 뒤 저장해주세요.';
  if (tile?.status === 'failed') return '업로드하지 못한 이미지를 다시 시도하거나 삭제해주세요.';
  return '';
}

export function goodsImageSubmitValues(slots: GoodsImageSlots<unknown>): Record<string, string> {
  return Object.fromEntries(GOODS_IMAGE_FIELD_NAMES.map((name, position) => [name, slots[position]?.path ?? '']));
}
