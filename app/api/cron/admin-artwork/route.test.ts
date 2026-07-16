import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
}));

vi.mock('@/lib/admin/artwork.server', () => ({
  cleanupExpiredAdminArtworkUploads: mocks.cleanup,
}));

function request(secret?: string) {
  return new Request('https://icons.local/api/cron/admin-artwork', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('GET /api/cron/admin-artwork', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-value');
    mocks.cleanup.mockReset();
    mocks.cleanup.mockResolvedValue({ candidates: 2, completed: 2 });
  });

  it.each([
    ['missing server secret', undefined, 'test-cron-secret-value'],
    ['missing authorization', 'test-cron-secret-value', undefined],
    ['mismatched authorization', 'test-cron-secret-value', 'wrong-secret-value'],
  ])('rejects %s before service cleanup', async (_label, serverSecret, headerSecret) => {
    vi.stubEnv('CRON_SECRET', serverSecret);

    const response = await GET(request(headerSecret));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it('runs bounded cleanup with an exact bearer secret', async () => {
    const response = await GET(request('test-cron-secret-value'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      candidates: 2,
      completed: 2,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    ['candidate listing failure', null],
    ['partial cleanup failure', { candidates: 2, completed: 1 }],
  ])('returns 503 for %s without provider details', async (_label, cleanupResult) => {
    mocks.cleanup.mockResolvedValue(cleanupResult);

    const response = await GET(request('test-cron-secret-value'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
