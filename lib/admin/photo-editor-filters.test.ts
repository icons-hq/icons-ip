import { describe, expect, it } from 'vitest';
import { initialPhotoRecipe, photoRecipeUnchanged, validatePhotoRecipe } from './photo-editor';
import { applyPhotoFilterBlock, PHOTO_FILTERS, validatePhotoFilter, type PhotoFilter } from './photo-editor-filters';

describe('independent color preset', () => {
  it.each([
    ['none', [100, 150, 200]], ['warm', [110, 151, 184]], ['cool', [92, 151, 214]],
    ['monochrome', [143, 143, 143]], ['sepia', [192, 171, 134]], ['faded', [114, 152, 188]],
  ] as const)('%s has a fixed RGB result and preserves every alpha byte', (filter, expected) => {
    const input = new Uint8ClampedArray([100, 150, 200, 255, 100, 150, 200, 127, 7, 9, 11, 0]);
    applyPhotoFilterBlock(input, filter);
    expect([...input]).toEqual([...expected, 255, ...expected, 127, 7, 9, 11, 0]);
  });
  it('clips highlights and dark channel offsets after rounding and permits empty inputs', () => {
    const warm = new Uint8ClampedArray([255, 255, 0, 1]); applyPhotoFilterBlock(warm, 'warm');
    expect([...warm]).toEqual([255, 255, 0, 1]);
    const sepia = new Uint8ClampedArray([255, 255, 255, 255]); applyPhotoFilterBlock(sepia, 'sepia');
    expect([...sepia]).toEqual([255, 255, 239, 255]);
    expect(() => applyPhotoFilterBlock(new Uint8ClampedArray(), 'faded')).not.toThrow();
  });
  it.each(PHOTO_FILTERS)('$value gives the same bytes across bounded blocks', ({ value }) => {
    const source = new Uint8ClampedArray(Array.from({ length: 4097 * 4 }, (_, index) => index * 37 % 256));
    const whole = source.slice(), blocks = source.slice(); applyPhotoFilterBlock(whole, value);
    for (let start = 0; start < blocks.length; start += 1024) applyPhotoFilterBlock(blocks, value, start, Math.min(start + 1024, blocks.length));
    expect(blocks).toEqual(whole);
  });
  it.each([[0, [100, 150, 200]], [25, [103, 150, 196]], [50, [105, 151, 192]], [100, [110, 151, 184]]] as const)('%s percent blends the rounded preset with its input and preserves partial/zero alpha', (strength, rgb) => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 127, 7, 9, 11, 0]);
    applyPhotoFilterBlock(pixels, 'warm', 0, pixels.length, strength);
    expect([...pixels]).toEqual([...rgb, 127, 7, 9, 11, 0]);
  });
  it('clips the preset before blending, and none ignores a nonzero strength', () => {
    const pixels = new Uint8ClampedArray([250, 1, 0, 255]); applyPhotoFilterBlock(pixels, 'warm', 0, pixels.length, 50);
    expect([...pixels]).toEqual([253, 2, 0, 255]);
    const unchanged = pixels.slice(); applyPhotoFilterBlock(pixels, 'none', 0, pixels.length, 37); expect(pixels).toEqual(unchanged);
    expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), filter: 'warm', filterStrength: 0 })).toBe(true);
    expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), filterStrength: 38 })).toBe(true);
    expect(photoRecipeUnchanged({ ...initialPhotoRecipe(), filter: 'warm', filterStrength: 0, brightness: 1 })).toBe(false);
  });
  it.each([-1, 101, .5, NaN, Infinity, undefined, null])('rejects an invalid recipe strength %j', filterStrength => {
    expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), filterStrength: filterStrength as number })).toThrow();
  });
  it('a preset is an edit, while returning to none restores the unchanged recipe without clearing other fields', () => {
    const initial = initialPhotoRecipe();
    expect(initial.filter).toBe('none'); expect(photoRecipeUnchanged(initial)).toBe(true);
    for (const { value } of PHOTO_FILTERS.filter(filter => filter.value !== 'none')) expect(photoRecipeUnchanged({ ...initial, filter: value })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, filter: 'none', brightness: 1 })).toBe(false);
    expect(photoRecipeUnchanged({ ...initial, filter: 'none' })).toBe(true);
  });
  it.each(['unknown', '', null, undefined, 1])('rejects unsupported filters %j at the recipe and calculation boundary', value => {
    expect(() => validatePhotoFilter(value as PhotoFilter)).toThrow('필터');
    expect(() => validatePhotoRecipe({ ...initialPhotoRecipe(), filter: value as PhotoFilter })).toThrow('필터');
    expect(() => applyPhotoFilterBlock(new Uint8ClampedArray(4), value as PhotoFilter)).toThrow('필터');
  });
});
