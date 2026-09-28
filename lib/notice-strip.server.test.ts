import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveNoticeStrip } from './notice-strip.server';

const mocks = vi.hoisted(() => ({
  href: '/ip/old-ip?tab=goods#detail',
  published: true,
  createServerClient: vi.fn(),
  cookieClient: vi.fn(() => { throw new Error('notice strip must not read cookies'); }),
  cache: vi.fn((fn: unknown) => fn),
}));
vi.mock('next/cache', () => ({ unstable_cache: mocks.cache }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieClient }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true, url: 'https://preview.example.test', key: 'test-public-key' }) }));

beforeEach(() => {
  mocks.href = '/ip/old-ip?tab=goods#detail';
  mocks.published = true;
  mocks.cookieClient.mockClear();
  mocks.createServerClient.mockReset().mockImplementation(() => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters[column] = value; return query; },
        lte: () => query, or: () => query, order: () => query,
        limit: async () => ({ error: null, data: [{ id: 'strip', title: '공지',
          image_path: 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp', link_path: mocks.href, payload: null }] }),
        maybeSingle: async () => ({ error: null, data: table === 'ip_public_slug_aliases'
          ? { slug: 'old-ip', ip_id: 'internal-ip' }
          : filters.id === 'internal-ip' || filters.public_slug === 'current-ip'
            ? { id: 'internal-ip', public_slug: 'current-ip', archived_at: null, published_at: mocks.published ? '2026-09-01' : null }
            : null }),
      };
      return query;
    },
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.test/${path}` } }) }) },
  }));
});

describe('cached public notice strip', () => {
  it.each(['/ip/old-ip?tab=goods#detail', '/ip?ip=internal-ip&tab=goods#detail'])(
    'uses the current IP address without reading request cookies: %s', async (href) => {
      mocks.href = href;
      expect((await getActiveNoticeStrip())?.href).toBe('/ip/current-ip?tab=goods#detail');
      expect(mocks.cookieClient).not.toHaveBeenCalled();
      expect(mocks.cache).toHaveBeenCalledWith(expect.any(Function), ['home-notice-strip'], { revalidate: 300, tags: ['home-curations'] });
    },
  );
  it('does not resolve an unpublished target or change a reserved popup URL', async () => {
    mocks.published = false;
    expect((await getActiveNoticeStrip())?.href).toBe(mocks.href);
    mocks.href = '/ip/aouad';
    expect((await getActiveNoticeStrip())?.href).toBe('/ip/aouad');
    expect(mocks.cookieClient).not.toHaveBeenCalled();
  });
});
