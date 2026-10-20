import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { initialPhotoRecipe, photoRecipeUnchanged, rotatePhotoRecipe, photoOrientedPoint, photoSourcePoint } from './photo-editor';
import { validatePhotoLayers } from './photo-editor-layers';
import { fitPhotoSticker, layoutPhotoDecoratedText, PHOTO_STICKERS, photoPathData, photoStickerGeometry, photoTextGeometry,
  validatePhotoTextDecoration, type PhotoGeometryPath, type PhotoSticker, type PhotoTextStyle } from './photo-editor-decorations';
import { PHOTO_MASKS, photoDecoratedFrameGeometry } from './photo-editor-presentation';

const sticker: PhotoSticker = { id: 'sticker', asset: 'heart', x: 20, y: 10, width: 80, turns: 0, color: '#ff0000', opacity: 100 };
const measure = (line: string) => ({ width: Array.from(line).length * 10, actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: Array.from(line).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
function svg(paths: readonly PhotoGeometryPath[], height = 100, opacity = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="${height}"><g opacity="${opacity}">${paths.map(path => `<path d="${photoPathData(path.commands)}" fill="${path.fill ? '#ff0000' : 'none'}" stroke="${path.stroke ? '#ff0000' : 'none'}" stroke-width="${path.strokeWidth ?? 1}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${path.dash?.join(' ') ?? ''}"/>`).join('')}</g></svg>`;
}
async function pixels(paths: readonly PhotoGeometryPath[], height = 100, opacity = 1) {
  const result = await sharp(Buffer.from(svg(paths, height, opacity))).ensureAlpha().raw().toBuffer();
  return (x: number, y: number) => [...result.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)];
}

describe('photo decoration contract', () => {
  it('keeps legacy missing fields, inactive frames, transparent stickers and empty decorated text as the original file', () => {
    const original = initialPhotoRecipe();
    const legacy = { ...original }; delete legacy.stickers; delete legacy.frameStyle;
    expect(photoRecipeUnchanged(legacy)).toBe(true);
    expect(photoRecipeUnchanged({ ...original, frameStyle: 'double', stickers: [{ ...sticker, opacity: 0 }],
      texts: [{ id: 'empty', text: ' \n ', x: 0, y: 0, fontSize: 20, color: '#123456', style: 'signature-seal', decorationWidth: 100, backgroundColor: '#ffffff' }] })).toBe(true);
    expect(photoRecipeUnchanged({ ...original, stickers: [sticker] })).toBe(false);
    expect(photoRecipeUnchanged({ ...original, frameStyle: 'dashed', frameWidth: 3 })).toBe(false);
  });
  it.each([{ asset: 'url(https://invalid)' }, { color: '#fff' }, { opacity: .5 }, { opacity: 101 }, { turns: 4 }, { width: 0 }, { x: Infinity }, { y: 100 }])('rejects external sticker values %j', patch => {
    expect(() => validatePhotoLayers({ mosaics: [], texts: [], stickers: [{ ...sticker, ...patch } as PhotoSticker] }, { width: 200, height: 100 })).toThrow();
  });
  it('enforces cross-tool IDs and an independent eight-sticker limit', () => {
    expect(() => validatePhotoLayers({ mosaics: [], texts: [], stickers: null } as never)).toThrow();
    const stickers = Array.from({ length: 8 }, (_, i) => ({ ...sticker, id: String(i) }));
    expect(() => validatePhotoLayers({ mosaics: [], texts: [], stickers })).not.toThrow();
    expect(() => validatePhotoLayers({ mosaics: [], texts: [], stickers: [...stickers, { ...sticker, id: 'ninth' }] })).toThrow('8개');
    expect(() => validatePhotoLayers({ mosaics: [], texts: [{ id: '0', text: '', x: 0, y: 0, fontSize: 10, color: '#ffffff' }], stickers })).toThrow('영역');
  });
  it('fits square rotation bounds in tiny, portrait and landscape sources without leaking a patch mutation', () => {
    for (const size of [{ width: 1, height: 4096 }, { width: 80, height: 200 }, { width: 300, height: 100 }]) {
      const fit = fitPhotoSticker(size, sticker, { width: 4000, x: 4000, y: 4000, turns: 3, opacity: 0 });
      expect(fit.width).toBe(Math.min(size.width, size.height));
      expect(fit.x + fit.width).toBeLessThanOrEqual(size.width); expect(fit.y + fit.width).toBeLessThanOrEqual(size.height);
      expect(() => validatePhotoLayers({ mosaics: [], texts: [], stickers: [fit] }, size)).not.toThrow();
    }
    expect(fitPhotoSticker({ width: 300, height: 100 }, sticker, { width: NaN })).toBe(sticker);
    expect(sticker).toMatchObject({ x: 20, width: 80, turns: 0 });
  });
  it('uses existing source coordinates through rotation, crop and inverse movement', () => {
    const source = { width: 400, height: 300 }, recipe = rotatePhotoRecipe({ ...initialPhotoRecipe(), stickers: [sticker], crop: { x: .1, y: .2, width: .5, height: .6 } }, 1);
    expect(recipe.stickers?.[0]).toBe(sticker);
    const point = { x: sticker.x / source.width, y: sticker.y / source.height };
    expect(photoOrientedPoint(point, recipe, source)).toEqual({ x: 1 - point.y, y: point.x });
    const restored = photoSourcePoint(photoOrientedPoint(point, recipe, source), recipe, source);
    expect(restored.x).toBeCloseTo(point.x); expect(restored.y).toBeCloseTo(point.y);
  });
  it('keeps plain text limits while requiring bounded decorated styles and complete colors', () => {
    expect(() => validatePhotoTextDecoration({}, '가'.repeat(300))).not.toThrow();
    const value = { style: 'bubble-round' as const, decorationWidth: 100, backgroundColor: '#ffffff' };
    expect(() => validatePhotoTextDecoration(value, '가'.repeat(80))).not.toThrow();
    for (const [patch, text] of [[{ style: 'foreign' }, '문구'], [{ decorationWidth: NaN }, '문구'], [{ backgroundColor: '#fff' }, '문구'], [{}, '가'.repeat(81)], [{ style: 'signature-seal' }, '한\n두\n세']] as const)
      expect(() => validatePhotoTextDecoration({ ...value, ...patch } as never, text)).toThrow('서명');
  });
  it('measures Korean/multiline ink in the loaded font without truncating, shrinking or ignoring wide side bearings', () => {
    const lines = layoutPhotoDecoratedText('한글\n둘째 줄', 'bubble-round', 200, 20, measure);
    expect(lines.map(line => line.text)).toEqual(['한글', '둘째 줄']); expect(lines[1].y - lines[0].y).toBeCloseTo(26);
    expect(lines.every(line => line.x >= 20 && line.y >= 18 && line.y <= 98)).toBe(true);
    expect(() => layoutPhotoDecoratedText('가'.repeat(17), 'bubble-round', 200, 20, measure)).toThrow('맞지');
    expect(() => layoutPhotoDecoratedText('한\n두\n세', 'signature-seal', 200, 20, measure)).toThrow('맞지');
    expect(() => layoutPhotoDecoratedText('한', 'signature-rule', 100, 40, measure)).toThrow('맞지');
    expect(() => layoutPhotoDecoratedText('한', 'signature-seal', 100, 10, () => ({ ...measure('한'), actualBoundingBoxLeft: 40, actualBoundingBoxRight: 40 }))).toThrow('맞지');
    expect(() => layoutPhotoDecoratedText('한', 'signature-seal', 100, 10, () => ({ ...measure('한'), width: NaN }))).toThrow('맞지');
  });
});

describe('independent raster oracle for shared original geometry', () => {
  it.each(PHOTO_STICKERS)('$label keeps untouched corners and a known interior mark', async ({ value }) => {
    const pixel = await pixels(photoStickerGeometry(value));
    expect(pixel(1, 1)[3]).toBe(0); expect(pixel(98, 98)[3]).toBe(0);
    const point = value === 'check' ? [39, 74] : value === 'ring' ? [50, 10] : [50, 50];
    expect(pixel(point[0], point[1])).toEqual([255, 0, 0, 255]);
    if (value === 'ring') expect(pixel(50, 50)[3]).toBe(0);
  });
  it('bubble tails join their bodies without transparent winding holes', async () => {
    const round = await pixels(photoTextGeometry('bubble-round').paths, 70), oval = await pixels(photoTextGeometry('bubble-oval').paths, 70);
    expect(round(28, 51)[3]).toBe(255); expect(round(24, 61)[3]).toBe(255); expect(round(50, 66)[3]).toBe(0);
    expect(oval(73, 45)[3]).toBe(255); expect(oval(80, 57)[3]).toBe(255); expect(oval(10, 65)[3]).toBe(0);
  });
  it('composites opacity inside the mark and retains transparent outside pixels', async () => {
    const pixel = await pixels(photoStickerGeometry('heart'), 100, .5);
    expect(pixel(50, 50)).toEqual([255, 0, 0, 128]); expect(pixel(0, 0)[3]).toBe(0);
  });
  it('double frames leave a real transparent gap and dashed frames leave intervals', async () => {
    const base = { mask: 'none' as const, frameWidth: 9, frameColor: '#ff0000' };
    const double = await pixels(photoDecoratedFrameGeometry({ width: 100, height: 100 }, { ...base, frameStyle: 'double' }));
    expect(double(50, 1)[3]).toBe(255); expect(double(50, 4)[3]).toBe(0); expect(double(50, 7)[3]).toBe(255); expect(double(50, 50)[3]).toBe(0);
    const dashed = await pixels(photoDecoratedFrameGeometry({ width: 100, height: 100 }, { ...base, frameStyle: 'dashed' }));
    expect(dashed(15, 4)[3]).toBe(255); expect(dashed(40, 4)[3]).toBe(0);
  });
  it('all final masks and tiny/asymmetric crops yield finite bounded frame geometry', () => {
    for (const mask of PHOTO_MASKS) for (const size of [{ width: 1, height: 4096 }, { width: 2, height: 2 }, { width: 30, height: 300 }, { width: 300, height: 30 }]) {
      for (const frameStyle of ['double', 'dashed'] as const) {
        const paths = photoDecoratedFrameGeometry(size, { mask, frameStyle, frameWidth: 64, frameColor: '#ffffff' });
        expect(paths.every(path => path.commands.every(([, ...values]) => values.every(Number.isFinite)))).toBe(true);
        if (size.width === 1) expect(paths).toEqual([]);
        if (size.width === 2) expect(paths).toHaveLength(1);
      }
    }
  });
  it.each(['bubble-round', 'bubble-oval', 'signature-rule', 'signature-plate', 'signature-seal'] satisfies Exclude<PhotoTextStyle, 'plain'>[])('%s exposes numeric geometry and an internal text box', style => {
    const geometry = photoTextGeometry(style);
    expect(geometry.box.x).toBeGreaterThan(0); expect(geometry.box.y).toBeGreaterThan(0);
    expect(geometry.box.x + geometry.box.width).toBeLessThan(100); expect(geometry.box.y + geometry.box.height).toBeLessThan(geometry.height);
    expect(svg(geometry.paths, geometry.height)).not.toMatch(/href|script|foreignObject|url\(/);
  });
});
