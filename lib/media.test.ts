import { describe, expect, it } from 'vitest';
import { imageBg, imageUrlFromBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';

describe('normalizePublicMediaPath', () => {
  it.each([
    ['catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['public-media/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['///public-media/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
  ])('저장된 경로 %s를 object 경로로 정규화한다', (storedPath, expected) => {
    expect(normalizePublicMediaPath(storedPath)).toBe(expected);
  });

  it('버킷 이름이 경로 중간에 있으면 건드리지 않는다', () => {
    expect(normalizePublicMediaPath('catalog/public-media/art.jpg'))
      .toBe('catalog/public-media/art.jpg');
  });

  it('버킷 상수와 접두가 어긋나지 않는다', () => {
    expect(normalizePublicMediaPath(`${PUBLIC_MEDIA_BUCKET}/a.jpg`)).toBe('a.jpg');
  });
});

describe('imageBg', () => {
  it('CSS background 축약값으로 감싼다', () => {
    expect(imageBg('https://cdn.test/a.jpg'))
      .toBe('url("https://cdn.test/a.jpg") center / cover no-repeat');
  });
});

describe('imageUrlFromBg', () => {
  it('imageBg가 감싼 값을 원래 URL로 되돌린다', () => {
    expect(imageUrlFromBg(imageBg('https://cdn.test/a.jpg'))).toBe('https://cdn.test/a.jpg');
  });

  /* 프로덕션 카탈로그가 실제로 담고 있는 문자열 — 이미지 레이어 뒤에 gradient가 붙는다. */
  it('gradient가 뒤따르는 카탈로그 bg에서 이미지 경로만 뽑는다', () => {
    expect(imageUrlFromBg(
      'url("/generated/goods/g1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
    )).toBe('/generated/goods/g1.png');
  });

  it.each([
    ["url('/generated/ip/rilakkuma.png') center / cover", '/generated/ip/rilakkuma.png'],
    ['url(/generated/cards/c1.png) center / cover', '/generated/cards/c1.png'],
  ])('따옴표 종류에 상관없이 %s에서 경로를 뽑는다', (bg, expected) => {
    expect(imageUrlFromBg(bg)).toBe(expected);
  });

  it.each([
    ['linear-gradient(150deg, #2A2440, #4A3F73)'],
    ['url() center / cover'],
    ['url("") center / cover'],
    [''],
    [null],
    [undefined],
  ])('이미지가 없는 %s는 null이다', (bg) => {
    expect(imageUrlFromBg(bg)).toBeNull();
  });
});
