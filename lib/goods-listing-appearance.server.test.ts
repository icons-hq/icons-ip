import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeListingEntities, loadGoodsListingAppearance } from './goods-listing-appearance.server';
describe('listing metadata projection', () => {
  it('keeps a bounded requested-ID projection and rejects CSS/path injection', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    const rpc = vi.fn(async () => ({ data: [
      { id: 'good', description: 'A &amp; B', descriptionFormat: 'html', colors: [{ label: '흰색', hex: '#ffffff' }], galleryPaths: ['public-media/catalog/good/87000000-0000-4000-8000-000000000001.webp', 'public-media/catalog/good/87000000-0000-4000-8000-000000000001.webp', 'https://bad/a.webp', 'goods/../../a.webp', 'goods/a").webp'] },
      { id: 'private', description: 'secret', descriptionFormat: 'plain', colors: [], galleryPaths: [] },
    ], error: null }));
    const result = await loadGoodsListingAppearance({ rpc } as unknown as SupabaseClient, ['good']);
    expect([...result.keys()]).toEqual(['good']); expect(result.get('good')?.gallery).toHaveLength(1); expect(result.get('good')?.description).toBe('A & B');
    vi.unstubAllEnvs();
  });
  it('batches large requested sets and tolerates unavailable optional metadata', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'network' } }));
    expect((await loadGoodsListingAppearance({ rpc } as unknown as SupabaseClient, Array.from({ length: 1001 }, (_, i) => `g-${i}`))).size).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[0]).toEqual(['get_goods_listing_appearance', { p_good_ids: Array.from({ length: 1000 }, (_, i) => `g-${i}`) }]);
  });
  it('decodes once as text and removes numeric controls', () => {
    expect(decodeListingEntities('&amp;lt; &#x41; &#10; &lt;tag&gt;')).toBe('&lt; A  <tag>');
  });
  it('preserves literal entity text in a plain description', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 'good', description: 'A &amp; B', descriptionFormat: 'plain', colors: [], galleryPaths: [] }], error: null }));
    expect((await loadGoodsListingAppearance({ rpc } as unknown as SupabaseClient, ['good'])).get('good')?.description).toBe('A &amp; B');
  });
});
