import { describe, expect, it } from 'vitest';
import { DEFAULT_STORE_PRESENTATION, STORE_THEME_COLORS, parseGoodsColorChips, parseStorePresentation, parseStorePresentationSection, parseStorePresentationSnapshot, storeThemeForeground } from './store-presentation';
describe('store presentation boundary', () => {
  it('accepts only exact known fields and preset values', () => {
    expect(parseStorePresentation(DEFAULT_STORE_PRESENTATION)).toEqual(DEFAULT_STORE_PRESENTATION);
    expect(parseStorePresentationSection('common', { ...DEFAULT_STORE_PRESENTATION.common, themeColor: 'url(https://bad)' })).toBeNull();
    expect(parseStorePresentationSection('common', { ...DEFAULT_STORE_PRESENTATION.common, account: 'private' })).toBeNull();
    expect(parseStorePresentationSection('listing', { ...DEFAULT_STORE_PRESENTATION.listing, showCart: 'true' })).toBeNull();
    expect(parseStorePresentationSection('listing', { ...DEFAULT_STORE_PRESENTATION.listing, imageShape: 'wide' })).toBeNull();
    expect(parseStorePresentationSnapshot({ values: DEFAULT_STORE_PRESENTATION, revisions: { common: 4, listing: 0 } })?.revisions.common).toBe(4);
    expect(parseStorePresentationSnapshot({ values: DEFAULT_STORE_PRESENTATION, revisions: { common: -1, listing: 0 } })).toBeNull();
  });
  it('validates explicit colors with unique names, strict hex, controls and maximum count', () => {
    const chip = { label: '크림', hex: '#eae1d8' };
    expect(parseGoodsColorChips([chip])).toEqual([chip]);
    for (const values of [[chip, chip], [{ ...chip, hex: 'red' }], [{ ...chip, label: ' 크림' }], [{ ...chip, label: '크림\n' }], [{ ...chip, extra: true }], Array.from({ length: 21 }, (_, i) => ({ ...chip, label: `색${i}` }))]) expect(parseGoodsColorChips(values)).toBeNull();
    expect(parseGoodsColorChips([])).toEqual([]);
  });
  it('chooses at least AA contrast for every preset foreground', () => {
    const luminance = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    for (const color of STORE_THEME_COLORS) {
      const a = luminance(color), b = luminance(storeThemeForeground(color));
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), color).toBeGreaterThanOrEqual(4.5);
    }
  });
});
