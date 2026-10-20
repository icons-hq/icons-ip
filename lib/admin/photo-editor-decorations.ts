import type { PhotoSize } from './photo-editor';

/** Original numeric geometry only. Both Canvas and inert SVG consume these paths. */
export type PhotoPathCommand = ['M' | 'L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];
export type PhotoGeometryPath = { commands: PhotoPathCommand[]; fill?: 'ink' | 'paper'; stroke?: 'ink'; strokeWidth?: number; dash?: number[] };
export const PHOTO_STICKERS = [
  { value: 'arrow', label: '화살표' }, { value: 'heart', label: '하트' }, { value: 'star', label: '별' },
  { value: 'sparkle', label: '반짝임' }, { value: 'check', label: '체크' }, { value: 'ring', label: '원 표시' },
] as const;
export type PhotoStickerAsset = typeof PHOTO_STICKERS[number]['value'];
export type PhotoSticker = { id: string; asset: PhotoStickerAsset; x: number; y: number; width: number; turns: 0 | 1 | 2 | 3; color: string; opacity: number };
export const PHOTO_TEXT_STYLES = [
  { value: 'plain', label: '일반 텍스트', kind: 'plain' },
  { value: 'bubble-round', label: '둥근 말풍선', kind: 'bubble' }, { value: 'bubble-oval', label: '타원 말풍선', kind: 'bubble' },
  { value: 'signature-rule', label: '선 서명', kind: 'signature' }, { value: 'signature-plate', label: '라벨 서명', kind: 'signature' },
  { value: 'signature-seal', label: '원형 서명', kind: 'signature' },
] as const;
export type PhotoTextStyle = typeof PHOTO_TEXT_STYLES[number]['value'];
export type PhotoTextDecoration = { style?: PhotoTextStyle; decorationWidth?: number; backgroundColor?: string };
export const PHOTO_DECORATED_TEXT_LIMIT = 80;
export const photoTextLineLimit = (style: PhotoTextStyle = 'plain') => style === 'plain' ? 8 : style === 'signature-seal' ? 2 : 3;
export const photoColorValid = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export function validatePhotoTextDecoration(value: PhotoTextDecoration, text: string): void {
  const style = value.style ?? 'plain';
  if (!PHOTO_TEXT_STYLES.some(item => item.value === style)
    || style !== 'plain' && (!finite(value.decorationWidth!, 1, 4096) || !photoColorValid(value.backgroundColor)
      || text.length > PHOTO_DECORATED_TEXT_LIMIT || text.split('\n').length > photoTextLineLimit(style)))
    throw new Error('말풍선·텍스트 서명의 스타일, 너비와 문구를 확인해주세요. 장식 문구는 80자·3줄, 원형 서명은 2줄까지입니다.');
}

export function validatePhotoSticker(layer: PhotoSticker, size: PhotoSize): void {
  if (!PHOTO_STICKERS.some(asset => asset.value === layer.asset) || !photoColorValid(layer.color)
    || !finite(layer.width, 1, Math.min(size.width, size.height)) || !finite(layer.x, 0, size.width - layer.width)
    || !finite(layer.y, 0, size.height - layer.width) || !Number.isInteger(layer.turns) || !finite(layer.turns, 0, 3)
    || !Number.isInteger(layer.opacity) || !finite(layer.opacity, 0, 100)) throw new Error('스티커의 종류·위치·크기·색·불투명도를 확인해주세요.');
}

export function fitPhotoSticker(size: PhotoSize, current: PhotoSticker, patch: Partial<PhotoSticker>): PhotoSticker {
  const next = { ...current, ...patch };
  if ([next.x, next.y, next.width, next.turns, next.opacity].some(value => !Number.isFinite(value))) return current;
  const clamp = (value: number, max: number, min = 0) => Math.min(max, Math.max(min, Math.round(value)));
  next.width = clamp(next.width, Math.min(size.width, size.height), 1);
  next.x = clamp(next.x, size.width - next.width); next.y = clamp(next.y, size.height - next.width);
  next.turns = clamp(next.turns, 3) as PhotoSticker['turns']; next.opacity = clamp(next.opacity, 100);
  return next;
}

export function photoPathData(commands: readonly PhotoPathCommand[]): string {
  return commands.map(([op, ...values]) => op + values.map(value => Math.round(value * 1e6) / 1e6).join(' ')).join(' ');
}
export function ellipsePhotoPath(cx: number, cy: number, rx: number, ry: number): PhotoPathCommand[] {
  const k = .5522847498307936;
  return [['M', cx + rx, cy], ['C', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry],
    ['C', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
    ['C', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry],
    ['C', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ['Z']];
}
export function polygonPhotoPath(points: readonly { x: number; y: number }[]): PhotoPathCommand[] {
  return [...points.map((point, i) => [i ? 'L' : 'M', point.x, point.y] as PhotoPathCommand), ['Z']];
}
export function rectanglePhotoPath(x: number, y: number, width: number, height: number, radius = 0): PhotoPathCommand[] {
  const r = Math.min(radius, width / 2, height / 2), k = .5522847498307936, right = x + width, bottom = y + height;
  return [['M', x + r, y], ['L', right - r, y], ['C', right - r + r * k, y, right, y + r - r * k, right, y + r],
    ['L', right, bottom - r], ['C', right, bottom - r + r * k, right - r + r * k, bottom, right - r, bottom],
    ['L', x + r, bottom], ['C', x + r - r * k, bottom, x, bottom - r + r * k, x, bottom - r],
    ['L', x, y + r], ['C', x, y + r - r * k, x + r - r * k, y, x + r, y], ['Z']];
}
function radial(points: number, inner: number): PhotoPathCommand[] {
  return polygonPhotoPath(Array.from({ length: points * 2 }, (_, i) => {
    const angle = -Math.PI / 2 + i * Math.PI / points, radius = i % 2 ? inner : 44;
    return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
  }));
}
export function photoStickerGeometry(asset: PhotoStickerAsset): PhotoGeometryPath[] {
  switch (asset) {
    case 'arrow': return [{ fill: 'ink', commands: polygonPhotoPath([{ x: 8, y: 36 }, { x: 56, y: 36 }, { x: 56, y: 12 }, { x: 94, y: 50 }, { x: 56, y: 88 }, { x: 56, y: 64 }, { x: 8, y: 64 }]) }];
    case 'heart': return [{ fill: 'ink', commands: [['M', 50, 88], ['C', 35, 75, 8, 55, 8, 32], ['C', 8, 8, 38, 6, 50, 29], ['C', 62, 6, 92, 8, 92, 32], ['C', 92, 55, 65, 75, 50, 88], ['Z']] }];
    case 'star': return [{ fill: 'ink', commands: radial(5, 20) }];
    case 'sparkle': return [{ fill: 'ink', commands: radial(4, 12) }];
    case 'check': return [{ stroke: 'ink', strokeWidth: 12, commands: [['M', 14, 49], ['L', 39, 75], ['L', 87, 23]] }];
    case 'ring': return [{ stroke: 'ink', strokeWidth: 8, commands: ellipsePhotoPath(50, 50, 40, 40) }];
  }
}
export type PhotoTextGeometry = { height: number; paths: PhotoGeometryPath[]; box: { x: number; y: number; width: number; height: number } };
export function photoTextGeometry(style: Exclude<PhotoTextStyle, 'plain'>): PhotoTextGeometry {
  switch (style) {
    case 'bubble-round': return { height: 70, box: { x: 10, y: 9, width: 80, height: 40 }, paths: [
      { fill: 'paper', commands: [...rectanglePhotoPath(2, 2, 96, 54, 9), ...polygonPhotoPath([{ x: 24, y: 48 }, { x: 44, y: 48 }, { x: 20, y: 68 }])] },
    ] };
    case 'bubble-oval': return { height: 70, box: { x: 18, y: 14, width: 64, height: 32 }, paths: [
      { fill: 'paper', commands: [...ellipsePhotoPath(50, 29, 48, 27), ...polygonPhotoPath([{ x: 65, y: 44 }, { x: 80, y: 37 }, { x: 85, y: 68 }])] },
    ] };
    case 'signature-rule': return { height: 60, box: { x: 8, y: 5, width: 84, height: 40 }, paths: [
      { stroke: 'ink', strokeWidth: 1.5, commands: [['M', 8, 50], ['L', 92, 50], ['M', 8, 44], ['L', 8, 54]] },
    ] };
    case 'signature-plate': return { height: 60, box: { x: 10, y: 9, width: 80, height: 38 }, paths: [
      { fill: 'paper', stroke: 'ink', strokeWidth: 1.5, commands: rectanglePhotoPath(2, 2, 96, 56) },
      { stroke: 'ink', strokeWidth: 1.5, commands: [['M', 40, 52], ['L', 60, 52]] },
    ] };
    case 'signature-seal': return { height: 100, box: { x: 20, y: 28, width: 60, height: 44 }, paths: [
      { fill: 'paper', stroke: 'ink', strokeWidth: 1.5, commands: ellipsePhotoPath(50, 50, 47, 47) },
      { stroke: 'ink', strokeWidth: 1, commands: ellipsePhotoPath(50, 50, 42, 42) },
    ] };
  }
}

export type PhotoMeasuredText = { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number };
/** Never truncate or shrink. The caller measures with the loaded, rendering font. */
export function layoutPhotoDecoratedText(text: string, style: Exclude<PhotoTextStyle, 'plain'>, width: number, fontSize: number, measure: (line: string) => PhotoMeasuredText) {
  const { box } = photoTextGeometry(style), scale = width / 100, lineHeight = fontSize * 1.3;
  const lines = text.split('\n'), availableWidth = box.width * scale, availableHeight = box.height * scale;
  if (text.length > PHOTO_DECORATED_TEXT_LIMIT || lines.length > photoTextLineLimit(style) || lines.length * lineHeight > availableHeight)
    throw new Error('장식 안에 문구가 맞지 않습니다. 글자 크기를 줄이거나 장식 너비·줄바꿈을 조절해주세요.');
  return lines.map((line, index) => {
    const measured = measure(line);
    const values = [measured.width, measured.actualBoundingBoxLeft, measured.actualBoundingBoxRight, measured.actualBoundingBoxAscent, measured.actualBoundingBoxDescent];
    const inkWidth = Math.max(measured.width, measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight);
    if (values.some(value => !Number.isFinite(value)) || inkWidth > availableWidth
      || measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent > lineHeight)
      throw new Error('장식 안에 문구가 맞지 않습니다. 글자 크기를 줄이거나 장식 너비·줄바꿈을 조절해주세요.');
    return { text: line, x: box.x * scale + (availableWidth - inkWidth) / 2 + Math.max(0, measured.actualBoundingBoxLeft),
      y: box.y * scale + (availableHeight - lines.length * lineHeight) / 2 + index * lineHeight + (lineHeight - measured.actualBoundingBoxAscent - measured.actualBoundingBoxDescent) / 2 + measured.actualBoundingBoxAscent };
  });
}
