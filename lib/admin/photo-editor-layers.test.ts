import { describe, expect, it } from 'vitest';
import { initialPhotoRecipe } from './photo-editor';
import { fitPhotoMosaic, mosaicPhotoPixels, validatePhotoLayers, type PhotoMosaic } from './photo-editor-layers';

const region: PhotoMosaic = { id: 'r1', shape: 'rectangle', x: 1, y: 1, width: 2, height: 2, blockSize: 128 };
const pixels = () => new Uint8ClampedArray(Array.from({ length: 16 }, (_, index) => [index + 1, index + 1, index + 1, 255]).flat());
function apply(input: Uint8ClampedArray, regions: PhotoMosaic[], width = 4, height = 4) {
  const output = new Uint8ClampedArray(input);
  for (const _ of mosaicPhotoPixels(output, { width, height }, regions)) void _;
  return output;
}
describe('수동 모자이크 픽셀 계약', () => {
  it('사각형은 선택한 4픽셀만 평균 9로 바꾸고 원본·나머지 채널은 보존한다', () => {
    const input = pixels(), output = apply(input, [region]);
    for (let index = 0; index < 16; index++) {
      const inside = [5, 6, 9, 10].includes(index);
      expect([...output.slice(index * 4, index * 4 + 4)]).toEqual(inside ? [9, 9, 9, 255] : [...input.slice(index * 4, index * 4 + 4)]);
    }
    expect(input).toEqual(pixels());
  });
  it('원 영역의 네 귀퉁이는 평균과 쓰기에서 제외한다', () => {
    const input = pixels(), output = apply(input, [{ ...region, shape: 'circle', x: 0, y: 0, width: 4, height: 4 }]);
    for (let index = 0; index < 16; index++) expect(output[index * 4]).toBe([0, 3, 12, 15].includes(index) ? input[index * 4] : 9);
  });
  it('투명색은 섞지 않고 부분 알파는 가중 평균에만 쓰며 alpha는 그대로다', () => {
    const input = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 128, 255, 255, 255, 0, 200, 200, 200, 255]);
    expect([...apply(input, [{ ...region, x: 0, y: 0 }], 2, 2)]).toEqual([100, 100, 100, 255, 100, 100, 100, 128, 255, 255, 255, 0, 100, 100, 100, 255]);
  });
  it('겹친 영역은 추가 순서대로 읽으며 블록은 원본 영역의 좌상단에 고정한다', () => {
    const first = { ...region, x: 0, y: 0 }, second = { ...region, id: 'r2', x: 1, y: 0 };
    const output = apply(pixels(), [first, second]);
    expect(output[0]).toBe(4); expect(output[4]).toBe(5); expect(output[8]).toBe(5); expect(output[12]).toBe(4);
    expect(output).not.toEqual(apply(pixels(), [second, first]));
  });
  it('최대 블록보다 큰 작업은 처리 중 yield하여 취소 기회를 제공한다', () => {
    const iterator = mosaicPhotoPixels(new Uint8ClampedArray(256 * 256 * 4).fill(255), { width: 256, height: 256 }, [{ ...region, x: 0, y: 0, width: 256, height: 256 }]);
    expect(iterator.next().done).toBe(false); iterator.return(undefined);
  });
});

describe('사진 영역 한도와 좌표', () => {
  it('영역 이동은 크기를 보존하고 원은 정사각 경계를 유지한다', () => {
    expect(fitPhotoMosaic({ width: 100, height: 80 }, { ...region, width: 20, height: 30 }, { x: 99, y: 99 })).toMatchObject({ x: 80, y: 50, width: 20, height: 30 });
    expect(fitPhotoMosaic({ width: 100, height: 80 }, { ...region, shape: 'circle' }, { width: 120 })).toMatchObject({ x: 1, y: 0, width: 80, height: 80 });
  });
  it.each([
    { mosaics: Array.from({ length: 9 }, (_, index) => ({ ...region, id: `r${index}` })) },
    { mosaics: [{ ...region, blockSize: 129 }] }, { mosaics: [{ ...region, shape: 'circle', height: 3 }] },
    { mosaics: [region, region] }, { mosaics: [{ ...region, x: Number.NaN }] },
    { texts: [{ id: 't', text: 'a'.repeat(301), x: 0, y: 0, fontSize: 12, color: '#ffffff' }] },
    { texts: [{ id: 't', text: '\n'.repeat(8), x: 0, y: 0, fontSize: 12, color: '#ffffff' }] },
    { texts: [{ id: 't', text: '한글', x: 0, y: 0, fontSize: 12, color: 'url(x)' }] },
  ])('잘못된 외부 recipe를 렌더 전에 거절한다: %j', patch => {
    expect(() => validatePhotoLayers({ ...initialPhotoRecipe(), ...patch } as ReturnType<typeof initialPhotoRecipe>)).toThrow();
  });
  it('허용 한도 안에서도 실제 원본보다 큰 영역은 거절한다', () => {
    expect(() => validatePhotoLayers({ ...initialPhotoRecipe(), mosaics: [region] }, { width: 2, height: 2 })).toThrow();
  });
});
