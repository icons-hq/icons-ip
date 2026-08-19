import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
}));

vi.mock('@/lib/payments/bank-deposit-feed.server', () => ({
  ingestBankDeposits: mocks.ingest,
}));

function request(secret?: string) {
  return new Request('https://icons.local/api/cron/bank-deposits', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

describe('GET /api/cron/bank-deposits', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret-value');
    mocks.ingest.mockReset();
    mocks.ingest.mockResolvedValue({ fetched: 3, inserted: 2, source: 'fake' });
  });

  it.each([
    ['missing server secret', undefined, 'test-cron-secret-value'],
    ['missing authorization', 'test-cron-secret-value', undefined],
    ['mismatched authorization', 'test-cron-secret-value', 'wrong-secret-value'],
  ])('%s 는 수집을 시작하기 전에 거절한다', async (_label, serverSecret, headerSecret) => {
    vi.stubEnv('CRON_SECRET', serverSecret);

    const response = await GET(request(headerSecret));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('수집 결과를 그대로 돌려준다', async () => {
    const response = await GET(request('test-cron-secret-value'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      configured: true,
      fetched: 3,
      inserted: 2,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  /*
   * 계약(#255) 전 상태다. 어댑터가 없다고 실패로 알리면 스케줄러가 매번 재시도하고
   * 알람이 울린다 — 아직 붙일 provider가 없다는 사실은 장애가 아니다.
   */
  it('어댑터가 없으면 실패가 아니라 미설정으로 알린다', async () => {
    mocks.ingest.mockResolvedValue(null);

    const response = await GET(request('test-cron-secret-value'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, configured: false });
  });

  /* 적재 실패는 재시도해야 한다. 재수집은 유일 제약 덕에 안전하다. */
  it('적재가 실패하면 503으로 재시도를 요청한다', async () => {
    mocks.ingest.mockRejectedValue(new Error('boom'));

    const response = await GET(request('test-cron-secret-value'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
