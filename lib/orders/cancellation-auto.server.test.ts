import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  issueApprovedOrderCancellation,
  type SystemCancellationDependencies,
  type SystemCancellationState,
} from './cancellation-auto.server';

const mocks = vi.hoisted(() => ({
  reconcileOrderCancellation: vi.fn(),
  request: null as Record<string, unknown> | null,
  attempts: [] as Array<Record<string, unknown>>,
  payments: [] as Array<Record<string, unknown>>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock('./cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcileOrderCancellation,
}));

vi.mock('../supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          mocks.filters.push({ table, column, value });
          return query;
        }),
        in: vi.fn((column: string, value: unknown) => {
          mocks.filters.push({ table, column, value });
          return query;
        }),
        order: vi.fn(() => query),
        limit: vi.fn(async () => ({ data: mocks.attempts, error: null })),
        maybeSingle: vi.fn(async () => ({ data: mocks.request, error: null })),
        // payments 조회는 마지막 eq에서 끝난다(thenable).
        then: (resolve: (value: unknown) => void) => resolve({ data: table === 'payments' ? mocks.payments : [], error: null }),
      };
      return query;
    },
  }),
}));

const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function dependencies(states: Array<SystemCancellationState | null>) {
  let clock = 0;
  const queue = [...states];
  const deps: SystemCancellationDependencies = {
    loadState: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]) ?? null),
    reconcile: vi.fn(async () => ({ ok: true as const, status: 'completed' as const })),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    now: () => clock,
  };
  return deps;
}

function state(override: Partial<SystemCancellationState> = {}): SystemCancellationState {
  return { requestId: REQUEST_ID, requestStatus: 'processing', attemptState: 'approved', manualProviderPayment: false, ...override };
}

describe('issueApprovedOrderCancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('승인(processing)된 취소는 곧바로 결제사 전액 취소 경로를 실행한다', async () => {
    const deps = dependencies([state()]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, {}, deps)).resolves.toEqual({
      status: 'reconciled',
      requestId: REQUEST_ID,
      result: { ok: true, status: 'completed' },
    });
    expect(deps.reconcile).toHaveBeenCalledWith(REQUEST_ID);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('Korpay·무통장 결제가 걸린 취소는 시스템이 돌리지 않는다(수동 절차를 막지 않는다)', async () => {
    const deps = dependencies([state({ manualProviderPayment: true })]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, {}, deps)).resolves.toEqual({
      status: 'skipped',
      reason: 'manual_provider',
    });
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('활성 취소 요청이 없으면 아무것도 하지 않는다', async () => {
    const deps = dependencies([null]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, {}, deps)).resolves.toEqual({
      status: 'skipped',
      reason: 'no_active_cancel',
    });
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('needs_review는 사람이 원인을 본 뒤 다시 돌린다 — 시스템이 재시도하지 않는다', async () => {
    const deps = dependencies([state({ requestStatus: 'needs_review' })]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, { awaitConfirmingAttemptMs: 40_000 }, deps))
      .resolves.toEqual({ status: 'skipped', reason: 'needs_review' });
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('staff 판단 대기(requested, 결제 확정됨)는 기다리지 않고 넘긴다', async () => {
    const deps = dependencies([state({ requestStatus: 'requested', attemptState: 'approved' })]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, { awaitConfirmingAttemptMs: 40_000 }, deps))
      .resolves.toEqual({ status: 'skipped', reason: 'awaiting_staff' });
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  // DB-2: 승인 응답을 기다리는 사이 접수된 취소. finalizer가 승인으로 끝나면 요청을
  // 자동 승인(processing)하고, 그때 같은 경로로 결제사 취소를 발행해야 돈이 돌아간다.
  it('결제 승인 확인 중이면 finalizer 판정을 기다렸다가 승인되면 발행한다', async () => {
    const deps = dependencies([
      state({ requestStatus: 'requested', attemptState: 'confirming' }),
      state({ requestStatus: 'requested', attemptState: 'confirming' }),
      state({ requestStatus: 'processing', attemptState: 'approved' }),
    ]);

    const outcome = await issueApprovedOrderCancellation(
      ORDER_ID,
      { awaitConfirmingAttemptMs: 40_000, pollIntervalMs: 1_500 },
      deps,
    );

    expect(outcome).toMatchObject({ status: 'reconciled', requestId: REQUEST_ID });
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
  });

  it('승인 거절로 요청이 결제 없이 종결되면 발행하지 않는다', async () => {
    const deps = dependencies([
      state({ requestStatus: 'requested', attemptState: 'confirming' }),
      null,
    ]);

    await expect(issueApprovedOrderCancellation(ORDER_ID, { awaitConfirmingAttemptMs: 40_000 }, deps))
      .resolves.toEqual({ status: 'skipped', reason: 'no_active_cancel' });
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('대기 상한을 넘기면 운영자 표면에 맡기고 멈춘다', async () => {
    const deps = dependencies([state({ requestStatus: 'requested', attemptState: 'confirming' })]);

    await expect(issueApprovedOrderCancellation(
      ORDER_ID,
      { awaitConfirmingAttemptMs: 6_000, pollIntervalMs: 1_500 },
      deps,
    )).resolves.toEqual({ status: 'skipped', reason: 'awaiting_staff' });
    expect(deps.sleep).toHaveBeenCalledTimes(4);
    expect(deps.reconcile).not.toHaveBeenCalled();
  });

  it('조회·실행 예외는 삼키고 failed로 남긴다(응답 뒤 실행이라 고객 화면에 닿지 않는다)', async () => {
    const deps = dependencies([state()]);
    vi.mocked(deps.loadState).mockRejectedValueOnce(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(issueApprovedOrderCancellation(ORDER_ID, {}, deps)).resolves.toEqual({ status: 'failed' });
    expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain('db down');
    errorSpy.mockRestore();
  });

  it('기본 의존성은 주문의 활성 취소 요청을 읽어 시스템 actor(null)로 오케스트레이터를 부른다', async () => {
    mocks.filters = [];
    mocks.request = { id: REQUEST_ID, status: 'processing', claim_type: 'cancel' };
    mocks.attempts = [{ state: 'approved' }];
    mocks.payments = [{ provider: 'toss', status: 'paid' }, { provider: 'korpay', status: 'failed' }];
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    await expect(issueApprovedOrderCancellation(ORDER_ID)).resolves.toMatchObject({ status: 'reconciled' });
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: null });
    expect(mocks.filters).toContainEqual({ table: 'order_cancellation_requests', column: 'order_id', value: ORDER_ID });
    expect(mocks.filters).toContainEqual({
      table: 'order_cancellation_requests',
      column: 'status',
      value: ['requested', 'processing', 'needs_review'],
    });
  });

  it('기본 의존성은 무통장 결제를 수동 결제로 읽어 건너뛴다', async () => {
    mocks.request = { id: REQUEST_ID, status: 'processing', claim_type: 'cancel' };
    mocks.attempts = [{ state: 'approved' }];
    mocks.payments = [{ provider: 'bank_transfer', status: 'paid' }];

    await expect(issueApprovedOrderCancellation(ORDER_ID)).resolves.toEqual({ status: 'skipped', reason: 'manual_provider' });
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('반품·교환 요청은 시스템 경로가 닫지 않는다', async () => {
    mocks.request = { id: REQUEST_ID, status: 'processing', claim_type: 'return' };
    mocks.attempts = [{ state: 'approved' }];

    await expect(issueApprovedOrderCancellation(ORDER_ID)).resolves.toEqual({
      status: 'skipped',
      reason: 'no_active_cancel',
    });
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });
});
