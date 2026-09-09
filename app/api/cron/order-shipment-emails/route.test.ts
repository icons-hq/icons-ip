import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ processOrderShipmentEmails: mocks.process }));
const request = (secret?: string) => new Request('https://icons.local/api/cron/order-shipment-emails', {
  headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
});
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'test-secret'); mocks.process.mockReset(); });
describe('shipment email cron', () => {
  it('fails closed when the server secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    expect((await GET(request('test-secret'))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each([undefined, 'wrong-secret'])('requires the exact cron secret before service work', async (secret) => {
    expect((await GET(request(secret))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('reports a bounded batch without cache or customer data', async () => {
    const result = { claimed: 25, completed: 25, retried: 0, review: 0, failed: 0 };
    mocks.process.mockResolvedValue(result);
    const response = await GET(request('test-secret'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toEqual({ ok: true, ...result });
  });
  it('makes retained failures visible to cron monitoring', async () => {
    mocks.process.mockResolvedValue({ claimed: 2, completed: 0, retried: 1, review: 1, failed: 0 });
    expect((await GET(request('test-secret'))).status).toBe(503);
  });
  it('does not expose database or recipient details on failure', async () => {
    mocks.process.mockRejectedValue(new Error('secret@example.test private provider body'));
    const response = await GET(request('test-secret'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
