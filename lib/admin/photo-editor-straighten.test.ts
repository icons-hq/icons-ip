import { expect, it } from 'vitest';
import { estimatePhotoStraighten, photoStraightenPoint, photoStraightenScale, validatePhotoStraighten } from './photo-editor-straighten';

function finish(pixels: Uint8ClampedArray, width: number, height: number) {
  const process = estimatePhotoStraighten(pixels, { width, height }); let step = process.next(); let yields = 0;
  while (!step.done) { yields++; step = process.next(); }
  return { ...step.value, yields };
}
/** Independent analytic image: four anti-aliased edges of a rotated rectangle. */
function rectangle(width: number, height: number, degrees: number) {
  const pixels = new Uint8ClampedArray(width * height * 4), radians = degrees * Math.PI / 180;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let inside = 0;
    for (const sy of [.125, .375, .625, .875]) for (const sx of [.125, .375, .625, .875]) {
      const px = x + sx - width / 2, py = y + sy - height / 2;
      const localX = px * Math.cos(radians) + py * Math.sin(radians), localY = -px * Math.sin(radians) + py * Math.cos(radians);
      if (Math.abs(localX) < width * .36 && Math.abs(localY) < height * .3) inside++;
    }
    const i = (y * width + x) * 4, shade = 235 - inside / 16 * 190;
    pixels[i] = shade; pixels[i + 1] = shade; pixels[i + 2] = shade; pixels[i + 3] = 255;
  }
  return pixels;
}

it.each([-12, -7, -2.5, 0, 3, 8, 12])('원본 사각 윤곽 %s도의 반대 각도를 산출하고 원본 픽셀을 보존한다', degrees => {
  const input = rectangle(320, 240, degrees), before = new Uint8ClampedArray(input), result = finish(input, 320, 240);
  expect(result.reason).toBe(degrees === 0 ? 'already-level' : 'detected');
  expect(result.degrees).not.toBeNull(); expect(Math.abs(result.degrees! + degrees)).toBeLessThanOrEqual(.4);
  expect(result.yields).toBeGreaterThan(60); expect(input).toEqual(before);
});
it('평탄·투명·너무 얇은 사진은 각도를 지어내지 않는다', () => {
  const flat = new Uint8ClampedArray(100 * 100 * 4).fill(170);
  expect(finish(flat, 100, 100).degrees).toBeNull();
  const transparent = rectangle(100, 100, 5); for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
  expect(finish(transparent, 100, 100).reason).toBe('insufficient-lines');
  expect(finish(new Uint8ClampedArray(200 * 4), 200, 1).degrees).toBeNull();
});
it('기존 캔버스의 모서리는 역변환 후 원본 안에 있고 크기·alpha 배경을 발명하지 않는다', () => {
  for (const size of [{ width: 400, height: 300 }, { width: 300, height: 400 }, { width: 4000, height: 1 }]) {
    for (const degrees of [-15, -3, 0, 5, 15]) {
      expect(photoStraightenScale(size, degrees)).toBeGreaterThanOrEqual(1);
      for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
        const source = photoStraightenPoint(point, size, degrees, true);
        expect(source.x).toBeGreaterThanOrEqual(-1e-10); expect(source.x).toBeLessThanOrEqual(1 + 1e-10);
        expect(source.y).toBeGreaterThanOrEqual(-1e-10); expect(source.y).toBeLessThanOrEqual(1 + 1e-10);
        const roundTrip = photoStraightenPoint(source, size, degrees);
        expect(roundTrip.x).toBeCloseTo(point.x, 9); expect(roundTrip.y).toBeCloseTo(point.y, 9);
      }
    }
  }
});
it('비슷하게 강한 서로 다른 방향과 무작위 질감은 자동으로 한 각도를 확정하지 않는다', () => {
  const left = rectangle(240, 240, -7), right = rectangle(240, 240, 7), mixed = new Uint8ClampedArray(480 * 240 * 4);
  for (let y = 0; y < 240; y++) {
    mixed.set(left.subarray(y * 240 * 4, (y + 1) * 240 * 4), y * 480 * 4);
    mixed.set(right.subarray(y * 240 * 4, (y + 1) * 240 * 4), (y * 480 + 240) * 4);
  }
  expect(finish(mixed, 480, 240).degrees).toBeNull();
  let random = 731;
  const noise = new Uint8ClampedArray(200 * 160 * 4);
  for (let i = 0; i < noise.length; i += 4) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    noise[i] = random & 255; noise[i + 1] = random >> 8 & 255; noise[i + 2] = random >> 16 & 255; noise[i + 3] = 255;
  }
  expect(finish(noise, 200, 160).degrees).toBeNull();
});
it('세로 사진도 같은 원본 기울기를 읽고 한도를 넘은 각도를 끝값으로 단정하지 않는다', () => {
  const result = finish(rectangle(180, 320, 6), 180, 320);
  expect(result.degrees).not.toBeNull(); expect(Math.abs(result.degrees! + 6)).toBeLessThanOrEqual(.4);
  const outside = finish(rectangle(320, 240, 20), 320, 240);
  expect(outside.degrees).toBeNull();
});
it('각도0은 좌표를 정확히 유지하며 잘못된 입력·과대한 분석 배열을 거부한다', () => {
  expect(photoStraightenPoint({ x: .2, y: .7 }, { width: 800, height: 300 }, 0)).toEqual({ x: .2, y: .7 });
  expect(photoStraightenScale({ width: 800, height: 300 }, 0)).toBe(1);
  for (const value of [NaN, Infinity, 15.1, -15.1]) expect(() => validatePhotoStraighten(value)).toThrow();
  expect(() => finish(new Uint8ClampedArray(4), 2, 2)).toThrow();
  expect(() => finish(new Uint8ClampedArray(4), 641, 1)).toThrow();
});
