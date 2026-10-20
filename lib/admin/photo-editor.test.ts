import { describe, expect, it } from 'vitest';
import { adjustedPhotoPixels, fitPhotoCrop, flipPhotoRecipe, initialPhotoRecipe, orientedPhotoSize, photoCropPixels, photoRecipeUnchanged, photoSourcePoint, photoOrientedPoint, rotatePhotoRecipe, setPhotoCrop, validatePhotoRecipe } from './photo-editor';

describe('사진 편집 좌표와 recipe', () => {
  it('회전 네 번과 같은 방향 반전 두 번은 원래 전체 사진으로 돌아간다', () => {
    const initial = initialPhotoRecipe();
    let current = initial;
    for (let index = 0; index < 4; index++) current = rotatePhotoRecipe(current, 1);
    expect(current).toEqual(initial); expect(photoRecipeUnchanged(current)).toBe(true);
    expect(flipPhotoRecipe(flipPhotoRecipe(initial, 'x'), 'x')).toEqual(initial);
    expect(flipPhotoRecipe(flipPhotoRecipe(initial, 'y'), 'y')).toEqual(initial);
  });
  it('좌상단 선택 범위는 오른쪽 회전하면 우상단, 좌우 반전하면 우측으로 이동한다', () => {
    const start = { ...initialPhotoRecipe(), crop: { x: 0, y: 0, width: .5, height: .25 } };
    const right = rotatePhotoRecipe(start, 1);
    expect(orientedPhotoSize({ width: 800, height: 400 }, right)).toEqual({ width: 400, height: 800 });
    expect(photoCropPixels({ width: 800, height: 400 }, right)).toEqual({ x: 300, y: 0, width: 100, height: 400 });
    expect(photoCropPixels({ width: 800, height: 400 }, flipPhotoRecipe(start, 'x'))).toEqual({ x: 400, y: 0, width: 400, height: 100 });
    expect(photoCropPixels({ width: 800, height: 400 }, rotatePhotoRecipe(start, -1))).toEqual({ x: 0, y: 400, width: 100, height: 400 });
    expect(start.crop).toEqual({ x: 0, y: 0, width: .5, height: .25 });
  });
  it('화면 기준 회전은 반전 축도 회전하여 복합 조작이 모순되지 않는다', () => {
    const start = flipPhotoRecipe(initialPhotoRecipe(), 'x');
    const next = rotatePhotoRecipe(start, 1);
    expect(next).toMatchObject({ turns: 1, flipX: false, flipY: true });
    expect(rotatePhotoRecipe(next, -1)).toEqual(start);
  });
  it('자르기 위치 이동은 경계에서 크기를 보존하고 1픽셀 범위를 만들 수 있다', () => {
    const size = { width: 401, height: 303 };
    const cut = setPhotoCrop(size, initialPhotoRecipe(), { x: 100, y: 50, width: 120, height: 80 });
    expect(photoCropPixels(size, setPhotoCrop(size, cut, { x: 400, y: -10 }))).toEqual({ x: 281, y: 0, width: 120, height: 80 });
    expect(photoCropPixels(size, setPhotoCrop(size, cut, { x: 400, y: 302, width: 0, height: 0 }))).toEqual({ x: 400, y: 302, width: 1, height: 1 });
    expect(setPhotoCrop(size, cut, { width: Number.NaN })).toBe(cut);
  });
  it('고정 비율은 중앙에 맞추며 숫자 크기 변경에도 선택 비율을 따른다', () => {
    const size = { width: 1200, height: 800 };
    expect(photoCropPixels(size, fitPhotoCrop(size, initialPhotoRecipe(), 1))).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    const wide = fitPhotoCrop(size, initialPhotoRecipe(), 16 / 9);
    expect(photoCropPixels(size, wide)).toEqual({ x: 0, y: 62, width: 1200, height: 675 });
    const smaller = setPhotoCrop(size, wide, { width: 640 }, 16 / 9);
    expect(photoCropPixels(size, smaller)).toMatchObject({ width: 640, height: 360 });
  });
  it.each([
    { turns: 4 }, { brightness: Number.NaN }, { contrast: 101 }, { saturation: -101 },
    { automaticLevels: 1 },
    { crop: {} }, { crop: { x: 0, y: 0, width: 0, height: 1 } }, { crop: { x: .5, y: 0, width: 1, height: 1 } },
  ])('범위를 벗어난 외부 recipe는 명시적으로 거절한다: %j', patch => {
    expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), ...patch } as ReturnType<typeof initialPhotoRecipe>)).toThrow('편집 범위');
  });
  it('자동 명암·테두리·마스크만 켜도 변경이며 사용하지 않는 테두리 색만 바꾸면 무변경이다', () => {
    const initial = initialPhotoRecipe();
    expect(photoRecipeUnchanged(initial)).toBe(true);
    expect(photoRecipeUnchanged({ ...initial, automaticLevels: true })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, frameWidth: 1 })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, mask: 'circle' })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, mask: 'rounded' })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, frameColor: '#000000' })).toBe(true);
  });
});

