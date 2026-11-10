import { describe, expect, it } from 'vitest';
import { applyPhotoEffects, boxBlurPhotoPixels, photoBlurRadius, type PhotoEffects } from './photo-editor-effects';

type Size = { width: number; height: number };
type Tap = { x: number; y: number; weight: number };
const neutral: PhotoEffects = { sharpness: 0, circularBlur: 0, linearBlur: 0, vignette: 0 };
const shapes: Size[] = [{ width: 1, height: 1 }, { width: 1, height: 7 }, { width: 8, height: 1 }, { width: 2, height: 3 }, { width: 7, height: 5 }];

function sample({ width, height }: Size) {
  const alpha = [0, 1, 17, 64, 128, 254, 255];
  return new Uint8ClampedArray(Array.from({ length: width * height }, (_, index) => [
    (index * 73 + 19) % 256, (index * 137 + 241) % 256, (index * 41 + 7) % 256, alpha[(index * 3 + 4) % alpha.length],
  ]).flat());
}
function finish(iterator: Generator<void>) { for (const step of iterator) void step; }
function actual(input: Uint8ClampedArray, size: Size, effects: Partial<PhotoEffects>) {
  const output = new Uint8ClampedArray(input);
  finish(applyPhotoEffects(output, size, { ...neutral, ...effects }));
  return output;
}
const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

// Independent oracle: every destination reads the complete, immutable 2D source.
// No separable passes, row cache, running sums or production geometry helpers.
function convolution(input: Uint8ClampedArray, size: Size, taps: readonly Tap[], combine: (original: number, average: number, x: number, y: number) => number) {
  const output = new Uint8ClampedArray(input);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const destination = (y * size.width + x) * 4;
    if (!input[destination + 3]) continue;
    const totals = [0, 0, 0]; let totalWeight = 0;
    for (const tap of taps) {
      const row = Math.max(0, Math.min(size.height - 1, y + tap.y));
      const column = Math.max(0, Math.min(size.width - 1, x + tap.x));
      const source = (row * size.width + column) * 4;
      const weight = tap.weight * input[source + 3];
      totalWeight += weight;
      for (let channel = 0; channel < 3; channel++) totals[channel] += input[source + channel] * weight;
    }
    for (let channel = 0; channel < 3; channel++) output[destination + channel] = byte(combine(input[destination + channel], totals[channel] / totalWeight, x, y));
  }
  return output;
}
const sharpKernel = [
  [1, 4, 6, 4, 1], [4, 16, 24, 16, 4], [6, 24, 36, 24, 6], [4, 16, 24, 16, 4], [1, 4, 6, 4, 1],
].flatMap((row, y) => row.map((weight, x) => ({ x: x - 2, y: y - 2, weight })));
function squareKernel(radius: number): Tap[] {
  return Array.from({ length: (2 * radius + 1) ** 2 }, (_, index) => ({
    x: index % (2 * radius + 1) - radius, y: Math.floor(index / (2 * radius + 1)) - radius, weight: 1,
  }));
}
function fade(distance: number, from: number, to: number) {
  if (distance <= from) return 0;
  if (distance >= to) return 1;
  const t = (distance - from) / (to - from);
  return t * t * (3 - 2 * t);
}
function oracle(input: Uint8ClampedArray, size: Size, effects: PhotoEffects) {
  let stage = new Uint8ClampedArray(input);
  if (effects.sharpness) stage = convolution(stage, size, sharpKernel, (original, blurred) => original + effects.sharpness * (original - blurred) / 100);
  if (effects.circularBlur || effects.linearBlur) {
    const radius = Math.max(1, Math.min(32, Math.round(Math.min(size.width, size.height) / 50)));
    stage = convolution(stage, size, squareKernel(radius), (original, blurred, x, y) => {
      const dx = x + 0.5 - size.width / 2, dy = y + 0.5 - size.height / 2;
      const circular = effects.circularBlur / 100 * fade(Math.hypot(dx, dy) * 2 / Math.min(size.width, size.height), 0.45, 0.9);
      const linear = effects.linearBlur / 100 * fade(Math.abs(dy) * 2 / size.height, 0.25, 0.75);
      const unblurred = (1 - circular) * (1 - linear);
      return original + (1 - unblurred) * (blurred - original);
    });
  }
  if (effects.vignette) for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const index = (y * size.width + x) * 4;
    if (!stage[index + 3]) continue;
    const distance = Math.hypot((x + 0.5 - size.width / 2) / (size.width / 2), (y + 0.5 - size.height / 2) / (size.height / 2)) / Math.SQRT2;
    const retained = 1 - effects.vignette / 100 * fade(distance, 0.25, 1);
    for (let channel = 0; channel < 3; channel++) stage[index + channel] = byte(stage[index + channel] * retained);
  }
  return stage;
}
function rotate(input: Uint8ClampedArray, size: Size) {
  const output = new Uint8ClampedArray(input.length);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    output.set(input.subarray((y * size.width + x) * 4, (y * size.width + x + 1) * 4), (x * size.height + size.height - 1 - y) * 4);
  }
  return output;
}

