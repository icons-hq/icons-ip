import { describe, expect, it, vi } from 'vitest';
import { applyPhotoAutoLevelBlock, calculatePhotoAutoLevels, type PhotoAutoLevels } from './photo-editor-auto-levels';

function levels(input: Uint8ClampedArray): PhotoAutoLevels {
  const calculation = calculatePhotoAutoLevels(input);
  let step = calculation.next();
  while (!step.done) step = calculation.next();
  return step.value;
}

/** Independent weighted-order-statistic oracle: expand weights, sort, select ranks. */
function oracle(input: Uint8ClampedArray) {
  const values: number[] = [];
  for (let i = 0; i < input.length; i += 4) {
    const luma = Math.round((input[i] * 54 + input[i + 1] * 183 + input[i + 2] * 19) / 256);
    for (let weight = 0; weight < input[i + 3]; weight++) values.push(luma);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return { low: 0, high: 255 };
  const low = values[Math.ceil(values.length / 100) - 1], high = values[Math.ceil(values.length * .99) - 1];
  return high - low < 16 ? { low: 0, high: 255 } : { low, high };
}

describe('source-only automatic contrast', () => {
  it('matches independently sorted alpha-weighted ranks with hidden and partial-alpha colors', () => {
    for (const count of [1, 2, 7, 65, 301]) {
      const input = new Uint8ClampedArray(Array.from({ length: count }, (_, i) => [i * 41 % 256, i * 73 % 256, i * 113 % 256, [0, 1, 17, 128, 254, 255][i % 6]]).flat());
      const before = new Uint8ClampedArray(input);
      expect(levels(input)).toEqual(oracle(input)); expect(input).toEqual(before);
    }
  });
  it('uses ceil percentile ranks, rejects a small contrast interval and leaves transparent sources unchanged', () => {
    const hundred = new Uint8ClampedArray(Array.from({ length: 100 }, (_, i) => [i + 50, i + 50, i + 50, 255]).flat());
    expect(levels(hundred)).toEqual({ low: 50, high: 148 });
    expect(levels(new Uint8ClampedArray([100, 100, 100, 255, 115, 115, 115, 255]))).toEqual({ low: 0, high: 255 });
    expect(levels(new Uint8ClampedArray([100, 100, 100, 255, 116, 116, 116, 255]))).toEqual({ low: 100, high: 116 });
    expect(levels(new Uint8ClampedArray([9, 200, 99, 0]))).toEqual({ low: 0, high: 255 });
  });
  it('maps common RGB limits with one final rounding, clips channels, and preserves all alpha and hidden RGB', () => {
    const input = new Uint8ClampedArray([50, 75, 100, 255, 125, 150, 200, 128, 9, 200, 99, 0]);
    applyPhotoAutoLevelBlock(input, { low: 50, high: 150 });
    expect([...input]).toEqual([0, 64, 128, 255, 191, 255, 255, 128, 9, 200, 99, 0]);
    const before = new Uint8ClampedArray(input); applyPhotoAutoLevelBlock(input, { low: 0, high: 255 }); expect(input).toEqual(before);
  });
  it('bounded chunks produce the same result without changing pixels beyond the block', () => {
    const input = new Uint8ClampedArray([20, 60, 100, 17, 80, 120, 160, 255, 50, 80, 110, 0]);
    const full = new Uint8ClampedArray(input), split = new Uint8ClampedArray(input);
    applyPhotoAutoLevelBlock(full, { low: 20, high: 160 });
    applyPhotoAutoLevelBlock(split, { low: 20, high: 160 }, 0, 4);
    expect(split.slice(4)).toEqual(input.slice(4));
    applyPhotoAutoLevelBlock(split, { low: 20, high: 160 }, 4, split.length); expect(split).toEqual(full);
  });
  it('yields before allocation, keeps only a 1KiB histogram, and can close partway without editing source', () => {
    const input = new Uint8ClampedArray(20_000 * 4).fill(255), sizes: number[] = [], Original = Uint32Array;
    vi.stubGlobal('Uint32Array', new Proxy(Original, { construct(target, args) { const result = Reflect.construct(target, args); sizes.push(result.byteLength); return result; } }));
    try {
      const calculation = calculatePhotoAutoLevels(input);
      expect(calculation.next().done).toBe(false); expect(sizes).toEqual([]);
      expect(calculation.next().done).toBe(false); expect(sizes).toEqual([1024]);
      calculation.return({ low: 0, high: 255 }); expect(input.every(value => value === 255)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('supports the entire 4MP alpha sum without integer overflow', () => {
    const input = new Uint8ClampedArray(4_000_000 * 4).fill(255);
    for (let i = 0; i < input.length / 2; i += 4) input[i] = input[i + 1] = input[i + 2] = 40;
    expect(levels(input)).toEqual({ low: 40, high: 255 });
  });
  it.each([0, 3, 4_000_001 * 4])('rejects invalid RGBA length %s', length => {
    expect(() => calculatePhotoAutoLevels(new Uint8ClampedArray(length)).next()).toThrow('크기');
  });
});
