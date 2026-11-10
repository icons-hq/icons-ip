/** Local line-direction estimate. It does not identify objects, faces or horizons. */
export const PHOTO_STRAIGHTEN_LIMIT = 15;
export const PHOTO_STRAIGHTEN_SAMPLE_SIDE = 640;
export type PhotoStraightenSize = { width: number; height: number };
export type PhotoStraightenEstimate = {
  degrees: number | null;
  reason: 'detected' | 'already-level' | 'insufficient-lines' | 'ambiguous' | 'outside-range' | 'excessive-crop';
  edgeSamples: number;
};
type Edge = { x: number; y: number; weight: number; horizontal: boolean };

function validateSize(size: PhotoStraightenSize) {
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width < 1 || size.height < 1) {
    throw new Error('사진 크기를 확인해주세요.');
  }
}
export function validatePhotoStraighten(degrees: number): void {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > PHOTO_STRAIGHTEN_LIMIT) throw new Error('수평 보정 각도는 -15도부터 15도까지 입력해주세요.');
}

/** Keep the existing canvas bounds and cover its corners by cropping, never invent a background. */
export function photoStraightenScale(size: PhotoStraightenSize, degrees: number): number {
  validateSize(size); validatePhotoStraighten(degrees);
  if (degrees === 0) return 1;
  const angle = Math.abs(degrees) * Math.PI / 180, sine = Math.sin(angle), cosine = Math.cos(angle);
  return Math.max(cosine + size.height / size.width * sine, cosine + size.width / size.height * sine);
}

/** Normalized, oriented-canvas coordinates; preserves points outside the canvas for layer deltas. */
export function photoStraightenPoint(point: { x: number; y: number }, size: PhotoStraightenSize, degrees: number, inverse = false) {
  const zoom = photoStraightenScale(size, degrees);
  if (degrees === 0) return { ...point };
  const angle = degrees * Math.PI / 180 * (inverse ? -1 : 1), cosine = Math.cos(angle), sine = Math.sin(angle);
  const x = (point.x - .5) * size.width / (inverse ? zoom : 1), y = (point.y - .5) * size.height / (inverse ? zoom : 1);
  const multiplier = inverse ? 1 : zoom;
  return { x: .5 + (cosine * x - sine * y) * multiplier / size.width,
    y: .5 + (sine * x + cosine * y) * multiplier / size.height };
}

function strongestLines(votes: Float64Array): { score: number; peak: number } {
  const excluded: number[] = [];
  let score = 0, peak = 0;
  for (let count = 0; count < 3; count++) {
    let value = 0, index = -1;
    for (let i = 1; i < votes.length - 1; i++) {
      if (excluded.some(previous => Math.abs(previous - i) <= 4)) continue;
      // Two neighboring rho bins retain a subpixel line instead of favoring an integer intercept.
      const candidate = votes[i] + Math.max(votes[i - 1], votes[i + 1]);
      if (candidate > value) { value = candidate; index = i; }
    }
    if (index < 0) break;
    excluded.push(index); score += value * value; peak = Math.max(peak, value);
  }
  return { score, peak };
}

/**
 * Sparse weighted Hough voting over near-horizontal/vertical edges. Yield between
 * scan blocks and angle candidates so the session can honor cancellation. The
 * sample must preserve the source aspect ratio and contain only original pixels.
 */
