import { describe, expect, it } from 'vitest';
import { defaultHomeBlockKeys, HOME_FIXED_BLOCK_KEYS, isHomeBlockKey, parseHomeLayoutBlocks, readPublicHomeLayoutOrder, resolveHomeLayoutBlocks } from './home-layout';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
describe('home layout contract', () => {
  it('positions each free-product collection independently and preserves its hidden state', () => {
    const key = `products:${first}` as const;
    const saved = [{ key, enabled: false }, ...resolveHomeLayoutBlocks(null, [])];
    expect(parseHomeLayoutBlocks(saved)).toEqual(saved);
    expect(resolveHomeLayoutBlocks(saved, [], [key])[0]).toEqual({ key, enabled: false });
    expect(readPublicHomeLayoutOrder([key, `mosaic:${second}`])).toEqual([key, `mosaic:${second}`]);
  });
  it('uses the X SQUARE order until configuration exists: new arrivals and strip first, collections before campaigns', () => {
    expect(resolveHomeLayoutBlocks(null, [first, second]).map((row) => row.key)).toEqual([
      'hero', 'editor_picks', 'new_arrivals', 'strip_banner', `band:${first}`, `band:${second}`, 'category_best', 'popular', 'benefits', 'stories',
    ]);
    const collectionA = `products:${first}` as const;
    const collectionB = `products:${second}` as const;
    const mosaic = `mosaic:${first}` as const;
    const sales = `sales:${first}` as const;
    expect(defaultHomeBlockKeys([second], [sales, collectionB, mosaic, collectionA])).toEqual([
      'hero', 'editor_picks', 'new_arrivals', 'strip_banner', collectionB, collectionA, `band:${second}`,
      'category_best', 'popular', 'benefits', sales, mosaic, 'stories',
    ]);
  });

  it('preserves hidden blocks, removes stale campaigns and appends new campaigns', () => {
    const saved = resolveHomeLayoutBlocks(null, [first]).reverse().map((row) => ({ ...row, enabled: row.key !== 'hero' }));
    const next = resolveHomeLayoutBlocks(saved, [second]);
    expect(next.map((row) => row.key)).toEqual(['stories', 'benefits', 'popular', 'category_best', 'strip_banner', 'new_arrivals', 'editor_picks', 'hero', `band:${second}`]);
    expect(next.find((row) => row.key === 'hero')?.enabled).toBe(false);
  });

  it('requires each fixed block once and rejects unknown or extra metadata on save', () => {
    const valid = resolveHomeLayoutBlocks(null, [first]);
    expect(parseHomeLayoutBlocks(valid)).toEqual(valid);
    for (const invalid of [null, {}, [], valid.slice(1), [...valid, valid[0]], [...valid, { key: 'footer', enabled: true }], valid.map((row, i) => i === 0 ? { ...row, enabled: 'yes' } : row), valid.map((row, i) => i === 0 ? { ...row, operationId: 'secret' } : row)]) {
      expect(parseHomeLayoutBlocks(invalid)).toBeNull();
    }
  });

  it('keeps explicit all-hidden order empty and accepts only public render keys', () => {
    expect(readPublicHomeLayoutOrder(null)).toBeNull();
    expect(readPublicHomeLayoutOrder([])).toEqual([]);
    expect(readPublicHomeLayoutOrder(['popular', `band:${first}`, 'hidden_admin_notes', { revision: 5 }, 'popular'])).toEqual(['popular', `band:${first}`]);
    expect(defaultHomeBlockKeys([])).toHaveLength(8);
  });

  it('keeps the two new fixed blocks optional so layouts saved before them stay valid', () => {
    expect(HOME_FIXED_BLOCK_KEYS).toEqual(expect.arrayContaining(['stories', 'new_arrivals', 'strip_banner']));
    expect(isHomeBlockKey('new_arrivals')).toBe(true);
    expect(isHomeBlockKey('strip_banner')).toBe(true);
    expect(isHomeBlockKey('strip-banner')).toBe(false);
    const original = ['hero', 'editor_picks', 'category_best', 'popular', 'benefits'].map((key) => ({ key, enabled: true }));
    expect(parseHomeLayoutBlocks(original)).toEqual(original);
    const withNew = [...original, { key: 'new_arrivals', enabled: false }, { key: 'strip_banner', enabled: true }];
    expect(parseHomeLayoutBlocks(withNew)).toEqual(withNew);
    expect(parseHomeLayoutBlocks([...original, { key: 'new_arrivals', enabled: true }, { key: 'new_arrivals', enabled: true }])).toBeNull();
    expect(readPublicHomeLayoutOrder(['new_arrivals', 'hero', 'strip_banner'])).toEqual(['new_arrivals', 'hero', 'strip_banner']);
  });

  it('appends the new fixed blocks, hidden state intact, to a layout saved without them', () => {
    const saved = [
      ...['hero', 'editor_picks', 'category_best', 'popular', 'benefits', 'stories'].map((key) => ({ key, enabled: true })),
    ] as ReturnType<typeof resolveHomeLayoutBlocks>;
    expect(resolveHomeLayoutBlocks(saved, []).map((row) => row.key).slice(-2)).toEqual(['new_arrivals', 'strip_banner']);
    const hidden = [...saved, { key: 'strip_banner' as const, enabled: false }];
    expect(resolveHomeLayoutBlocks(hidden, []).find((row) => row.key === 'strip_banner')).toEqual({ key: 'strip_banner', enabled: false });
  });
});
