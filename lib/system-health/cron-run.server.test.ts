import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: (...args: unknown[]) => { mocks.rpc(...args); return { abortSignal: mocks.abortSignal }; } }),
}));

import { cronErrorCode, cronResponseDetail, startCronRun } from './cron-run.server';
import { recordCronJobRun } from './cron-run-recorder.server';

const clock = () => {
  let tick = Date.parse('2026-11-18T03:00:00.000Z');
  return () => new Date((tick += 1500));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('cron 실행 기록', () => {
  it('성공 응답은 그대로 돌려주고 성공으로만 남긴다(알림·오류 로그 없음)', async () => {
    const record = vi.fn().mockResolvedValue({ incident: false });
    const notify = vi.fn();
    const original = Response.json({ ok: true, processed: 3 }, { headers: { 'Cache-Control': 'private, no-store' } });
    const returned = await startCronRun('customer-rewards', { now: clock(), record, notify }).finish(original);

    expect(returned).toBe(original);
    expect(await returned.json()).toEqual({ ok: true, processed: 3 });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      job: 'customer-rewards', label: 'BEST 리뷰 적립금 지급', intervalMinutes: 1,
      startedAt: '2026-11-18T03:00:01.500Z', finishedAt: '2026-11-18T03:00:03.000Z',
      ok: true, statusCode: 200, errorCode: null, detail: {},
    });
    expect(notify).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('5xx 응답은 실패로 남기되 상세에는 숫자·단계 이름만 싣고 새 사건이면 외부 알림 자리를 부른다', async () => {
    const record = vi.fn().mockResolvedValue({ incident: true });
    const notify = vi.fn();
    const original = Response.json({ ok: false, claimed: 4, completed: 3, enabled: true, failedStages: ['record'], recipient: 'buyer@example.test', note: 'secret' }, { status: 503 });
    const returned = await startCronRun('order-shipment-emails', { now: clock(), record, notify }).finish(original);

    expect(returned).toBe(original);
    expect(returned.status).toBe(503);
    expect(record.mock.calls[0][0]).toMatchObject({
      ok: false, statusCode: 503, errorCode: 'unhealthy_result',
      detail: { claimed: 4, completed: 3, enabled: true, failedStages: ['record'] },
    });
    expect(JSON.stringify(record.mock.calls[0][0])).not.toMatch(/buyer@|secret/);
    expect(notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: 'cron_failure', job: 'order-shipment-emails', statusCode: 503, errorCode: 'unhealthy_result',
    }));
    expect(console.error).toHaveBeenCalledWith('[cron] job failed', expect.objectContaining({ job: 'order-shipment-emails', status: 503 }));
    // 응답 본문은 기록 뒤에도 그대로 읽힌다.
    expect((await returned.json()).claimed).toBe(4);
  });

  it('예외는 오류 코드만 남기고(메시지 원문 없음) 받은 실패 응답을 그대로 돌려준다', async () => {
    const record = vi.fn().mockResolvedValue({ incident: false });
    const notify = vi.fn();
    const failure = Response.json({ ok: false, error: 'subscription_work_unavailable' }, { status: 502 });
    const returned = await startCronRun('subscriptions', { now: clock(), record, notify })
      .fail(new Error('connect ECONNREFUSED 10.0.0.1 user=kim@example.test'), failure);

    expect(returned).toBe(failure);
    expect(record.mock.calls[0][0]).toMatchObject({ ok: false, statusCode: 502, errorCode: 'exception:Error', detail: {} });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/ECONNREFUSED|kim@/);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ECONNREFUSED|kim@/);
    expect(notify).not.toHaveBeenCalled();
  });

  it('기록이 실패하거나 throw해도 응답은 그대로이고 로그만 남는다', async () => {
    for (const record of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('down'))]) {
      const original = Response.json({ ok: true });
      await expect(startCronRun('gifts', { now: clock(), record }).finish(original)).resolves.toBe(original);
    }
    expect(console.error).toHaveBeenCalledWith('[cron] run record failed', { job: 'gifts' });
  });

  it('오류 코드는 DB 코드·snake_case 코드·오류 이름만 고른다', () => {
    expect(cronErrorCode({ code: '23505', message: 'duplicate key value (email)=(a@b.c)' })).toBe('db:23505');
    expect(cronErrorCode({ code: 'PGRST301' })).toBe('db:PGRST301');
    expect(cronErrorCode(new Error('gift_expiry_failed'))).toBe('gift_expiry_failed');
    expect(cronErrorCode(new TypeError('Cannot read properties of undefined'))).toBe('exception:TypeError');
    expect(cronErrorCode('boom')).toBe('exception');
    expect(cronErrorCode(null)).toBe('exception');
  });

  it('응답 상세는 맨 위 숫자·참거짓·단계 이름 배열만 고르고 형식이 맞는 error는 오류 코드로 쓴다', () => {
    expect(cronResponseDetail({ ok: false, error: 'subscription_work_unavailable', failed: 2, stages: ['targets', 'complete'], nested: { a: 1 }, email: 'x@y.z' }))
      .toEqual({ errorCode: 'subscription_work_unavailable', detail: { failed: 2, stages: ['targets', 'complete'] } });
    expect(cronResponseDetail({ error: 'Something went wrong!' }).errorCode).toBeNull();
    expect(cronResponseDetail(null)).toEqual({ errorCode: null, detail: {} });
  });
});

describe('기록기', () => {
  it('service_role RPC로 실행 한 번을 남기고 새 사건 여부를 돌려준다', async () => {
    mocks.abortSignal.mockResolvedValue({ data: { recorded: true, incident: true }, error: null });
    await expect(recordCronJobRun({
      job: 'gifts', label: '선물 만료·정리', intervalMinutes: 1, startedAt: '2026-11-18T03:00:00.000Z', finishedAt: '2026-11-18T03:00:02.000Z',
      ok: false, statusCode: 503, errorCode: 'unhealthy_result', detail: { failed: 1 },
    })).resolves.toEqual({ incident: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('service_record_system_job_run', {
      p_job: 'gifts', p_label: '선물 만료·정리', p_expected_interval_minutes: 1,
      p_started_at: '2026-11-18T03:00:00.000Z', p_finished_at: '2026-11-18T03:00:02.000Z',
      p_ok: false, p_status_code: 503, p_error_code: 'unhealthy_result', p_detail: { failed: 1 },
    });
    expect(mocks.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('DB 오류·형식이 틀린 답은 null이다', async () => {
    mocks.abortSignal.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    const input = {
      job: 'gifts', label: '선물 만료·정리', intervalMinutes: 1, startedAt: '2026-11-18T03:00:00.000Z', finishedAt: '2026-11-18T03:00:02.000Z',
      ok: true, statusCode: 200, errorCode: null, detail: {},
    };
    await expect(recordCronJobRun(input)).resolves.toBeNull();
    mocks.abortSignal.mockRejectedValueOnce(new Error('timeout'));
    await expect(recordCronJobRun(input)).resolves.toBeNull();
  });
});