export function* estimatePhotoStraighten(pixels: Uint8ClampedArray, size: PhotoStraightenSize): Generator<void, PhotoStraightenEstimate> {
  validateSize(size);
  const { width, height } = size;
  if (Math.max(width, height) > PHOTO_STRAIGHTEN_SAMPLE_SIDE || pixels.length !== width * height * 4) throw new Error('수평 분석용 사진 크기를 확인해주세요.');
  const result = (degrees: number | null, reason: PhotoStraightenEstimate['reason'], edgeSamples = 0): PhotoStraightenEstimate => ({ degrees, reason, edgeSamples });
  if (Math.min(width, height) < 24) return result(null, 'insufficient-lines');
  const luminance = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; luminance[i / 4] = (54 * pixels[i] + 183 * pixels[i + 1] + 19 * pixels[i + 2] + 128) >> 8; }
    if (y % 32 === 31) yield;
  }
  const edges: Edge[] = [], stride = Math.max(1, Math.ceil(width * height / 30000));
  let horizontalWeight = 0, verticalWeight = 0, totalWeight = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (i % stride) continue;
      let alpha = 255;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) alpha = Math.min(alpha, pixels[(i + dy * width + dx) * 4 + 3]);
      // Transparent cutout boundaries are not evidence of a photographic level.
      if (alpha < 128) continue;
      const top = i - width, bottom = i + width;
      const gx = -luminance[top - 1] + luminance[top + 1] - 2 * luminance[i - 1] + 2 * luminance[i + 1] - luminance[bottom - 1] + luminance[bottom + 1];
      const gy = -luminance[top - 1] - 2 * luminance[top] - luminance[top + 1] + luminance[bottom - 1] + 2 * luminance[bottom] + luminance[bottom + 1];
      const ax = Math.abs(gx), ay = Math.abs(gy), magnitude = ax + ay;
      if (magnitude < 80 || Math.max(ax, ay) < Math.min(ax, ay) * 1.5) continue;
      const horizontal = ay > ax, weight = Math.min(255, magnitude / 4) * alpha / 255;
      edges.push({ x: x - width / 2, y: y - height / 2, weight, horizontal });
      if (horizontal) horizontalWeight += weight; else verticalWeight += weight;
      totalWeight += weight;
    }
    if (y % 16 === 15) yield;
  }
  if (edges.length < 24) return result(null, 'insufficient-lines', edges.length);
  const offset = Math.ceil(Math.hypot(width, height) / 2) + 2, bins = offset * 2 + 1;
  const scores: number[] = [], peaks: number[] = [], shares: number[] = [];
  const horizontal = new Float64Array(bins), vertical = new Float64Array(bins);
  for (let degrees = -PHOTO_STRAIGHTEN_LIMIT; degrees <= PHOTO_STRAIGHTEN_LIMIT; degrees += .5) {
    horizontal.fill(0); vertical.fill(0);
    const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    for (const edge of edges) {
      const rho = edge.horizontal ? edge.y * cosine - edge.x * sine : edge.x * cosine + edge.y * sine;
      const location = rho + offset, lower = Math.floor(location), part = location - lower, votes = edge.horizontal ? horizontal : vertical;
      votes[lower] += edge.weight * (1 - part); votes[lower + 1] += edge.weight * part;
    }
    const h = strongestLines(horizontal), v = strongestLines(vertical);
    scores.push(h.score + v.score); peaks.push(Math.max(h.peak, v.peak));
    shares.push(Math.max(h.peak / (horizontalWeight || 1), v.peak / (verticalWeight || 1)));
    yield;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const meanWeight = totalWeight / edges.length;
  if (peaks[best] < meanWeight * Math.max(8, Math.max(width, height) / stride * .12) || shares[best] < .025) return result(null, 'insufficient-lines', edges.length);
  const rival = Math.max(...scores.filter((_, index) => Math.abs(index - best) > 3));
  const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  if (scores[best] < rival * 1.12 || scores[best] < median * 1.4) return result(null, 'ambiguous', edges.length);
  if (best === 0 || best === scores.length - 1) return result(null, 'outside-range', edges.length);
  const denominator = scores[best - 1] - 2 * scores[best] + scores[best + 1];
  const refinement = denominator < 0 ? Math.max(-.5, Math.min(.5, .5 * (scores[best - 1] - scores[best + 1]) / denominator)) : 0;
  const correction = Math.round((PHOTO_STRAIGHTEN_LIMIT - (best + refinement) * .5) * 10) / 10;
  const rounded = Math.abs(correction) < .2 ? 0 : correction;
  if (photoStraightenScale(size, rounded) > 1.5) return result(null, 'excessive-crop', edges.length);
  return result(rounded, rounded === 0 ? 'already-level' : 'detected', edges.length);
}
