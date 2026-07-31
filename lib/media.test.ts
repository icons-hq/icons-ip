import { describe, expect, it } from 'vitest';
import { imageBg, normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';

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
