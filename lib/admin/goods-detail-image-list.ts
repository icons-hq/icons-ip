import { ADMIN_ARTWORK_ACCEPT, GOODS_ARTWORK_MAX_BYTES } from './artwork';
import { GOODS_DETAIL_IMAGE_FIELD_NAMES, GOODS_DETAIL_IMAGE_MAX } from './catalog';
import type { GoodsImageTile } from './goods-image-grid';

/*
 * 긴 상세 이미지 목록의 순수 상태(2026-11-19 MD 요청 — 세로로 긴 통이미지를 잘라 썸네일처럼 여러 장 올린다).
 *
 * 타일 배열의 순서가 곧 상세 설명 아래 노출 순서다. 빈 자리가 없고, 폼 칸(GOODS_DETAIL_IMAGE_FIELD_NAMES)에는 앞에서부터
 * 채워 제출한다. 업로드가 끝나기 전에 순서를 바꿔도 결과가 따라가도록 타일은 key로 찾는다.
 */

export type GoodsDetailImageTiles<F = unknown> = readonly GoodsImageTile<F>[];

export function goodsDetailImageLabel(index: number) {
  return `상세 이미지 ${index + 1}`;
}

/** 숫자로 끝나는 라벨 뒤 목적격 조사(일·삼·육·칠·팔·십 → 을, 이·사·오·구 → 를). */
export function goodsDetailImageObjectParticle(index: number) {
  return [2, 4, 5, 9].includes((index + 1) % 10) ? '를' : '을';
}

export function createGoodsDetailImageTiles(
  paths: readonly (string | null | undefined)[],
  urls: readonly (string | null | undefined)[],
): GoodsImageTile<never>[] {
  const tiles: GoodsImageTile<never>[] = [];
  paths.slice(0, GOODS_DETAIL_IMAGE_MAX).forEach((value, index) => {
    const path = value?.trim() ?? '';
    if (path) tiles.push({ key: `saved-${index}`, path, url: urls[index] ?? null, status: 'saved' });
  });
  return tiles;
}

/** 순서 변경. 자리는 0…길이-1 안으로만 움직인다. */
export function moveGoodsDetailImage<F>(tiles: GoodsDetailImageTiles<F>, from: number, to: number): GoodsImageTile<F>[] {
  const next = [...tiles];
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (from < 0 || from >= next.length || target === from) return next;
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

export function removeGoodsDetailImage<F>(tiles: GoodsDetailImageTiles<F>, index: number): GoodsImageTile<F>[] {
  return tiles.filter((_, position) => position !== index);
}

export function replaceGoodsDetailImageTile<F>(
  tiles: GoodsDetailImageTiles<F>,
  key: string,
  update: (tile: GoodsImageTile<F>) => GoodsImageTile<F> | null,
): GoodsImageTile<F>[] {
  return tiles.flatMap((tile) => {
    if (tile.key !== key) return [tile];
    const next = update(tile);
    return next ? [next] : [];
  });
}

export function findGoodsDetailImageIndex(tiles: GoodsDetailImageTiles<unknown>, key: string) {
  return tiles.findIndex((tile) => tile.key === key);
}

/** 새 파일 중 넣을 수 있는 개수와 남는 개수. */
export function goodsDetailImageCapacity(tiles: GoodsDetailImageTiles<unknown>, fileCount: number) {
  const accepted = Math.max(0, Math.min(fileCount, GOODS_DETAIL_IMAGE_MAX - tiles.length));
  return { accepted, overflow: fileCount - accepted };
}

/*
 * 고를 때 거르는 조건. 형식은 브라우저가 확장자로 정한 File.type이 아니라 업로드가 파일 내용으로 다시 판별하므로
 * (artwork-upload.client resolveAdminArtworkMimeType), 이름에 형식이 없는 파일(빈 type)도 받는다. 크기만 먼저 거른다.
 */
const ACCEPTED_TYPES = new Set(ADMIN_ARTWORK_ACCEPT.split(','));
export function goodsDetailImageFileAcceptable(file: Pick<File, 'size' | 'type'>) {
  return file.size >= 1 && file.size <= GOODS_ARTWORK_MAX_BYTES && (file.type === '' || ACCEPTED_TYPES.has(file.type));
}

export function goodsDetailImageSubmitValues(tiles: GoodsDetailImageTiles<unknown>): Record<string, string> {
  return Object.fromEntries(GOODS_DETAIL_IMAGE_FIELD_NAMES.map((name, index) => [name, tiles[index]?.path ?? '']));
}

/**
 * 제출되는 경로 목록의 지문. 순서 변경·빼기는 타일(DOM 노드)을 옮기거나 지울 뿐 hidden 칸의 value를 바꾸지 않아,
 * 편집기의 자동복구·이탈 경고(value 변경·input/change 이벤트 감시)가 놓친다. 지문이 바뀌면 목록이 폼에 change를 알린다.
 */
export function goodsDetailImageSignature(tiles: GoodsDetailImageTiles<unknown>) {
  return tiles.map((tile) => tile.path).join('\n');
}
