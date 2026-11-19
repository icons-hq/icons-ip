import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ rpc }) }));
const config = vi.fn();
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => config() }));

import { GET } from './route';

describe('GET /api/health', () => {
  beforeEach(() => {
    rpc.mockReset();
    config.mockReturnValue({ url: 'http://db', key: 'k', isConfigured: true });
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abcdef0123456789');
  });

  it('answers 200 without secrets when the public read works', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ ok: true, database: 'ok', commit: 'abcdef012345' });
    expect(rpc).toHaveBeenCalledWith('get_storefront_settings');
  });

  it('answers 503 without error detail when the database read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'secret detail', code: 'XX000' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it('answers 503 when the client throws or env is missing', async () => {
    rpc.mockRejectedValue(new Error('network'));
    expect((await GET()).status).toBe(503);
    config.mockReturnValue({ isConfigured: false });
    expect((await GET()).status).toBe(503);
  });
});