describe('ICONS 공간 보정의 독립 2D 검산', () => {
  it.each(shapes.flatMap(size => [1, 2, 32].map(radius => ({ ...size, radius }))))('box $width×$height, 반경 $radius는 가장자리 반복 가중치까지 2D 직접 합과 같다', ({ width, height, radius }) => {
    const size = { width, height }, input = sample(size), output = new Uint8ClampedArray(input);
    finish(boxBlurPhotoPixels(output, size, radius));
    expect(output).toEqual(convolution(input, size, squareKernel(radius), (_original, average) => average));
  });

  it.each([
    { sharpness: -100 }, { sharpness: -53 }, { sharpness: 47 }, { sharpness: 100 },
    { circularBlur: 36 }, { linearBlur: 73 }, { vignette: 100 },
    { sharpness: 63, circularBlur: 71, linearBlur: 42, vignette: 29 },
    { sharpness: -79, circularBlur: 21, linearBlur: 94, vignette: 57 },
  ])('합성 %j는 단계별 별도 버퍼로 검산한 결과와 같다', patch => {
    const effects = { ...neutral, ...patch };
    for (const size of shapes) {
      const input = sample(size);
      expect(actual(input, size, effects), `${size.width}×${size.height}`).toEqual(oracle(input, size, effects));
    }
  });

  it('5×5 단일 밝은 점의 음수 선명도는 2D binomial 계수, 양수는 범위 제한을 따른다', () => {
    const input = new Uint8ClampedArray(5 * 5 * 4);
    for (let index = 3; index < input.length; index += 4) input[index] = 255;
    input.set([255, 255, 255, 255], (2 * 5 + 2) * 4);
    const softened = actual(input, { width: 5, height: 5 }, { sharpness: -100 });
    expect([...softened.subarray(48, 52)]).toEqual([36, 36, 36, 255]);
    expect([...softened.subarray(44, 48)]).toEqual([24, 24, 24, 255]);
    expect([...softened.subarray(0, 4)]).toEqual([1, 1, 1, 255]);
    expect(actual(input, { width: 5, height: 5 }, { sharpness: 100 })).toEqual(input);
  });

  it('작은 alpha의 밝은 픽셀은 불투명 픽셀과 동일한 무게로 섞이지 않는다', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 1]);
    finish(boxBlurPhotoPixels(pixels, { width: 2, height: 1 }, 1));
    expect([...pixels]).toEqual([0, 0, 0, 255, 2, 2, 2, 1]);
  });

  it('최대 반경의 흰색 원시합은 overflow 없이 유지된다', () => {
    const pixels = new Uint8ClampedArray(3 * 2 * 4).fill(255), before = new Uint8ClampedArray(pixels);
    finish(boxBlurPhotoPixels(pixels, { width: 3, height: 2 }, 32));
    expect(pixels).toEqual(before);
  });
});

