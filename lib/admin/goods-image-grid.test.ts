import { describe, expect, it } from 'vitest';
import { GOODS_GALLERY_MAX } from './catalog';
import {
  GOODS_IMAGE_FIELD_NAMES,
  createGoodsImageSlots,
  goodsGalleryCount,
  goodsImageBlockingMessage,
  goodsImageLabel,
  goodsImageObjectParticle,
  goodsImageSubmitValues,
  goodsImageTargets,
  moveGoodsGalleryImage,
  promoteGoodsImage,
  removeGoodsImage,
  replaceGoodsImageTile,
  type GoodsImageTile,
} from './goods-image-grid';

const path = (name: string) => `public-media/catalog/good/${name}.webp`;
const slots = (main: string, ...gallery: string[]) => createGoodsImageSlots(
  [main && path(main), ...gallery.map((name) => name && path(name))],
  [main && `https://cdn.example/${main}.webp`, ...gallery.map((name) => name && `https://cdn.example/${name}.webp`)],
);
const submitted = (value: ReturnType<typeof slots>) => Object.values(goodsImageSubmitValues(value)).map((item) => item.replace(/^public-media\/catalog\/good\/|\.webp$/g, ''));

describe('상품 이미지 그리드 상태', () => {
  it('폼 저장 계약의 자리 이름(imagePath, galleryPath0…)을 그대로 쓴다', () => {
    expect(GOODS_IMAGE_FIELD_NAMES).toEqual(['imagePath', ...Array.from({ length: GOODS_GALLERY_MAX }, (_, index) => `galleryPath${index}`)]);
    expect(goodsImageLabel(0)).toBe('대표 이미지');
    expect(goodsImageLabel(2)).toBe('추가 이미지 2');
    expect([1, 2, 3, 4].map((position) => `${goodsImageLabel(position)}${goodsImageObjectParticle(position)}`))
      .toEqual(['추가 이미지 1을', '추가 이미지 2를', '추가 이미지 3을', '추가 이미지 4를']);
  });

  it('저장값의 빈 추가 이미지 자리를 뒤로 모은다', () => {
    const value = slots('main', '', 'b', '', 'd');
    expect(submitted(value)).toEqual(['main', 'b', 'd', '', '']);
    expect(goodsGalleryCount(value)).toBe(2);
    expect(value[1]?.url).toBe('https://cdn.example/b.webp');
  });

  it('추가 이미지 순서 변경은 값 재배치이고 채워진 범위 밖으로 나가지 않는다', () => {
    const value = slots('main', 'a', 'b', 'c');
    expect(submitted(moveGoodsGalleryImage(value, 3, 1))).toEqual(['main', 'c', 'a', 'b', '']);
    expect(submitted(moveGoodsGalleryImage(value, 1, 9))).toEqual(['main', 'b', 'c', 'a', '']);
    expect(submitted(moveGoodsGalleryImage(value, 0, 2))).toEqual(['main', 'a', 'b', 'c', '']);
  });

  it('대표로 지정은 대표 이미지와 자리를 맞바꾸고, 대표가 비어 있으면 그 자리로 옮긴다', () => {
    expect(submitted(promoteGoodsImage(slots('main', 'a', 'b'), 2))).toEqual(['b', 'a', 'main', '', '']);
    expect(submitted(promoteGoodsImage(slots('', 'a', 'b'), 1))).toEqual(['a', 'b', '', '', '']);
  });

  it('삭제한 자리 뒤의 이미지는 앞으로 당겨진다', () => {
    expect(submitted(removeGoodsImage(slots('main', 'a', 'b', 'c'), 1))).toEqual(['main', 'b', 'c', '', '']);
  });

  it('새 파일은 빈 대표 이미지부터(대표 타일에서 고른 경우) 또는 빈 추가 이미지 자리에 순서대로 놓고 초과분을 센다', () => {
    expect(goodsImageTargets(slots('', 'a'), 3, true)).toEqual({ targets: [0, 2, 3], overflow: 0 });
    expect(goodsImageTargets(slots('', 'a'), 3, false)).toEqual({ targets: [2, 3, 4], overflow: 0 });
    expect(goodsImageTargets(slots('main', 'a', 'b', 'c'), 3, false)).toEqual({ targets: [4], overflow: 2 });
  });

  it('업로드 중이거나 실패한 새 이미지는 제출할 경로가 없어 저장을 막는다', () => {
    const uploading: GoodsImageTile = { key: 'n', path: '', url: 'blob:x', status: 'uploading' };
    expect(goodsImageBlockingMessage(uploading)).toBe('이미지 업로드가 끝난 뒤 저장해주세요.');
    expect(goodsImageBlockingMessage({ ...uploading, status: 'failed' })).toBe('업로드하지 못한 이미지를 다시 시도하거나 삭제해주세요.');
    expect(goodsImageBlockingMessage({ ...uploading, status: 'uploaded', path: path('x') })).toBe('');
    expect(goodsImageBlockingMessage(null)).toBe('');
  });

  it('업로드 결과는 자리가 아니라 key로 찾아 반영한다', () => {
    const value = slots('main', 'a', 'b');
    const moved = moveGoodsGalleryImage(value, 1, 2);
    const key = value[1]!.key;
    const updated = replaceGoodsImageTile(moved, key, (tile) => ({ ...tile, path: path('a2') }));
    expect(submitted(updated)).toEqual(['main', 'b', 'a2', '', '']);
    expect(submitted(replaceGoodsImageTile(updated, key, () => null))).toEqual(['main', 'b', '', '', '']);
  });
});
