import { describe, expect, it } from 'vitest';
import { GOODS_DETAIL_IMAGE_FIELD_NAMES, GOODS_DETAIL_IMAGE_MAX } from './catalog';
import {
  createGoodsDetailImageTiles,
  goodsDetailImageCapacity,
  goodsDetailImageFileAcceptable,
  goodsDetailImageLabel,
  goodsDetailImageObjectParticle,
  goodsDetailImageSignature,
  goodsDetailImageSubmitValues,
  moveGoodsDetailImage,
  removeGoodsDetailImage,
  replaceGoodsDetailImageTile,
} from './goods-detail-image-list';

const path = (n: number) => `public-media/catalog/good/00000000-0000-4000-8000-0000001119${String(n).padStart(2, '0')}.png`;

describe('긴 상세 이미지 목록', () => {
  it('저장된 경로를 빈 칸 없이 순서대로 타일로 만든다', () => {
    const tiles = createGoodsDetailImageTiles(['', path(1), ' ', path(2)], [null, 'u1', null, 'u2']);
    expect(tiles.map((tile) => [tile.path, tile.url, tile.status])).toEqual([[path(1), 'u1', 'saved'], [path(2), 'u2', 'saved']]);
  });

  it('첫 칸은 옛 한 장 칸 이름이고 앞에서부터 채워 제출한다', () => {
    expect(GOODS_DETAIL_IMAGE_FIELD_NAMES).toEqual(['detailImagePath', ...Array.from({ length: 9 }, (_, i) => `detailImagePath${i + 1}`)]);
    const values = goodsDetailImageSubmitValues(createGoodsDetailImageTiles([path(1), path(2)], []));
    expect(values).toMatchObject({ detailImagePath: path(1), detailImagePath1: path(2), detailImagePath2: '' });
    expect(Object.keys(values)).toHaveLength(GOODS_DETAIL_IMAGE_MAX);
  });

  it('순서를 바꾸고 빼고 교체한다', () => {
    const tiles = createGoodsDetailImageTiles([path(1), path(2), path(3)], []);
    expect(moveGoodsDetailImage(tiles, 2, 0).map((tile) => tile.path)).toEqual([path(3), path(1), path(2)]);
    expect(moveGoodsDetailImage(tiles, 0, 9).map((tile) => tile.path)).toEqual([path(2), path(3), path(1)]);
    expect(moveGoodsDetailImage(tiles, 5, 0)).toEqual(tiles);
    expect(removeGoodsDetailImage(tiles, 1).map((tile) => tile.path)).toEqual([path(1), path(3)]);
    expect(replaceGoodsDetailImageTile(tiles, tiles[0].key, (tile) => ({ ...tile, path: path(9) })).map((tile) => tile.path)).toEqual([path(9), path(2), path(3)]);
    expect(replaceGoodsDetailImageTile(tiles, tiles[0].key, () => null)).toHaveLength(2);
  });

  it('최대 10장까지만 받고 남는 수를 알린다', () => {
    const nine = createGoodsDetailImageTiles(Array.from({ length: 9 }, (_, i) => path(i + 1)), []);
    expect(goodsDetailImageCapacity(nine, 3)).toEqual({ accepted: 1, overflow: 2 });
    expect(goodsDetailImageCapacity([], 4)).toEqual({ accepted: 4, overflow: 0 });
  });

  it('형식은 내용으로 다시 판별하므로 빈 type도 받고 크기만 먼저 거른다', () => {
    expect(goodsDetailImageFileAcceptable({ size: 7_302_758, type: 'image/jpeg' })).toBe(true);
    expect(goodsDetailImageFileAcceptable({ size: 1000, type: '' })).toBe(true);
    expect(goodsDetailImageFileAcceptable({ size: 1000, type: 'image/gif' })).toBe(false);
    expect(goodsDetailImageFileAcceptable({ size: 21 * 1024 * 1024, type: 'image/png' })).toBe(false);
  });

  it('라벨과 조사', () => {
    expect(goodsDetailImageLabel(0)).toBe('상세 이미지 1');
    expect([0, 1, 3, 9].map(goodsDetailImageObjectParticle)).toEqual(['을', '를', '를', '을']);
  });

  it('순서 변경·빼기는 제출 지문을 바꾸고, 미리보기·상태만 바뀐 커밋은 바꾸지 않는다', () => {
    const tiles = createGoodsDetailImageTiles([path(1), path(2)], ['u1', 'u2']);
    const signature = goodsDetailImageSignature(tiles);
    expect(goodsDetailImageSignature(moveGoodsDetailImage(tiles, 1, 0))).not.toBe(signature);
    expect(goodsDetailImageSignature(removeGoodsDetailImage(tiles, 1))).not.toBe(signature);
    expect(goodsDetailImageSignature(replaceGoodsDetailImageTile(tiles, tiles[0].key, (tile) => ({ ...tile, url: 'blob:x', error: '오류' })))).toBe(signature);
  });
});
