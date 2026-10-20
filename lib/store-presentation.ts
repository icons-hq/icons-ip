export const STORE_PRESENTATION_PATH = '/admin/display/settings';
export const STORE_PRESENTATION_CACHE_TAG = 'store-presentation';
export const STORE_THEME_COLORS = ['#78bb53', '#292b2c', '#666668', '#6b90dc', '#654f43', '#72d887', '#20c5b0', '#ff9dc5', '#fc5296', '#e96061', '#ee4a44', '#af7de7', '#fcdf33', '#f79a49', '#eae1d8'] as const;
export interface StoreCommonPresentation { themeColor: string; headerStyle: 'basic' | 'color'; showHomeSearch: boolean }
export interface StoreListingPresentation { imageShape: 'square' | 'portrait'; imageMode: 'primary' | 'gallery'; showColors: boolean; showDescription: boolean; showCart: boolean; showTags: boolean }
export interface StorePresentation { common: StoreCommonPresentation; listing: StoreListingPresentation }
export type StorePresentationSection = keyof StorePresentation;
export interface StorePresentationSnapshot { values: StorePresentation; revisions: Record<StorePresentationSection, number> }
export const DEFAULT_STORE_PRESENTATION: StorePresentation = {
  common: { themeColor: '#78bb53', headerStyle: 'basic', showHomeSearch: false },
  listing: { imageShape: 'square', imageMode: 'primary', showColors: false, showDescription: true, showCart: false, showTags: true },
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function parseStorePresentationSection<K extends StorePresentationSection>(section: K, value: unknown): StorePresentation[K] | null {
  if (!record(value)) return null;
  if (section === 'common') return exact(value, ['themeColor', 'headerStyle', 'showHomeSearch'])
    && STORE_THEME_COLORS.includes(value.themeColor as typeof STORE_THEME_COLORS[number]) && ['basic', 'color'].includes(String(value.headerStyle))
    && typeof value.showHomeSearch === 'boolean' ? { ...value } as unknown as StorePresentation[K] : null;
  if (section !== 'listing') return null;
  return exact(value, ['imageShape', 'imageMode', 'showColors', 'showDescription', 'showCart', 'showTags'])
    && ['square', 'portrait'].includes(String(value.imageShape)) && ['primary', 'gallery'].includes(String(value.imageMode))
    && ['showColors', 'showDescription', 'showCart', 'showTags'].every(key => typeof value[key] === 'boolean') ? { ...value } as unknown as StorePresentation[K] : null;
}
export function parseStorePresentation(value: unknown): StorePresentation | null {
  if (!record(value) || !exact(value, ['common', 'listing'])) return null;
  const common = parseStorePresentationSection('common', value.common), listing = parseStorePresentationSection('listing', value.listing);
  return common && listing ? { common, listing } : null;
}
export function parseStorePresentationSnapshot(value: unknown): StorePresentationSnapshot | null {
  if (!record(value) || !record(value.revisions)) return null;
  const values = parseStorePresentation(value.values), revisions = value.revisions;
  return values && ['common', 'listing'].every(key => Number.isSafeInteger(revisions[key]) && Number(revisions[key]) >= 0)
    ? { values, revisions: revisions as StorePresentationSnapshot['revisions'] } : null;
}
export interface GoodsColorChip { label: string; hex: string }
export interface GoodsListingAppearance { gallery: string[]; description: string; colors: GoodsColorChip[] }
export function parseGoodsColorChips(value: unknown): GoodsColorChip[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const labels = new Set<string>();
  for (const chip of value) {
    if (!record(chip) || !exact(chip, ['label', 'hex']) || typeof chip.label !== 'string' || chip.label !== chip.label.trim()
      || [...chip.label].length < 1 || [...chip.label].length > 30 || /[\u0000-\u001f\u007f]/.test(chip.label)
      || typeof chip.hex !== 'string' || !/^#[0-9a-f]{6}$/.test(chip.hex) || labels.has(chip.label)) return null;
    labels.add(chip.label);
  }
  return value.map(chip => ({ label: chip.label, hex: chip.hex }));
}
/** Choose a legible foreground from the actual preset luminance. */
export function storeThemeForeground(hex: string): '#ffffff' | '#111111' {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#111111' : '#ffffff';
}
