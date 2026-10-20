import type { PhotoSize } from './photo-editor';

export type PhotoEffects = { sharpness: number; circularBlur: number; linearBlur: number; vignette: number };
export const PHOTO_BLUR_MAX_RADIUS = 32;
const BINOMIAL = [1, 4, 6, 4, 1] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (start: number, end: number, distance: number) => {
  const value = clamp((distance - start) / (end - start), 0, 1);
  return value * value * (3 - 2 * value);
};

export function photoBlurRadius(size: PhotoSize): number {
  return Math.min(PHOTO_BLUR_MAX_RADIUS, Math.max(1, Math.round(Math.min(size.width, size.height) / 50)));
}

export function validatePhotoEffects(effects: PhotoEffects): void {
  if (!Number.isInteger(effects.sharpness) || effects.sharpness < -100 || effects.sharpness > 100
    || [effects.circularBlur, effects.linearBlur, effects.vignette].some(value => !Number.isInteger(value) || value < 0 || value > 100)) {
    throw new Error('선명도는 -100~100, 블러·비네팅은 0~100의 정수로 입력해주세요.');
  }
}

type PixelFilter = (x: number, y: number, channel: number, original: number, blurred: number) => number;
type FilterWorkspace = { ring: Uint32Array; vertical: Uint32Array | null };
function validatePixels(pixels: Uint8ClampedArray, { width, height }: PhotoSize) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096
    || width * height > 4_000_000 || pixels.length !== width * height * 4) throw new Error('사진 픽셀 크기를 확인해주세요.');
}

/** Source rows enter the ring before any pixel in that row is overwritten.
 * Raw C*A and A sums have no intermediate rounding. At r<=32, the largest box
 * sum is 65²*255²=274,730,625, safely below Uint32's upper bound.
 * Scratch <= (65*4096*4 + 4096*4)*4 = 4.125MiB, excluding existing image/canvas.
 */
function* filterRows(pixels: Uint8ClampedArray, size: PhotoSize, radius: number, kernel: 'box' | 'binomial', filter: PixelFilter, workspace?: FilterWorkspace): Generator<void> {
  if (!Number.isInteger(radius) || radius < 1 || radius > PHOTO_BLUR_MAX_RADIUS) throw new Error('사진 블러 반경을 확인해주세요.');
  const { width, height } = size, rowLength = width * 4, rows = radius * 2 + 1;
  validatePixels(pixels, size);
  // Expose cancellation before allocation/preload, not just after the first output row.
  yield;
  const ring = workspace?.ring ?? new Uint32Array(rows * rowLength);
  const vertical = kernel === 'box' ? workspace?.vertical ?? new Uint32Array(rowLength) : null;
  vertical?.fill(0);
  let work = 0;
  function* loadRow(slot: number, sourceY: number): Generator<void> {
    const row = clamp(sourceY, 0, height - 1) * rowLength, destination = slot * rowLength;
    let red = 0, green = 0, blue = 0, alpha = 0;
    if (kernel === 'box') {
      for (let offset = -radius; offset <= radius; offset++) {
        const index = row + clamp(offset, 0, width - 1) * 4, a = pixels[index + 3];
        red += pixels[index] * a; green += pixels[index + 1] * a; blue += pixels[index + 2] * a; alpha += a;
      }
    }
    for (let x = 0; x < width; x++) {
      if (kernel === 'binomial') {
        red = 0; green = 0; blue = 0; alpha = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const index = row + clamp(x + offset, 0, width - 1) * 4, weight = pixels[index + 3] * BINOMIAL[offset + radius];
          red += pixels[index] * weight; green += pixels[index + 1] * weight; blue += pixels[index + 2] * weight; alpha += weight;
        }
      }
      const index = destination + x * 4;
      ring[index] = red; ring[index + 1] = green; ring[index + 2] = blue; ring[index + 3] = alpha;
      if (kernel === 'box' && x + 1 < width) {
        const leave = row + clamp(x - radius, 0, width - 1) * 4, enter = row + clamp(x + radius + 1, 0, width - 1) * 4;
        const oldAlpha = pixels[leave + 3], newAlpha = pixels[enter + 3];
        red += pixels[enter] * newAlpha - pixels[leave] * oldAlpha;
        green += pixels[enter + 1] * newAlpha - pixels[leave + 1] * oldAlpha;
        blue += pixels[enter + 2] * newAlpha - pixels[leave + 2] * oldAlpha;
        alpha += newAlpha - oldAlpha;
      }
      if (++work >= 1024) { work = 0; yield; }
    }
  }
  for (let slot = 0; slot < rows; slot++) {
    yield* loadRow(slot, slot - radius);
    if (vertical) for (let index = 0; index < rowLength; index++) {
      vertical[index] += ring[slot * rowLength + index];
      if (++work >= 4096) { work = 0; yield; }
    }
  }
  let head = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4, column = x * 4;
      if (pixels[index + 3]) {
        let red = 0, green = 0, blue = 0, alpha = 0;
        if (vertical) {
          red = vertical[column]; green = vertical[column + 1]; blue = vertical[column + 2]; alpha = vertical[column + 3];
        } else for (let offset = 0; offset < rows; offset++) {
          const source = ((head + offset) % rows) * rowLength + column, weight = BINOMIAL[offset];
          red += ring[source] * weight; green += ring[source + 1] * weight; blue += ring[source + 2] * weight; alpha += ring[source + 3] * weight;
        }
        if (alpha) {
          pixels[index] = Math.round(filter(x, y, 0, pixels[index], red / alpha));
          pixels[index + 1] = Math.round(filter(x, y, 1, pixels[index + 1], green / alpha));
          pixels[index + 2] = Math.round(filter(x, y, 2, pixels[index + 2], blue / alpha));
        }
      }
      if (++work >= 1024) { work = 0; yield; }
    }
    if (y + 1 === height) break;
    if (vertical) for (let index = 0; index < rowLength; index++) {
      vertical[index] -= ring[head * rowLength + index];
      if (++work >= 4096) { work = 0; yield; }
    }
    yield* loadRow(head, y + radius + 1);
    if (vertical) for (let index = 0; index < rowLength; index++) {
      vertical[index] += ring[head * rowLength + index];
      if (++work >= 4096) { work = 0; yield; }
    }
    head = (head + 1) % rows;
  }
}

