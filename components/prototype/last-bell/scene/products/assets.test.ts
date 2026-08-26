import { describe, expect, it } from 'vitest';
import { LAST_BELL_PRODUCT_ASSETS, LAST_BELL_PRODUCT_KEYS } from './assets';

describe('Last Bell collectible authored world placement', () => {
  it('gives all ten products a support-specific transform instead of one floating default', () => {
    expect(LAST_BELL_PRODUCT_KEYS).toHaveLength(10);
    const heights = new Set<number>();
    const supports = new Set<string>();

    for (const key of LAST_BELL_PRODUCT_KEYS) {
      const asset = LAST_BELL_PRODUCT_ASSETS[key];
      expect(asset.worldPlacement.y).toBeGreaterThanOrEqual(0);
      expect(asset.worldPlacement.scale).toBeGreaterThan(0);
      expect(asset.worldPlacement.rotation).toHaveLength(3);
      expect(asset.worldPlacement.rotation.every(Number.isFinite)).toBe(true);
      heights.add(asset.worldPlacement.y);
      supports.add(asset.worldPlacement.support);
    }

    expect(heights.size).toBeGreaterThanOrEqual(6);
    expect([...supports].sort()).toEqual(['board', 'desk', 'floor', 'locker', 'shelf']);
  });

  it('keeps floor finds low and mounted finds above eye-guiding furniture height', () => {
    expect(LAST_BELL_PRODUCT_ASSETS.photo.worldPlacement).toMatchObject({ support: 'floor', y: .08 });
    expect(LAST_BELL_PRODUCT_ASSETS.blanket.worldPlacement).toMatchObject({ support: 'floor', y: .14 });
    expect(LAST_BELL_PRODUCT_ASSETS.badge.worldPlacement.y).toBeGreaterThan(1);
    expect(LAST_BELL_PRODUCT_ASSETS.archery.worldPlacement.y).toBeGreaterThan(1.2);
    expect(LAST_BELL_PRODUCT_ASSETS.postcard.worldPlacement.y).toBeGreaterThan(1.2);
  });
});