describe('사진 색상 보정', () => {
  const input = new Uint8ClampedArray([100, 80, 60, 255, 50, 70, 90, 128, 7, 9, 11, 0]);
  it('중립값은 픽셀을 보존하며 원본 배열을 수정하지 않는다', () => {
    const result = adjustedPhotoPixels(input, initialPhotoRecipe());
    expect(result).toEqual(input); expect(result).not.toBe(input);
  });
  it('밝기는 RGB에만 적용하며 완전·부분 투명도를 보존한다', () => {
    const result = adjustedPhotoPixels(input, { brightness: 20, contrast: 0, saturation: 0 });
    expect([...result]).toEqual([151, 131, 111, 255, 101, 121, 141, 128, 7, 9, 11, 0]);
    expect([...input]).toEqual([100, 80, 60, 255, 50, 70, 90, 128, 7, 9, 11, 0]);
  });
  it('대비 최저는 중간 회색, 채도 최저는 같은 밝기의 회색이며 alpha는 그대로다', () => {
    expect([...adjustedPhotoPixels(input, { brightness: 0, contrast: -100, saturation: 0 }).slice(0, 4)]).toEqual([128, 128, 128, 255]);
    const gray = adjustedPhotoPixels(input, { brightness: 0, contrast: 0, saturation: -100 });
    expect([...gray.slice(0, 4)]).toEqual([83, 83, 83, 255]);
    expect(gray[7]).toBe(128); expect(gray[11]).toBe(0);
  });
  it('색온도는 대칭 RGB 보정이며 0·alpha·완전 투명 픽셀과 범위를 보존한다', () => {
    expect([...adjustedPhotoPixels(input, { ...initialPhotoRecipe(), temperature: 100 })]).toEqual([140, 80, 20, 255, 90, 70, 50, 128, 7, 9, 11, 0]);
    expect([...adjustedPhotoPixels(input, { ...initialPhotoRecipe(), temperature: -100 })]).toEqual([60, 80, 100, 255, 10, 70, 130, 128, 7, 9, 11, 0]);
    expect([...adjustedPhotoPixels(new Uint8ClampedArray([250, 250, 1, 255]), { ...initialPhotoRecipe(), temperature: 100 })]).toEqual([255, 250, 0, 255]);
    expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), temperature: 1 })).toBe(false);
    expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), temperature: 101 })).toThrow();
  });
});

