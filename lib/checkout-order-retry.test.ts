import { describe, expect, it, vi } from 'vitest';
import { isTransientOrderError, retryTransientOrderErrors } from './checkout-order-retry';

type Result = { data: string | null; error: { message: string; code?: string | null } | null };
const busy = (code = '55P03'): Result => ({ data: null, error: { message: 'canceling statement due to lock timeout', code } });
const ok: Result = { data: 'order-1', error: null };

function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, advance: (ms: number) => { now += ms; }, sleeps };
}

describe('isTransientOrderError', () => {
  it('DB가 주문을 되돌렸거나 요청이 DB에 닿지 않은 오류만 일시 혼잡으로 본다', () => {
    for (const code of ['55P03', '57014', '40P01', '40001', 'PGRST000', 'PGRST003']) expect(isTransientOrderError({ code })).toBe(true);
    for (const code of ['P0001', '23505', 'PT409', 'PGRST202', '', null, undefined]) expect(isTransientOrderError({ code })).toBe(false);
    expect(isTransientOrderError(null)).toBe(false);
  });
});

describe('retryTransientOrderErrors', () => {
  it('혼잡이 풀리면 같은 요청을 다시 보내 성공을 돌려준다', async () => {
    const time = clock();
    const attempt = vi.fn<() => Promise<Result>>().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy('PGRST003')).mockResolvedValueOnce(ok);
    const onRetry = vi.fn();
    expect(await retryTransientOrderErrors(attempt, { ...time, random: () => 0.5, onRetry })).toBe(ok);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(time.sleeps).toEqual([300, 700]);
    expect(onRetry.mock.calls).toEqual([[1, '55P03'], [2, 'PGRST003']]);
  });

  it('일반 거절(재고 부족·쿠폰 등)은 다시 보내지 않는다', async () => {
    const rejected: Result = { data: null, error: { message: 'out of stock', code: 'P0001' } };
    const attempt = vi.fn<() => Promise<Result>>().mockResolvedValue(rejected);
    expect(await retryTransientOrderErrors(attempt, clock())).toBe(rejected);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('재시도 횟수를 다 쓰면 마지막 혼잡 오류를 그대로 돌려준다', async () => {
    const time = clock();
    const attempt = vi.fn<() => Promise<Result>>().mockResolvedValue(busy());
    const result = await retryTransientOrderErrors(attempt, { ...time, random: () => 0.5, budgetMs: 60_000 });
    expect(result.error?.code).toBe('55P03');
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(time.sleeps).toEqual([300, 700, 1_500, 2_500, 3_500]);
  });

  it('잠금 대기로 시간이 흘러 예산을 넘기면 더 기다리지 않는다', async () => {
    const time = clock();
    const attempt = vi.fn<() => Promise<Result>>(async () => { time.advance(8_000); return busy(); });
    await retryTransientOrderErrors(attempt, { ...time, random: () => 0.5, budgetMs: 25_000 });
    /* 8초·8초·8초를 기다린 뒤에는 다음 기다림이 예산(25초)을 넘는다. */
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('재시도 기다림을 0.5~1.5배로 흩는다', async () => {
    const low = clock();
    await retryTransientOrderErrors(vi.fn<() => Promise<Result>>().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok), { ...low, random: () => 0 });
    const high = clock();
    await retryTransientOrderErrors(vi.fn<() => Promise<Result>>().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok), { ...high, random: () => 0.999 });
    expect(low.sleeps).toEqual([150]);
    expect(high.sleeps).toEqual([450]);
  });
});
