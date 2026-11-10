import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_GOOD_FILTERS, storyGoodSelectionCapacity, validStoryGoodFilters } from './shopping-story-picker';
describe('shopping story goods search contract', () => {
  it('accepts explicit zero-price limits and supported precise ratings', () => {
    expect(validStoryGoodFilters({ ...DEFAULT_STORY_GOOD_FILTERS, minPrice: 0, maxPrice: 0, minRating: 4.5, discounted: true })).toBe(true);
  });
  it('rejects forged keys, coercible strings, invalid categories and reversed price ranges', () => {
    for (const patch of [{ sort: 'revenue' }, { freeShipping: 'true' }, { minRating: '4' }, { minRating: 4.1 }, { categoryId: 'bad' }, { minPrice: 4, maxPrice: 3 }, { minPrice: 1.5 }, { minPrice: -1 }, { minPrice: 100000001 }, { hidden: true }]) expect(validStoryGoodFilters({ ...DEFAULT_STORY_GOOD_FILTERS, ...patch })).toBe(false);
  });
  it('enforces the remaining section and global allowance without double-counting existing IDs', () => {
    expect(storyGoodSelectionCapacity(['one', 'one'], 199)).toBe(1);
    expect(storyGoodSelectionCapacity(Array.from({ length: 299 }, (_, index) => String(index)), 20)).toBe(1);
    expect(storyGoodSelectionCapacity([], 200)).toBe(0);
  });
});
