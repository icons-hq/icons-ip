import { describe, expect, it } from 'vitest';
import { parseGoodsRelationVisual, relationCoordinate, relationPointerCoordinate } from './good-relation-visual';
const visual = { imagePath: 'public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp', alt: ' 책상 위의 굿즈 ', description: ' 함께 꾸민 공간 ', hotspots: [{ goodId: 'good-a', x: 0, y: 10000 }] };
describe('relation image coordinate contract', () => {
  it('preserves source-edge coordinates and normalizes human-readable descriptions', () => {
    expect(parseGoodsRelationVisual(visual, ['good-a'])).toEqual({ ...visual, alt: '책상 위의 굿즈', description: '함께 꾸민 공간' });
    expect(parseGoodsRelationVisual({ ...visual, hotspots: [] }, ['good-a'])).not.toBe(false);
    expect(parseGoodsRelationVisual(null, ['good-a'])).toBeNull();
  });
  it('rejects untrusted images, out-of-bounds/duplicate/orphan points and unexpected fields', () => {
    for (const patch of [{ imagePath: 'https://outside.test/picture.png' }, { alt: ' ' }, { description: '가'.repeat(91) }, { hotspots: [{ goodId: 'missing', x: 1, y: 1 }] },
      { hotspots: [{ goodId: 'good-a', x: 10001, y: 1 }] }, { hotspots: [{ goodId: 'good-a', x: -1, y: 1 }] }, { hotspots: [{ goodId: 'good-a', x: 1.1, y: 1 }] },
      { hotspots: [...visual.hotspots, ...visual.hotspots] }, { imageWidth: 100 }]) expect(parseGoodsRelationVisual({ ...visual, ...patch }, ['good-a'])).toBe(false);
  });
  it('uses the image rectangle rather than viewport pixels and clamps dragging beyond its edges', () => {
    expect(relationPointerCoordinate(175, 100, 300)).toBe(2500);
    expect(relationPointerCoordinate(90, 100, 300)).toBe(0);
    expect(relationPointerCoordinate(900, 100, 300)).toBe(10000);
    expect(relationPointerCoordinate(0, 0, 0)).toBe(5000);
    expect(relationCoordinate(1250.49)).toBe(1250);
  });
});
