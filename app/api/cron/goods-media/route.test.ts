import { beforeEach, describe, expect, it, vi } from 'vitest';
const { cleanup, digital } = vi.hoisted(() => ({ cleanup: vi.fn(), digital: vi.fn() }));
vi.mock('@/lib/admin/digital-assets.server', () => ({ cleanupDigitalAssets: digital }));
vi.mock('@/lib/admin/goods-media.server', () => ({ cleanupGoodsMediaUploads: cleanup }));
import { GET } from './route';
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-test-secret'); cleanup.mockReset(); digital.mockReset().mockResolvedValue({ candidates: 0, completed: 0 }); });
describe('goods video cleanup cron', () => {
  it('requires the exact bearer before any cleanup', async () => {
    for (const value of ['', 'Bearer synthetic-test-secreu', 'synthetic-test-secret']) expect((await GET(new Request('https://example.test/api/cron/goods-media', { headers: { authorization: value } }))).status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('reports a partial cleanup as failed and successful deletion receipts as completed', async () => {
    const request = () => new Request('https://example.test/api/cron/goods-media', { headers: { authorization: 'Bearer synthetic-test-secret' } });
    cleanup.mockResolvedValueOnce({ candidates: 2, completed: 1 }); expect((await GET(request())).status).toBe(503);
    cleanup.mockResolvedValueOnce({ candidates: 2, completed: 2 }); const response = await GET(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, completed: 2 });
  });
});