describe('공간 마스크와 투명도 불변식', () => {
  it('0 설정은 숨은 RGB를 포함해 모든 바이트를 보존하고 yield하지 않는다', () => {
    const pixels = sample({ width: 7, height: 5 }), before = new Uint8ClampedArray(pixels);
    expect(applyPhotoEffects(pixels, { width: 7, height: 5 }, neutral).next().done).toBe(true);
    expect(pixels).toEqual(before);
  });

  it('숨은 RGB만 다른 두 원본은 가시 RGB가 같으며 각 원본의 alpha·숨은 RGB는 보존된다', () => {
    const size = { width: 7, height: 5 }, first = sample(size), second = new Uint8ClampedArray(first);
    for (let index = 0; index < second.length; index += 4) if (!second[index + 3]) second.set([255, 1, 213], index);
    const effects = { sharpness: 83, circularBlur: 69, linearBlur: 100, vignette: 47 };
    const a = actual(first, size, effects), b = actual(second, size, effects);
    for (let index = 0; index < first.length; index += 4) {
      expect(a[index + 3]).toBe(first[index + 3]); expect(b[index + 3]).toBe(second[index + 3]);
      if (first[index + 3]) expect(a.subarray(index, index + 3)).toEqual(b.subarray(index, index + 3));
      else {
        expect(a.subarray(index, index + 4)).toEqual(first.subarray(index, index + 4));
        expect(b.subarray(index, index + 4)).toEqual(second.subarray(index, index + 4));
      }
    }
  });

  it('전부 투명한 원본은 비영점 보정을 해도 숨은 RGB까지 그대로다', () => {
    const size = { width: 5, height: 3 }, input = sample(size);
    for (let index = 3; index < input.length; index += 4) input[index] = 0;
    expect(actual(input, size, { sharpness: -100, circularBlur: 100, linearBlur: 100, vignette: 100 })).toEqual(input);
  });

  it('선형 마스크의 중앙 가로줄은 보존하지만 원형 마스크는 같은 줄의 바깥쪽을 흐린다', () => {
    const size = { width: 7, height: 5 }, input = sample(size);
    for (let index = 3; index < input.length; index += 4) input[index] = 255;
    const line = actual(input, size, { linearBlur: 100 }), circle = actual(input, size, { circularBlur: 100 });
    const middle = size.width * 2 * 4;
    expect(line.subarray(middle, middle + size.width * 4)).toEqual(input.subarray(middle, middle + size.width * 4));
    expect(circle.subarray(middle, middle + 4)).not.toEqual(input.subarray(middle, middle + 4));
    expect(circle.subarray(middle + 3 * 4, middle + 4 * 4)).toEqual(input.subarray(middle + 3 * 4, middle + 4 * 4));
  });

  it('선명도·원형·비네팅은 직사각 사진을 90도 돌려도 같은 픽셀 관계를 유지한다', () => {
    const size = { width: 7, height: 5 }, input = sample(size), effects = { sharpness: -61, circularBlur: 78, vignette: 43 };
    expect(actual(rotate(input, size), { width: size.height, height: size.width }, effects)).toEqual(rotate(actual(input, size, effects), size));
  });

  it('4×4 단색 비네팅은 중앙 네 픽셀을 유지하고 네 모서리에 같은 검산값을 낸다', () => {
    const input = new Uint8ClampedArray(Array.from({ length: 16 }, () => [200, 100, 50, 128]).flat());
    const output = actual(input, { width: 4, height: 4 }, { vignette: 100 });
    for (const pixel of [0, 3, 12, 15]) expect([...output.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([52, 26, 13, 128]);
    for (const pixel of [5, 6, 9, 10]) expect([...output.subarray(pixel * 4, pixel * 4 + 4)]).toEqual([200, 100, 50, 128]);
  });
});

describe('범위와 협력적 취소 지점', () => {
  it.each([
    [1, 4096, 1], [50, 80, 1], [75, 90, 2], [150, 800, 3], [4096, 976, 20], [2000, 2000, 32],
  ])('원본 %i×%i의 blur 반경은 %i다', (width, height, radius) => {
    expect(photoBlurRadius({ width, height })).toBe(radius);
  });

  it.each([
    { sharpness: -101 }, { sharpness: 101 }, { sharpness: 0.5 }, { sharpness: Number.NaN },
    { circularBlur: -1 }, { circularBlur: 101 }, { circularBlur: Number.POSITIVE_INFINITY },
    { linearBlur: -1 }, { linearBlur: 100.5 }, { vignette: -1 }, { vignette: 101 },
  ])('잘못된 효과 %j는 픽셀을 바꾸기 전에 거절한다', patch => {
    const pixels = sample({ width: 2, height: 3 }), before = new Uint8ClampedArray(pixels);
    expect(() => finish(applyPhotoEffects(pixels, { width: 2, height: 3 }, { ...neutral, ...patch }))).toThrow();
    expect(pixels).toEqual(before);
  });

  it.each([0, -1, 1.5, 33, Number.NaN])('box 반경 %s는 허용하지 않는다', radius => {
    expect(() => boxBlurPhotoPixels(new Uint8ClampedArray(4), { width: 1, height: 1 }, radius).next()).toThrow();
  });

  it.each([{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 4097, height: 1 }, { width: 2001, height: 2000 }, { width: 2, height: 2 }])('크기·배열 길이가 어긋나면 먼저 거절한다: %j', size => {
    expect(() => applyPhotoEffects(new Uint8ClampedArray(4), size, { ...neutral, circularBlur: 1 }).next()).toThrow();
  });

  it('최대 반경의 좁고 긴 영상은 출력 전 적재 중에도 중단할 수 있다', () => {
    const size = { width: 4096, height: 2 }, pixels = sample(size), before = new Uint8ClampedArray(pixels);
    const iterator = boxBlurPhotoPixels(pixels, size, 32);
    expect(iterator.next().done).toBe(false);
    expect(iterator.next().done).toBe(false);
    expect(pixels).toEqual(before);
    expect(iterator.return(undefined).done).toBe(true);
    expect(iterator.next().done).toBe(true); expect(pixels).toEqual(before);
  });

  it('합성 필터는 시작 전 중단할 수 있고 다음 렌더는 원본에서 독립적으로 계산된다', () => {
    const size = { width: 7, height: 5 }, input = sample(size), pixels = new Uint8ClampedArray(input);
    const effects = { sharpness: 100, circularBlur: 100, linearBlur: 100, vignette: 100 };
    const iterator = applyPhotoEffects(pixels, size, effects);
    expect(iterator.next().done).toBe(false); expect(pixels).toEqual(input);
    iterator.return(undefined);
    expect(actual(input, size, effects)).toEqual(oracle(input, size, effects));
  });

  it('비네팅만 켠 경우에도 전체 픽셀 처리 전 yield하고 반환 후 추가 작업이 없다', () => {
    const size = { width: 64, height: 64 }, pixels = new Uint8ClampedArray(64 * 64 * 4).fill(200), before = new Uint8ClampedArray(pixels);
    const iterator = applyPhotoEffects(pixels, size, { ...neutral, vignette: 100 });
    expect(iterator.next().done).toBe(false);
    expect(pixels.subarray(0, 4)).not.toEqual(before.subarray(0, 4));
    expect(pixels.subarray(-4)).toEqual(before.subarray(-4));
    const stopped = new Uint8ClampedArray(pixels);
    iterator.return(undefined); expect(iterator.next().done).toBe(true); expect(pixels).toEqual(stopped);
  });
});

describe('공간 보정 scratch 할당', () => {
  function allocationBytes(action: () => void) {
    const names = ['Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array'] as const;
    const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)!] as const), allocations: number[] = [];
    for (const [name, descriptor] of originals) Object.defineProperty(globalThis, name, { ...descriptor, value: new Proxy(globalThis[name], {
      construct(target, argumentsList, newTarget) {
        const result = Reflect.construct(target, argumentsList, newTarget) as ArrayBufferView;
        allocations.push(result.byteLength); return result;
      },
    }) });
    try { action(); } finally { for (const [name, descriptor] of originals) Object.defineProperty(globalThis, name, descriptor); }
    return allocations;
  }
  it('모든 값 0은 공간 필터용 typed array를 만들지 않는다', () => {
    const size = { width: 7, height: 5 }, pixels = sample(size);
    expect(allocationBytes(() => finish(applyPhotoEffects(pixels, size, neutral)))).toEqual([]);
  });
  it('선명도와 두 블러가 하나의 행 버퍼·열 누적값을 재사용한다', () => {
    const size = { width: 100, height: 100 }, pixels = sample(size);
    expect(allocationBytes(() => finish(applyPhotoEffects(pixels, size, { sharpness: 45, circularBlur: 80, linearBlur: 60, vignette: 30 })))).toEqual([8000, 1600]);
  });
  it('4096px·반경32의 최대 scratch는 4.125MiB이며 별도 전체 이미지 복제를 만들지 않는다', () => {
    const size = { width: 4096, height: 1 }, pixels = sample(size);
    const allocations = allocationBytes(() => finish(boxBlurPhotoPixels(pixels, size, 32)));
    expect(allocations).toEqual([4_259_840, 65_536]);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(4_325_376);
  });
});
