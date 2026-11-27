import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOrderFullCancelAmountAction } from './order-cancel-amount-actions';

/*
 * 운영자 전액 취소 확인창의 금액. 전액 취소는 결제 금액이 아니라 남은 결제 금액(결제완료 결제 − 이미 적용된 부분 취소)을 취소한다 —
 * DB(admin_start_order_cancellation)가 환불 기록에 적는 금액과 같은 계산이다. 화면은 누르는 시점에 이 값을 읽는다(읽기 전용).
 */
const ORDER_ID = 'abcdef02-1234-4123-8123-123456789abc';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), payments: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.from(table);
      const query = { select: () => query, eq: (column: string, value: unknown) => { mocks.from(`${column}=${String(value)}`); return query; }, then: (resolve: (value: unknown) => void) => resolve(mocks.payments()) };
      return query;
    },
  }),
}));

const record = (override: Record<string, unknown> = {}) => {
  const refundAmount = typeof override.refundAmount === 'number' ? override.refundAmount : 9500;
  return {
    id: 'abcdef03-1234-4123-8123-123456789abc', sequence: 1, state: 'completed', provider: 'toss', goodsRefundAmount: refundAmount,
    shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-20T01:00:00Z', appliedAt: '2026-11-20T01:01:00Z', completedAt: '2026-11-20T01:01:00Z',
    transferredAt: null, items: [], closedShipmentCount: 0, ...override, refundAmount,
  };
};
const context = (history: unknown[]) => ({ data: { enabled: false, canManage: true, blockers: ['partial_cancel_disabled'], history }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'staff-1' } });
  mocks.payments.mockReturnValue({ data: [{ amount: 40000, status: 'paid' }], error: null });
  mocks.rpc.mockResolvedValue(context([]));
});

describe('readOrderFullCancelAmountAction — 운영자 전액 취소 확인창의 금액', () => {
  it('부분 취소가 없으면 결제완료 결제 금액 그대로다', async () => {
    await expect(readOrderFullCancelAmountAction(ORDER_ID.toUpperCase())).resolves.toEqual({ ok: true, amount: 40000, paidAmount: 40000 });
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith('/admin/sales/orders', { capability: 'sales.manage' });
    expect(mocks.from.mock.calls.map(([value]) => value)).toEqual(['payment_summaries', 'purpose=order', `ref_id=${ORDER_ID}`]);
    expect(mocks.rpc.mock.calls).toEqual([['admin_order_partial_cancellation_context', { p_order_id: ORDER_ID }]]);
  });

  it('이미 적용된 부분 취소 금액만 빼고, 진행 중·거절된 기록은 빼지 않는다', async () => {
    mocks.rpc.mockResolvedValue(context([
      record(),
      record({ id: 'abcdef04-1234-4123-8123-123456789abc', sequence: 2, state: 'rejected', refundAmount: 7000, appliedAt: null, completedAt: null }),
      record({ id: 'abcdef05-1234-4123-8123-123456789abc', sequence: 3, state: 'needs_review', refundAmount: 3000, appliedAt: null, completedAt: null }),
    ]));

    await expect(readOrderFullCancelAmountAction(ORDER_ID)).resolves.toEqual({ ok: true, amount: 30500, paidAmount: 40000 });
  });

  it('결제완료 결제만 더한다(실패·취소된 결제는 세지 않는다)', async () => {
    mocks.payments.mockReturnValue({ data: [{ amount: 99000, status: 'failed' }, { amount: 18000, status: 'paid' }, { amount: 12000, status: 'paid' }], error: null });

    await expect(readOrderFullCancelAmountAction(ORDER_ID)).resolves.toEqual({ ok: true, amount: 30000, paidAmount: 30000 });
  });

  it.each([
    ['결제 읽기 실패', () => mocks.payments.mockReturnValue({ data: null, error: { message: 'connection reset' } })],
    ['결제완료 결제가 없음', () => mocks.payments.mockReturnValue({ data: [{ amount: 40000, status: 'pending' }], error: null })],
    ['금액 모양이 어긋남', () => mocks.payments.mockReturnValue({ data: [{ amount: '40000', status: 'paid' }], error: null })],
    ['부분 취소 읽기 실패', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } })],
    ['부분 취소 모양이 어긋남', () => mocks.rpc.mockResolvedValue({ data: { history: [] }, error: null })],
    ['부분 취소가 결제 금액보다 큼', () => mocks.rpc.mockResolvedValue(context([record({ refundAmount: 50000 })]))],
  ])('%s이면 금액을 지어내지 않는다', async (_label, arrange) => {
    arrange();
    await expect(readOrderFullCancelAmountAction(ORDER_ID)).resolves.toEqual({ ok: false });
  });

  it('주문 번호가 아니거나 권한이 없으면 아무것도 읽지 않는다', async () => {
    await expect(readOrderFullCancelAmountAction('not-a-uuid')).resolves.toEqual({ ok: false });
    mocks.access.mockResolvedValue(null);
    await expect(readOrderFullCancelAmountAction(ORDER_ID)).resolves.toEqual({ ok: false });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