it('원본 주석 좌표는 모든 회전·반전에서 왕복하고 편집의 회전·자르기로 삭제되지 않는다', () => {
  const text = { id: 'text', text: '한글', x: 40, y: 20, fontSize: 24, color: '#ffffff' };
  for (const turns of [0, 1, 2, 3] as const) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const recipe = { ...initialPhotoRecipe(), turns, flipX, flipY, texts: [text] };
    const back = photoSourcePoint(photoOrientedPoint({ x: .2, y: .7 }, recipe, { width: 400, height: 300 }), recipe, { width: 400, height: 300 });
    expect(back.x).toBeCloseTo(.2); expect(back.y).toBeCloseTo(.7);
    expect(rotatePhotoRecipe(recipe, 1).texts).toEqual([text]);
    expect(setPhotoCrop({ width: 400, height: 300 }, recipe, { x: 100, y: 100, width: 100, height: 100 }).texts).toEqual([text]);
  }
  expect(photoOrientedPoint({ x: .2, y: .7 }, { ...initialPhotoRecipe(), turns: 1 }, { width: 400, height: 300 })).toEqual({ x: .30000000000000004, y: .2 });
  expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), texts: [text] })).toBe(false);
  expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), texts: [{ ...text, text: ' \n' }] })).toBe(true);
});

it('수평 보정은 비정방형의 실제 좌표를 사용하며 화면 회전·반전·역변환이 같은 위치를 가리킨다', () => {
  for (const size of [{ width: 400, height: 300 }, { width: 300, height: 900 }]) {
    for (const turns of [0, 1, 2, 3] as const) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      for (const degrees of [-12, 0, 9]) {
        const recipe = { ...initialPhotoRecipe(), turns, flipX, flipY, straightenDegrees: degrees };
        const point = { x: .13, y: .77 }, mapped = photoOrientedPoint(point, recipe, size);
        const inverse = photoSourcePoint(mapped, recipe, size);
        expect(inverse.x).toBeCloseTo(point.x, 12); expect(inverse.y).toBeCloseTo(point.y, 12);
        const right = photoOrientedPoint(point, rotatePhotoRecipe(recipe, 1), size);
        expect(right.x).toBeCloseTo(1 - mapped.y, 12); expect(right.y).toBeCloseTo(mapped.x, 12);
        for (const axis of ['x', 'y'] as const) {
          const mirror = photoOrientedPoint(point, flipPhotoRecipe(recipe, axis), size);
          expect(mirror.x).toBeCloseTo(axis === 'x' ? 1 - mapped.x : mapped.x, 12);
          expect(mirror.y).toBeCloseTo(axis === 'y' ? 1 - mapped.y : mapped.y, 12);
          expect(flipPhotoRecipe(flipPhotoRecipe(recipe, axis), axis)).toEqual(recipe);
        }
        expect(photoCropPixels(size, recipe)).toEqual({ x: 0, y: 0, ...orientedPhotoSize(size, recipe) });
      }
    }
  }
});
it('수평 보정 단독 변경은 저장 대상이고 각도 상한·비정상 값은 거절한다', () => {
  expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), straightenDegrees: .1 })).toBe(false);
  for (const straightenDegrees of [15.1, -15.1, Infinity, NaN]) expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), straightenDegrees })).toThrow('수평 보정 각도');
});

it.each(['sharpness', 'circularBlur', 'linearBlur', 'vignette'] as const)('추가 보정 %s는 무변경 판정·재설정에 포함된다', key => {
  const initial = initialPhotoRecipe();
  expect(initial[key]).toBe(0); expect(photoRecipeUnchanged({ ...initial, [key]: 1 })).toBe(false);
  expect(photoRecipeUnchanged({ ...initial, [key]: 0 })).toBe(true);
});
it.each([
  { sharpness: -101 }, { sharpness: 101 }, { sharpness: .5 }, { circularBlur: -1 }, { circularBlur: 101 },
  { linearBlur: Number.NaN }, { linearBlur: .5 }, { vignette: -1 }, { vignette: 101 },
])('추가 보정의 외부 범위·비정수 값을 거절한다: %j', patch => {
  expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), ...patch })).toThrow('정수');
});
