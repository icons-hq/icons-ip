import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('./cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: vi.fn() }));

import { retryVirtualAccountRefund, type VirtualAccountRefundRetryDependencies } from './virtual-account-refund-retry.server';

const REQUEST_ID = '9c140000-0000-4000-8000-000000000104';

function dependencies(outcome: Awaited<ReturnType<VirtualAccountRefundRetryDependencies['begin']>>) {
  const tasks: (() => Promise<void>)[] = [];
  const deps = {
    begin: vi.fn(async () => outcome),
    schedule: vi.fn((task: () => Promise<void>) => { tasks.push(task); }),
    reconcile: vi.fn(async () => ({ ok: true })),
  };
  return { deps, tasks };
}

describe('retryVirtualAccountRefund', () => {
  it('DB가 처리 중으로 되돌리면 응답 뒤에 시스템 actor로 환불을 다시 시도한다', async () => {
    const { deps, tasks } = dependencies('started');
    expect(await retryVirtualAccountRefund(REQUEST_ID, deps)).toBe('started');
    expect(deps.begin).toHaveBeenCalledWith(REQUEST_ID);
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(deps.reconcile).toHaveBeenCalledWith(REQUEST_ID);
  });

  it.each(['operator_required', 'account_missing', 'account_invalid', 'not_applicable', 'failed'] as const)('%s면 환불을 부르지 않는다', async (outcome) => {
    const { deps, tasks } = dependencies(outcome);
    expect(await retryVirtualAccountRefund(REQUEST_ID, deps)).toBe(outcome);
    expect(tasks).toHaveLength(0);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('DB 호출이 던지면 실패로 돌려주고 환불을 부르지 않는다', async () => {
    const { deps, tasks } = dependencies('started');
    deps.begin.mockRejectedValueOnce(new Error('down'));
    expect(await retryVirtualAccountRefund(REQUEST_ID, deps)).toBe('failed');
    expect(tasks).toHaveLength(0);
  });

  it('예약된 환불이 던져도 요청을 깨뜨리지 않는다', async () => {
    const { deps, tasks } = dependencies('started');
    deps.reconcile.mockRejectedValueOnce(new Error('provider down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await retryVirtualAccountRefund(REQUEST_ID, deps);
    await expect(tasks[0]!()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
