import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/email/stock-safety-digest-jobs.server', () => ({ processStockSafetyDigests: mocks.process }));
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); mocks.process.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const request = (secret?: string) => new Request('https://example.test/api/cron/stock-safety-digest', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });

describe('안전재고 요약 메일 cron', () => {
  it.each([undefined, 'wrong'])('인증되지 않은 호출을 작업 전에 거절한다', async (secret) => {
    expect((await GET(request(secret))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('비밀값이 없으면 어떤 호출도 받지 않는다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request(''))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('대상이 없거나 모두 보낸 틱은 정상이다', async () => {
    mocks.process.mockResolvedValue({ claimed: 0, sent: 0, queued: 0, failed: 0, unknown: 0, suppressed: 0, stale: 0 });
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('일부 실패를 비정상으로 관측하고 수신 주소는 반환하지 않는다', async () => {
    mocks.process.mockResolvedValue({ claimed: 2, sent: 1, queued: 0, failed: 1, unknown: 0, suppressed: 0, stale: 0 });
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, claimed: 2, sent: 1, queued: 0, failed: 1, unknown: 0, suppressed: 0, stale: 0 });
  });
  it('내부 오류의 내용을 응답에 싣지 않는다', async () => {
    mocks.process.mockRejectedValue(new Error('seowon@example.test private copy'));
    expect(await (await GET(request('synthetic-cron-secret'))).json()).toEqual({ ok: false });
  });
});