/** Standalone alpha-preserving box filter, also used for small independent 2D oracle checks. */
export function* boxBlurPhotoPixels(pixels: Uint8ClampedArray, size: PhotoSize, radius: number): Generator<void> {
  yield* filterRows(pixels, size, radius, 'box', (_x, _y, _channel, _original, blurred) => blurred);
}

/** ICONS rules, not a reconstruction of another editor's algorithms or ranges.
 * Source-center masks rotate with the photo and do not recenter when it is cropped.
 */
export function* applyPhotoEffects(pixels: Uint8ClampedArray, size: PhotoSize, effects: PhotoEffects): Generator<void> {
  validatePhotoEffects(effects);
  const { sharpness, circularBlur, linearBlur, vignette } = effects;
  if (!sharpness && !circularBlur && !linearBlur && !vignette) return;
  validatePixels(pixels, size);
  let workspace: FilterWorkspace | undefined;
  if (sharpness || circularBlur || linearBlur) {
    yield;
    const radius = Math.max(sharpness ? 2 : 0, circularBlur || linearBlur ? photoBlurRadius(size) : 0);
    workspace = { ring: new Uint32Array((radius * 2 + 1) * size.width * 4), vertical: circularBlur || linearBlur ? new Uint32Array(size.width * 4) : null };
  }
  if (sharpness) {
    const amount = sharpness / 100;
    yield* filterRows(pixels, size, 2, 'binomial', (_x, _y, _channel, original, blurred) => original + amount * (original - blurred), workspace);
  }
  const cx = size.width / 2, cy = size.height / 2, circleRadius = Math.min(cx, cy);
  if (circularBlur || linearBlur) {
    let lastX = -1, lastY = -1, amount = 0;
    yield* filterRows(pixels, size, photoBlurRadius(size), 'box', (x, y, _channel, original, blurred) => {
      if (x !== lastX || y !== lastY) {
        const circle = circularBlur / 100 * smoothstep(.45, .9, Math.hypot(x + .5 - cx, y + .5 - cy) / circleRadius);
        const line = linearBlur / 100 * smoothstep(.25, .75, Math.abs(y + .5 - cy) / cy);
        amount = 1 - (1 - circle) * (1 - line); lastX = x; lastY = y;
      }
      return original + amount * (blurred - original);
    }, workspace);
  }
  if (vignette) {
    const strength = vignette / 100;
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
      const index = (y * size.width + x) * 4;
      if (pixels[index + 3]) {
        const distance = Math.hypot((x + .5 - cx) / cx, (y + .5 - cy) / cy) / Math.SQRT2;
        const scale = 1 - strength * smoothstep(.25, 1, distance);
        pixels[index] = Math.round(pixels[index] * scale); pixels[index + 1] = Math.round(pixels[index + 1] * scale); pixels[index + 2] = Math.round(pixels[index + 2] * scale);
      }
      if ((index / 4 + 1) % 1024 === 0) yield;
    }
  }
}
