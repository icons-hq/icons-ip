import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_COLLECTIBLE_KEYS,
  LAST_BELL_PRODUCT_CATALOG,
  LAST_BELL_PRODUCT_BY_KEY,
  isLastBellCollectibleKey,
} from './last-bell-products';

describe('Last Bell product catalog', () => {
  it('keeps ten unique stable keys and chapter placement counts', () => {
    expect(new Set(LAST_BELL_COLLECTIBLE_KEYS).size).toBe(10);
    expect(LAST_BELL_PRODUCT_CATALOG).toHaveLength(10);
    expect(LAST_BELL_PRODUCT_CATALOG.filter((item) => item.chapterId === 'chapter-01')).toHaveLength(8);
    expect(LAST_BELL_PRODUCT_CATALOG.filter((item) => item.chapterId === 'chapter-02')).toHaveLength(2);
    expect(LAST_BELL_PRODUCT_CATALOG.filter((item) => item.discovery === 'detour')).toHaveLength(3);
  });

  it('uses delivery-GLB thumbnail and asset seams for every product', () => {
    for (const item of LAST_BELL_PRODUCT_CATALOG) {
      expect(item.thumbnailPath).toBe(`/generated/last-bell/products/${item.key}/thumbnail.webp`);
      expect(item.assetPath).toBe(`/generated/last-bell/products/${item.key}/model.glb`);
      expect(existsSync(resolve(process.cwd(), 'public', item.assetPath.slice(1)))).toBe(true);
      expect(existsSync(resolve(process.cwd(), 'public', item.thumbnailPath.slice(1)))).toBe(true);
      expect(item.purchaseAccess).toBe('story_entitlement');
      expect(item.previewPriceStatus).toBe('draft');
      expect(item.ipReviewStatus).toBe('pending');
      expect(LAST_BELL_PRODUCT_BY_KEY[item.key]).toBe(item);
      expect(isLastBellCollectibleKey(item.key)).toBe(true);
    }
    expect(isLastBellCollectibleKey('price-or-good-id')).toBe(false);
  });
});
