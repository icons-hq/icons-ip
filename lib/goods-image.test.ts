import { describe, expect, it } from 'vitest';
import { imageBg } from './media';
import { goodsImageBackground } from './goods-image';

describe('goodsImageBackground', () => {
  it('굿즈 이미지 축약값의 cover만 contain으로 바꿔 1:1 프레임에서 잘리지 않게 한다', () => {
    expect(goodsImageBackground(imageBg('https://cdn.example/g1.webp'))).toBe('url("https://cdn.example/g1.webp") center / contain no-repeat, var(--wc-surface-grey-2, transparent)');
    expect(goodsImageBackground('url("/generated/goods/g1.png") center / cover no-repeat, linear-gradient(150deg, #111, #222)'))
      .toBe('url("/generated/goods/g1.png") center / contain no-repeat, linear-gradient(150deg, #111, #222), var(--wc-surface-grey-2, transparent)');
  });

  it('url() 안의 cover 글자와 이미지가 없는 값은 건드리지 않는다', () => {
    expect(goodsImageBackground('url("https://cdn.example/center/cover.webp") center / cover no-repeat'))
      .toBe('url("https://cdn.example/center/cover.webp") center / contain no-repeat, var(--wc-surface-grey-2, transparent)');
    expect(goodsImageBackground("url('/a/ cover.png') center/cover")).toBe("url('/a/ cover.png') center/ contain, var(--wc-surface-grey-2, transparent)");
    expect(goodsImageBackground('linear-gradient(#111, #222)')).toBe('linear-gradient(#111, #222)');
    expect(goodsImageBackground('')).toBeUndefined();
    expect(goodsImageBackground(null)).toBeUndefined();
  });
});
