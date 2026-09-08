import { describe, expect, it } from 'vitest';
import { artworkGuideLabel, artworkSizeWarning } from './artwork-guidance';

describe('artworkGuideLabel', () => {
  it('세로가 없으면 「세로 자유」로 적는다', () => {
    expect(artworkGuideLabel({ width: 1000, height: 1000 })).toBe('권장 1,000×1,000px');
    expect(artworkGuideLabel({ width: 860 })).toBe('권장 가로 860px (세로 자유)');
  });
});

describe('artworkSizeWarning', () => {
  const square = { width: 1000, height: 1000 };

  it('권장대로면 아무 말도 하지 않는다', () => {
    expect(artworkSizeWarning(square, { width: 1000, height: 1000 })).toBeNull();
    expect(artworkSizeWarning(square, { width: 2000, height: 2000 })).toBeNull();
  });

  /* 몇 픽셀 어긋난 것까지 경고하면 경고가 소음이 되고, 소음이 되면 안 읽는다. */
  it('아주 작은 비율 차이는 봐준다', () => {
    expect(artworkSizeWarning(square, { width: 1000, height: 1010 })).toBeNull();
  });

  it('비율이 다르면 말한다', () => {
    expect(artworkSizeWarning(square, { width: 1600, height: 900 })).toContain('권장 비율');
  });

  /* 비율만 보면 200×200 이 통과한다 — 크기도 함께 본다. */
  it('비율이 맞아도 작으면 말한다', () => {
    const warning = artworkSizeWarning(square, { width: 200, height: 200 });
    expect(warning).toContain('권장 크기보다 작습니다(200×200px)');
    expect(warning).not.toContain('권장 비율');
  });

  it('세로 자유인 자리는 가로만 본다', () => {
    expect(artworkSizeWarning({ width: 860 }, { width: 860, height: 4000 })).toBeNull();
    expect(artworkSizeWarning({ width: 860 }, { width: 400, height: 4000 })).toContain('작습니다');
  });

  it('크기를 못 읽었으면 아무 말도 하지 않는다 — 모르는 것을 틀렸다고 하지 않는다', () => {
    expect(artworkSizeWarning(square, { width: 0, height: 0 })).toBeNull();
    expect(artworkSizeWarning(square, { width: Number.NaN, height: 1000 })).toBeNull();
  });
});
