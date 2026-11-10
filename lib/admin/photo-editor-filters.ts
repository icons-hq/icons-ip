/** ICONS color presets. These fixed RGB transforms use no external assets or model. */
export const PHOTO_FILTERS = [
  { value: 'none', label: '필터 없음' },
  { value: 'warm', label: '따뜻하게' },
  { value: 'cool', label: '시원하게' },
  { value: 'monochrome', label: '흑백' },
  { value: 'sepia', label: '세피아' },
  { value: 'faded', label: '바랜 색감' },
] as const;
export type PhotoFilter = typeof PHOTO_FILTERS[number]['value'];

type ColorTransform = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
// Three RGB rows followed by channel offsets. Round and clamp once per stage.
const transforms: Record<Exclude<PhotoFilter, 'none'>, ColorTransform> = {
  warm: [1.04, 0, 0, 0, 1, 0, 0, 0, .94, 6, 1, -4],
  cool: [.96, 0, 0, 0, 1, 0, 0, 0, 1.04, -4, 1, 6],
  monochrome: [.2126, .7152, .0722, .2126, .7152, .0722, .2126, .7152, .0722, 0, 0, 0],
  sepia: [.393, .769, .189, .349, .686, .168, .272, .534, .131, 0, 0, 0],
  faded: [.82, 0, 0, 0, .82, 0, 0, 0, .82, 32, 29, 24],
};

export function validatePhotoFilter(value: PhotoFilter, strength = 100): void {
  if (!PHOTO_FILTERS.some(filter => filter.value === value) || !Number.isInteger(strength) || strength < 0 || strength > 100)
    throw new Error('사진 색조 필터와 강도를 확인해주세요.');
}

/** Bounded, in-place work after automatic levels and before the user's manual adjustments. */
export function applyPhotoFilterBlock(pixels: Uint8ClampedArray, filter: PhotoFilter, start = 0, end = pixels.length, strength = 100): void {
  validatePhotoFilter(filter, strength);
  if (filter === 'none' || strength === 0) return;
  const m = transforms[filter], mix = strength / 100;
  const channel = (source: number, transformed: number) => {
    const filtered = Math.max(0, Math.min(255, Math.round(transformed)));
    return Math.round(source + (filtered - source) * mix);
  };
  for (let index = start; index < end; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
    pixels[index] = channel(red, red * m[0] + green * m[1] + blue * m[2] + m[9]);
    pixels[index + 1] = channel(green, red * m[3] + green * m[4] + blue * m[5] + m[10]);
    pixels[index + 2] = channel(blue, red * m[6] + green * m[7] + blue * m[8] + m[11]);
  }
}
