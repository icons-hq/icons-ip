import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { GET } from './route';
const token = 'c'.repeat(32);
const context = { params: Promise.resolve({ token }) };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { source: 'good', targetId: 'item' }, error: null }); });
describe('public marketing redirect', () => {
  it('returns a temporary relative redirect with no cache and an exact fresh resolver call', async () => {
    const response = await GET(new Request(`https://preview.test/m/${token}?utm_source=mail&next=https://evil.test`), context);
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe(`/shop/item?utm_source=mail&icm=${token}`); expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_marketing_link', { p_token: token });
  });
  it('returns 404 without leaking target names and never resolves malformed tokens', async () => {
    expect((await GET(new Request('https://preview.test/m/bad'), { params: Promise.resolve({ token: 'bad' }) })).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null }); const response = await GET(new Request(`https://preview.test/m/${token}`), context); expect(response.status).toBe(404); expect(await response.text()).not.toContain('item');
  });
  it('reports unavailable infrastructure without converting it to a false missing link', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '503' } }); const response = await GET(new Request(`https://preview.test/m/${token}`), context); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
