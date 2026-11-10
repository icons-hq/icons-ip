import { describe, expect, it } from 'vitest';
import { defaultHomeBlockKeys, parseHomeLayoutBlocks, readPublicHomeLayoutOrder, resolveHomeLayoutBlocks } from './home-layout';

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
  it('keeps the old full order until configuration exists', () => {
    expect(resolveHomeLayoutBlocks(null, [first, second]).map((row) => row.key)).toEqual([
      'hero', 'editor_picks', 'category_best', `band:${first}`, `band:${second}`, 'popular', 'benefits', 'stories',
    ]);
  });

  it('preserves hidden blocks, removes stale campaigns and appends new campaigns', () => {
    const saved = resolveHomeLayoutBlocks(null, [first]).reverse().map((row) => ({ ...row, enabled: row.key !== 'hero' }));
    const next = resolveHomeLayoutBlocks(saved, [second]);
    expect(next.map((row) => row.key)).toEqual(['stories', 'benefits', 'popular', 'category_best', 'editor_picks', 'hero', `band:${second}`]);
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
    expect(defaultHomeBlockKeys([])).toHaveLength(6);
  });
});
