import { describe, expect, it } from 'vitest';
import { HOME_SALES_PERIODS } from './home-ranking';
import {
  LISTING_SORTS,
  LISTING_SORT_LABELS,
  NEW_DEFAULT_SORT,
  NEW_SORT_TABS,
  SALES_RANKING_PERIODS,
  isListingSort,
  parseListingSortOrders,
  parseSalesRankingIds,
  parseSalesRankingPeriod,
} from './listing-sorts';

describe('listing sort vocabulary', () => {
  it('unifies on seven sorts in the screen order', () => {
    expect(LISTING_SORTS).toEqual(['recommended', 'popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews']);
    expect(LISTING_SORTS.map((sort) => LISTING_SORT_LABELS[sort])).toEqual([
      '추천순', '인기도순', '최신 등록순', '판매량순', '낮은 가격순', '높은 가격순', '리뷰 많은순',
    ]);
    expect(Object.keys(LISTING_SORT_LABELS).sort()).toEqual([...LISTING_SORTS].sort());
  });

  it('drops the name sorts and oldest from the screens', () => {
    for (const legacy of ['name_asc', 'name_desc', 'oldest', 'relevance', '']) {
      expect(isListingSort(legacy), legacy).toBe(false);
    }
    expect(isListingSort('popular')).toBe(true);
    expect(isListingSort(undefined)).toBe(false);
    expect(isListingSort(['popular'])).toBe(false);
  });

  it('keeps the six NEW tabs as the seven sorts without the scope-order sort, defaulting to newest', () => {
    expect(NEW_SORT_TABS).toEqual(['popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews']);
    expect(NEW_SORT_TABS).toEqual(LISTING_SORTS.filter((sort) => sort !== 'recommended'));
    expect(NEW_DEFAULT_SORT).toBe('newest');
    expect(NEW_SORT_TABS).toContain(NEW_DEFAULT_SORT);
  });
});

describe('sales ranking period', () => {
  it('re-exports the home sales periods', () => {
    expect(SALES_RANKING_PERIODS).toBe(HOME_SALES_PERIODS);
    expect([...SALES_RANKING_PERIODS]).toEqual(['realtime', 'daily', 'weekly', 'monthly']);
  });

  it('reads a valid ?period= and falls back to realtime for everything else', () => {
    for (const period of SALES_RANKING_PERIODS) expect(parseSalesRankingPeriod(period)).toBe(period);
    for (const bad of [undefined, null, '', 'yearly', 'Weekly', ' weekly', 3, {}, []]) {
      expect(parseSalesRankingPeriod(bad), String(bad)).toBe('realtime');
    }
  });

  it('uses the first value of a repeated parameter like the other list parameters do', () => {
    expect(parseSalesRankingPeriod(['monthly', 'daily'])).toBe('monthly');
    expect(parseSalesRankingPeriod(['bogus', 'daily'])).toBe('realtime');
  });
});

describe('listing sort order response', () => {
  const orders = { popular: ['b', 'a', 'c'], sales: ['c', 'a', 'b'], reviews: ['a', 'b', 'c'] };

  it('accepts the three id arrays the RPC returns', () => {
    expect(parseListingSortOrders(orders)).toEqual(orders);
    expect(parseListingSortOrders({ popular: [], sales: [], reviews: [] })).toEqual({ popular: [], sales: [], reviews: [] });
  });

  it('tolerates extra keys without carrying them along', () => {
    const parsed = parseListingSortOrders({ ...orders, newcomer: ['x'] });
    expect(parsed).toEqual(orders);
    expect(parsed).not.toHaveProperty('newcomer');
  });

  it('returns null when the response shape is off so callers fall back to scope order', () => {
    for (const bad of [
      null, undefined, 'oops', 7, [], [orders],
      { popular: ['a'], sales: ['a'] },
      { popular: 'a', sales: ['a'], reviews: ['a'] },
      { popular: ['a'], sales: [1], reviews: ['a'] },
      { popular: ['a'], sales: [null], reviews: ['a'] },
      { popular: [''], sales: ['a'], reviews: ['a'] },
      { popular: ['a'], sales: ['a'], reviews: [{ id: 'a', sales: 3 }] },
      { popular: ['a'], sales: ['a'], reviews: ['x'.repeat(201)] },
    ]) {
      expect(parseListingSortOrders(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('does not alias the response arrays', () => {
    const response = { popular: ['a'], sales: ['b'], reviews: ['c'] };
    const parsed = parseListingSortOrders(response)!;
    parsed.popular.push('z');
    expect(response.popular).toEqual(['a']);
  });
});

describe('sales ranking response', () => {
  it('accepts an id array, including an empty period', () => {
    expect(parseSalesRankingIds(['g1', 'g2'])).toEqual(['g1', 'g2']);
    expect(parseSalesRankingIds([])).toEqual([]);
  });

  it('returns null for anything else', () => {
    for (const bad of [null, undefined, {}, 'g1', ['g1', 2], ['g1', null], [['g1']], [''], {}]) {
      expect(parseSalesRankingIds(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
