/** ICONS automatic contrast. The original source histogram never depends on a crop or prior edit. */
export type PhotoAutoLevels = { low: number; high: number };
const PIXELS_PER_CHUNK = 4096;

/** Alpha weights exclude hidden RGB. Only the fixed 1KiB histogram is allocated. */
export function* calculatePhotoAutoLevels(pixels: Uint8ClampedArray): Generator<void, PhotoAutoLevels, void> {
  if (!pixels.length || pixels.length % 4 !== 0 || pixels.length > 4_000_000 * 4) throw new Error('자동 명암을 계산할 사진 크기를 확인해주세요.');
  yield;
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let start = 0; start < pixels.length; start += PIXELS_PER_CHUNK * 4) {
    const end = Math.min(start + PIXELS_PER_CHUNK * 4, pixels.length);
    for (let i = start; i < end; i += 4) {
      const alpha = pixels[i + 3];
      if (!alpha) continue;
      const value = Math.round((54 * pixels[i] + 183 * pixels[i + 1] + 19 * pixels[i + 2]) / 256);
      histogram[value] += alpha; total += alpha;
    }
    yield;
  }
  if (!total) return { low: 0, high: 255 };
  const lowTarget = Math.ceil(total / 100), highTarget = Math.ceil(total * 99 / 100);
  let sum = 0, low = -1, high = 255;
  for (let value = 0; value < histogram.length; value++) {
    sum += histogram[value];
    if (low < 0 && sum >= lowTarget) low = value;
    if (sum >= highTarget) { high = value; break; }
  }
  return high - low < 16 ? { low: 0, high: 255 } : { low, high };
}

/** Same source-derived levels, applied before all manual tone adjustments. */
export function applyPhotoAutoLevelBlock(pixels: Uint8ClampedArray, { low, high }: PhotoAutoLevels, start = 0, end = pixels.length): void {
  if (low === 0 && high === 255) return;
  const range = high - low;
  for (let i = start; i < end; i += 4) {
    if (!pixels[i + 3]) continue;
    // Multiply integer values before dividing; a rounded scale can turn 127.5 into 127.499… .
    pixels[i] = Math.round((pixels[i] - low) * 255 / range);
    pixels[i + 1] = Math.round((pixels[i + 1] - low) * 255 / range);
    pixels[i + 2] = Math.round((pixels[i + 2] - low) * 255 / range);
  }
}
