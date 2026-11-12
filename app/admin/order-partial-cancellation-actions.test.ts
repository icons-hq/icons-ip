import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), inspect: vi.fn(), reconcile: vi.fn(), create: vi.fn(), userRpc: vi.fn(), serviceRpc: vi.fn(), caller: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/access', () => ({ hasAdminCapability: () => true }));
vi.mock('@/lib/orders/partial-cancellation-orchestrator.server', () => ({
  inspectOrderPartialCancellationResolution: mocks.inspect, reconcileOrderPartialCancellation: mocks.reconcile,
}));
vi.mock('@/lib/admin/list-export-refund-transfers.server', () => ({ refundTransferExportCaller: mocks.caller }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.serviceRpc }) }));
import { resolveOrderPartialCancellationAction } from './order-partial-cancellation-actions';

const ids = {
  orderId: 'b1910000-0000-4000-8000-000000000001', partialCancellationId: 'b1910000-0000-4000-8000-000000000002',
  actor: 'b1910000-0000-4000-8000-000000000003', session: 'b1910000-0000-4000-8000-000000000004',
};
const input = { orderId: ids.orderId, partialCancellationId: ids.partialCancellationId, reason: '상점관리자에서 취소 거래 확인' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: ids.actor } });
  mocks.create.mockResolvedValue({ rpc: mocks.userRpc });
  mocks.caller.mockResolvedValue({ actorId: ids.actor, sessionId: ids.session });
  mocks.serviceRpc.mockResolvedValue({ data: {}, error: null });
});

describe('결제확인필요 해소 서버 액션', () => {
  it('결제사 조회 결과 없이는 해소하지 않는다', async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: 'provider_unavailable' });
    const result = await resolveOrderPartialCancellationAction(input);
    expect(result.ok).toBe(false);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it('조회 중 예외가 나도 해소하지 않는다', async () => {
    mocks.inspect.mockRejectedValue(new Error('network'));
    expect((await resolveOrderPartialCancellationAction(input)).ok).toBe(false);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('운영자 권한이 없으면 조회도 하지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: false, user: { id: ids.actor } });
    expect((await resolveOrderPartialCancellationAction(input)).ok).toBe(false);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('조회 결과(방법·잔액·거래 키)와 서버가 증명한 신원만 서비스 RPC로 넘기고 브라우저 세션 RPC는 쓰지 않는다', async () => {
    mocks.inspect.mockResolvedValue({ ok: true, resolution: 'already_canceled', observedBalance: 30500, transactionKey: 'TX-KEY-1' });
    const result = await resolveOrderPartialCancellationAction({ ...input, resolution: 'not_moved', observedBalance: 1 } as typeof input);
    expect(result.ok).toBe(true);
    expect(mocks.serviceRpc).toHaveBeenCalledWith('service_resolve_order_partial_cancellation', {
      p_id: ids.partialCancellationId, p_resolution: 'already_canceled', p_reason: input.reason, p_provider_transaction_key: 'TX-KEY-1',
      p_observed_balance: 30500, p_actor_id: ids.actor, p_session_id: ids.session,
    });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it('돈이 움직이지 않은 건은 거래 키 없이 진행하지 않음으로 보낸다', async () => {
    mocks.inspect.mockResolvedValue({ ok: true, resolution: 'not_moved', observedBalance: 40000 });
    expect((await resolveOrderPartialCancellationAction(input)).ok).toBe(true);
    expect(mocks.serviceRpc).toHaveBeenCalledWith('service_resolve_order_partial_cancellation',
      expect.objectContaining({ p_resolution: 'not_moved', p_provider_transaction_key: null, p_observed_balance: 40000 }));
  });

  it('세션을 증명하지 못하면 서비스 RPC를 부르지 않는다', async () => {
    mocks.inspect.mockResolvedValue({ ok: true, resolution: 'not_moved', observedBalance: 40000 });
    mocks.caller.mockRejectedValue(new Error('no session'));
    expect((await resolveOrderPartialCancellationAction(input)).ok).toBe(false);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('DB가 거절하면 오류를 돌려준다', async () => {
    mocks.inspect.mockResolvedValue({ ok: true, resolution: 'not_moved', observedBalance: 40000 });
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'bank_refund_permission_required' } });
    const result = await resolveOrderPartialCancellationAction(input);
    expect(result).toEqual({ ok: false, error: '송금 담당 권한(관리자 로그인 세션)이 필요합니다.' });
  });
});
