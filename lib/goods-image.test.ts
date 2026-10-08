import { describe, expect, it } from 'vitest';
import { DATA } from './data';
import { imageBg } from './media';
import { goodsImageBackground } from './goods-image';

const NEUTRAL = 'var(--wc-surface-grey-2, transparent)';

describe('goodsImageBackground', () => {
  it('굿즈 이미지 축약값의 cover만 contain으로 바꿔 1:1 프레임에서 잘리지 않게 한다', () => {
    expect(goodsImageBackground(imageBg('https://cdn.example/g1.webp'))).toBe(`url("https://cdn.example/g1.webp") center / contain no-repeat, ${NEUTRAL}`);
  });

  /* 2026-10-07 4차 리뷰: 기존 카탈로그 굿즈의 bg는 `url(…) center / cover no-repeat, linear-gradient(…)`이다.
   * gradient를 남기면 정사각이 아닌 원본(g13~g15는 3:2)이 남긴 contain 여백을 원색 띠가 덮어,
   * 같은 그리드의 업로드 이미지(회색 여백)와 여백 색이 갈린다. 이미지가 있으면 대체 레이어는 버린다. */
  it('이미지 레이어가 있으면 뒤의 gradient 대체 레이어를 버리고 중립 배경만 깐다', () => {
    expect(goodsImageBackground('url("/generated/goods/g13.webp") center / cover no-repeat, linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)'))
      .toBe(`url("/generated/goods/g13.webp") center / contain no-repeat, ${NEUTRAL}`);
    /* 이미지 위에 덧댄 gradient가 앞에 와도 첫 이미지 레이어만 남긴다. */
    expect(goodsImageBackground('linear-gradient(rgba(0, 0, 0, .2), transparent), url(/a.png) center / cover no-repeat, #fff'))
      .toBe(`url(/a.png) center / contain no-repeat, ${NEUTRAL}`);
    /* 이미지 레이어가 여럿이면 첫 장만 그린다. 따옴표 안 쉼표는 레이어 경계가 아니다. */
    expect(goodsImageBackground('url("/a,b.png") center / cover no-repeat, url(\'/c.png\') center / cover no-repeat'))
      .toBe(`url("/a,b.png") center / contain no-repeat, ${NEUTRAL}`);
  });

  it('카탈로그 기본 굿즈 이미지는 모두 gradient 없이 중립 여백으로 그린다', () => {
    /* 운영·seed의 굿즈 bg와 같은 `imageBg(path, grad(...))` 형태다. */
    expect(DATA.GOODS.length).toBeGreaterThan(0);
    for (const good of DATA.GOODS) {
      expect(good.img, good.id).toContain('linear-gradient(');
      const rendered = goodsImageBackground(good.img);
      expect(rendered, good.id).toMatch(/^url\("[^"]+"\) center \/ contain no-repeat, var\(--wc-surface-grey-2, transparent\)$/);
    }
  });

  it('url() 안의 cover 글자와 이미지가 없는 값은 건드리지 않는다', () => {
    expect(goodsImageBackground('url("https://cdn.example/center/cover.webp") center / cover no-repeat'))
      .toBe(`url("https://cdn.example/center/cover.webp") center / contain no-repeat, ${NEUTRAL}`);
    expect(goodsImageBackground("url('/a/ cover.png') center/cover")).toBe(`url('/a/ cover.png') center/ contain, ${NEUTRAL}`);
    expect(goodsImageBackground('linear-gradient(#111, #222)')).toBe('linear-gradient(#111, #222)');
    expect(goodsImageBackground('linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)')).toBe('linear-gradient(150deg, #300008, #9C001D 55%, #FF2E63)');
    expect(goodsImageBackground('')).toBeUndefined();
    expect(goodsImageBackground(null)).toBeUndefined();
  });
});
