import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/orders/order-delay-sms.server', () => ({ processOrderDelaySms: mocks.process }));
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); mocks.process.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const request = (secret?: string) => new Request('https://example.test/api/cron/order-delay-sms', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });

describe('예약 일정 변경 안내 SMS cron', () => {
  it.each([undefined, 'wrong'])('인증되지 않은 호출을 작업 전에 거절한다', async (secret) => {
    expect((await GET(request(secret))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('스위치가 꺼져 있으면 정상 응답으로 끝난다', async () => {
    mocks.process.mockResolvedValue({ enabled: false, claimed: 0, sent: 0, failed: 0, skipped: 0, stale: 0 });
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, enabled: false, claimed: 0, sent: 0, failed: 0, skipped: 0, stale: 0 });
  });
  it('실패를 비정상으로 관측하고 받는 사람·문구는 싣지 않는다', async () => {
    mocks.process.mockResolvedValue({ enabled: true, claimed: 3, sent: 1, failed: 1, skipped: 1, stale: 0 });
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ ok: false, enabled: true, claimed: 3, sent: 1, failed: 1, skipped: 1, stale: 0 });
  });
  it('내부 오류의 개인정보를 응답에 싣지 않는다', async () => {
    mocks.process.mockRejectedValue(new Error('+821012345678 private copy'));
    expect(await (await GET(request('synthetic-cron-secret'))).json()).toEqual({ ok: false });
  });
});
