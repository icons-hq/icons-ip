/** Integer basis points keep editor, image and database coordinates identical. */
export interface GoodsRelationHotspot { goodId: string; x: number; y: number }
export interface GoodsRelationVisual { imagePath: string; alt: string; description: string; hotspots: GoodsRelationHotspot[] }
export const RELATION_IMAGE_PATTERN = /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function parseGoodsRelationVisual(value: unknown, goodIds: readonly string[]): GoodsRelationVisual | null | false {
  if (value === undefined || value === null) return null;
  if (!object(value) || !exact(value, ['imagePath', 'alt', 'description', 'hotspots']) || typeof value.imagePath !== 'string' || !RELATION_IMAGE_PATTERN.test(value.imagePath)
    || typeof value.alt !== 'string' || !value.alt.trim() || [...value.alt.trim()].length > 120
    || typeof value.description !== 'string' || [...value.description.trim()].length > 90 || !Array.isArray(value.hotspots) || value.hotspots.length > 5) return false;
  const ids = new Set<string>(); const hotspots: GoodsRelationHotspot[] = [];
  for (const point of value.hotspots) {
    if (!object(point) || !exact(point, ['goodId', 'x', 'y']) || typeof point.goodId !== 'string' || !goodIds.includes(point.goodId) || ids.has(point.goodId)
      || !Number.isSafeInteger(point.x) || Number(point.x) < 0 || Number(point.x) > 10000 || !Number.isSafeInteger(point.y) || Number(point.y) < 0 || Number(point.y) > 10000) return false;
    ids.add(point.goodId); hotspots.push({ goodId: point.goodId, x: point.x as number, y: point.y as number });
  }
  return { imagePath: value.imagePath, alt: value.alt.trim(), description: value.description.trim(), hotspots };
}
export function relationCoordinate(value: number) { return Math.max(0, Math.min(10000, Math.round(value))); }
export function relationPointerCoordinate(point: number, origin: number, length: number) { return length > 0 ? relationCoordinate((point - origin) / length * 10000) : 5000; }
export function relationVisualDraft(): GoodsRelationVisual { return { imagePath: '', alt: '', description: '', hotspots: [] }; }
