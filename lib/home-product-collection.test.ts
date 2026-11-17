import { describe, expect, it } from 'vitest';
import { buildHomeProductCollectionBand, collectionMoreHref, homeProductCountRange, isHomeProductCollectionTitle, isHomeProductLayout, parseHomeProductCollectionPayload } from './home-product-collection';
import type { HomeGoodsCard } from './home-catalog';

const payload = { layout: 'list' as const, image_shape: 'square' as const, item_count: 3, good_ids: ['missing', 'g2', 'g1', 'g3', 'g4'] };
const card = (id: string): HomeGoodsCard => ({ id, name: id, href: `/shop/${id}`, brand: null, price: 1000, badge: null, imageBg: '', soldOut: id === 'g2' });

describe('home product collection contract', () => {
  it('keeps 100 ordered candidates independent from the public display count', () => {
    const good_ids = Array.from({ length: 100 }, (_, index) => `g-${index}`);
    const result = parseHomeProductCollectionPayload({ ...payload, good_ids });
    expect(result?.good_ids).toEqual(good_ids);
    expect(result?.good_ids).not.toBe(good_ids);
    expect(parseHomeProductCollectionPayload({ ...payload, good_ids: [...good_ids, 'extra'] })).toBeNull();
  });

  it('uses the source ranges for list and full-image without erasing the pool', () => {
    for (const count of [3, 12]) expect(parseHomeProductCollectionPayload({ ...payload, item_count: count })).not.toBeNull();
    for (const count of [1, 8]) expect(parseHomeProductCollectionPayload({ ...payload, layout: 'full_image', item_count: count })).not.toBeNull();
    for (const value of [{ ...payload, item_count: 2 }, { ...payload, item_count: 13 }, { ...payload, layout: 'full_image', item_count: 9 }, { ...payload, item_count: 3.5 }]) {
      expect(parseHomeProductCollectionPayload(value)).toBeNull();
    }
  });

  it('rejects duplicate, malformed, null and unknown configuration instead of guessing', () => {
    for (const value of [null, {}, { ...payload, layout: 'mosaic' }, { ...payload, image_shape: 'auto' }, { ...payload, extra: true },
      { ...payload, item_count: '3' }, { ...payload, good_ids: ['g1', 'g1'] }, { ...payload, good_ids: [null] }, { ...payload, good_ids: ['/shop/g1'] }]) {
      expect(parseHomeProductCollectionPayload(value)).toBeNull();
    }
  });

  it('fills past missing products and preserves selected order, sold-out and zero-sales products', () => {
    const goods = ['g1', 'g2', 'g3', 'g4'].map(card);
    expect(buildHomeProductCollectionBand('module', '추천', payload, goods).goods).toEqual([goods[1], goods[0], goods[2]]);
    expect(payload.good_ids).toEqual(['missing', 'g2', 'g1', 'g3', 'g4']);
  });

  it('accepts empty candidates and returns only available products when fewer than the display count remain', () => {
    expect(parseHomeProductCollectionPayload({ ...payload, good_ids: [] })).not.toBeNull();
    expect(buildHomeProductCollectionBand('module', '추천', payload, [card('g1')]).goods.map(good => good.id)).toEqual(['g1']);
    expect(buildHomeProductCollectionBand('module', '추천', payload, []).goods).toEqual([]);
  });

  it('counts title code points and rejects empty/control text', () => {
    expect(isHomeProductCollectionTitle('😀'.repeat(15))).toBe(true);
    for (const value of ['', ' 가 ', '😀'.repeat(16), '가\n나', '가\u0085나']) expect(isHomeProductCollectionTitle(value)).toBe(false);
  });

  describe('grid layout (X SQUARE IP product section)', () => {
    const grid = { layout: 'grid' as const, image_shape: 'square' as const, item_count: 5, good_ids: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'] };

    it('is a layout whose count range is 5..10 but accepts only 5 or 10', () => {
      expect(isHomeProductLayout('grid')).toBe(true);
      expect(homeProductCountRange('grid')).toEqual([5, 10]);
      expect(homeProductCountRange('list')).toEqual([3, 12]);
      expect(homeProductCountRange('full_image')).toEqual([1, 8]);
      for (const count of [5, 10]) expect(parseHomeProductCollectionPayload({ ...grid, item_count: count })).not.toBeNull();
      for (const count of [4, 6, 7, 9, 11, 3.5]) expect(parseHomeProductCollectionPayload({ ...grid, item_count: count })).toBeNull();
    });

    it('forces square images, matching the database rule, and leaves list and full-image shapes alone', () => {
      expect(parseHomeProductCollectionPayload({ ...grid, image_shape: 'portrait' })).toBeNull();
      expect(parseHomeProductCollectionPayload({ ...grid, image_shape: 'landscape' })).toBeNull();
      expect(parseHomeProductCollectionPayload({ ...payload, image_shape: 'portrait' })).not.toBeNull();
      expect(parseHomeProductCollectionPayload({ ...payload, layout: 'full_image', item_count: 4, image_shape: 'landscape' })).not.toBeNull();
    });

    const cardOf = (id: string, ipHref: string | null | undefined): HomeGoodsCard => ({ ...card(id), ...(ipHref === undefined ? {} : { ipHref }) });

    it('links "전체보기" to the IP hall only when every shown product shares one IP', () => {
      const same = ['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => cardOf(id, '/ip/hongsil'));
      expect(buildHomeProductCollectionBand('module', '홍실퀘스트', grid, same).moreHref).toBe('/ip/hongsil');
      const mixed = [...same.slice(0, 4), cardOf('g5', '/ip/maple')];
      expect(buildHomeProductCollectionBand('module', '혼합', grid, mixed).moreHref).toBeNull();
      expect(buildHomeProductCollectionBand('module', '없음', grid, []).moreHref).toBeNull();
    });

    it('does not link when a shown product has no IP address, and a hidden product does not break a one-IP set', () => {
      expect(collectionMoreHref([])).toBeNull();
      expect(collectionMoreHref([cardOf('a', '/ip/x'), cardOf('b', null)])).toBeNull();
      expect(collectionMoreHref([cardOf('a', undefined)])).toBeNull();
      expect(collectionMoreHref([cardOf('a', '/ip/x'), cardOf('b', '/ip/x')])).toBe('/ip/x');
      const goods = ['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => cardOf(id, '/ip/hongsil'));
      // g6 is not in the public set (hidden) — the 5 shown products still share the IP.
      expect(buildHomeProductCollectionBand('module', '홍실', grid, goods).moreHref).toBe('/ip/hongsil');
    });

    it('only the grid layout carries a link; list and full-image sections never do', () => {
      const goods = ['g1', 'g2', 'g3'].map((id) => cardOf(id, '/ip/hongsil'));
      expect(buildHomeProductCollectionBand('module', '목록', payload, goods)).not.toHaveProperty('moreHref');
      expect(buildHomeProductCollectionBand('module', '풀', { ...payload, layout: 'full_image' }, goods)).not.toHaveProperty('moreHref');
    });
  });
});
