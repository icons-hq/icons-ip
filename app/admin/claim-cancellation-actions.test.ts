import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideOrderClaimAction, recordOrderClaimRefundAction } from './claim-actions';

/*
 * 클레임 콘솔의 취소 승인·환불 확정이 실제 결제사 취소로 이어지는지(2026-10-12 점검
 * REF-2·REF-8). 승인은 원장만 여는 것이 아니라 오케스트레이터를 곧바로 실행해야 하고,
 * 토스 결제의 환불 수단은 폼이 아니라 결제가 정한다.
 */

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const ORDER_ID = 'abcdef02-1234-4123-8123-123456789abc';

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.loadAdminClaimDetail }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcileOrderCancellation,
}));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({
  recoverGoodsPaymentManually: mocks.recoverGoodsPaymentManually,
}));

function detail(override: {
  provider?: string | null;
  stage?: string;
  refundMethod?: string | null;
} = {}) {
  return {
    claim: { id: CLAIM_ID, orderId: ORDER_ID, stage: override.stage ?? 'processing' },
    payment: override.provider === null ? null : { provider: override.provider ?? 'toss' },
    refund: { method: override.refundMethod ?? null },
  };
}

function decisionForm(decision: string, claimType = 'cancel') {
  const form = new FormData();
  form.set('claimId', CLAIM_ID);
  form.set('claimType', claimType);
  form.set('decision', decision);
  return form;
}

function refundForm(stage: 'filed' | 'completed', method: string) {
  const form = new FormData();
  form.set('claimId', CLAIM_ID);
  form.set('claimType', 'return');
  form.set('orderId', ORDER_ID);
  form.set('stage', stage);
  form.set('method', method);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAdminAuthState.mockResolvedValue({
    isConfigured: true,
    user: { id: 'staff-1' },
    role: 'staff',
    isStaff: true,
  });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('decideOrderClaimAction — 취소 승인', () => {
  it('토스 결제 취소를 승인하면 곧바로 staff actor로 결제사 전액 취소 경로를 실행한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_decide_order_claim', expect.objectContaining({ p_decision: 'approve' }));
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: CLAIM_ID, actorId: 'staff-1' });
    expect(state.message).toContain('토스 전액 취소까지 확인했습니다');
  });

  it('결제사 취소를 확정하지 못하면 승인은 남기되 오류와 재시도 경로를 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: false, code: 'provider_cancel_failed' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(state.error).toContain('provider_cancel_failed');
    expect(state.error).toContain('[환불 완료 확정]');
  });

  it('Korpay 결제는 접수 양식 절차를 가리지 않도록 자동 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay' }));

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toContain('Korpay');
  });

  it('무통장 입금 결제는 계좌 송금 절차를 가리지 않도록 자동 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'bank_transfer' }));

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toContain('무통장 입금 결제');
  });

  it('반품 승인(수거 시작)은 결제사 취소를 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collecting', error: null });

    const state = await decideOrderClaimAction({}, decisionForm('approve', 'return'));

    expect(mocks.loadAdminClaimDetail).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toBe('클레임을 승인하고 수거를 시작했습니다.');
  });
});

describe('recordOrderClaimRefundAction — 환불 수단은 결제가 정한다', () => {
  it('토스 결제에 계좌 송금을 보내면 결제사 호출 전에 거절한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toContain('토스 결제는 결제사 취소');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('토스 환불 완료 확정은 오케스트레이터를 실행한 뒤 원장에 기록한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss', stage: 'processing' }));
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'admin_goods_manual_recovery_attempts' ? { data: [], error: null } : { data: null, error: null }
    ));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: CLAIM_ID, actorId: 'staff-1' });
    const calls = mocks.rpc.mock.calls.map(([name]) => name);
    expect(calls.indexOf('admin_begin_order_cancellation_reconcile')).toBeLessThan(calls.indexOf('admin_record_order_claim_refund'));
    expect(state.message).toContain('토스 전액 취소를 확인하고');
  });

  it('결제사 취소 뒤 원장 기록만 실패하면 "다시 환불하지 마세요"를 먼저 말한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss', stage: 'processing' }));
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_goods_manual_recovery_attempts') return { data: [], error: null };
      if (name === 'admin_record_order_claim_refund') return { data: null, error: { message: 'claim_refund_ledger_missing' } };
      return { data: null, error: null };
    });
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(state.error).toMatch(/^토스 전액 취소와 주문 취소·재고 복원·카드팩 회수는 이미 완료됐습니다/);
    expect(state.error).toContain('다시 환불하지 마세요');
  });

  it('원장에 이미 기록된 수단과 다른 값은 거절한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay', refundMethod: 'bank_transfer' }));

    const state = await recordOrderClaimRefundAction({}, refundForm('filed', 'pg_cancel'));

    expect(state.error).toBeDefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('Korpay처럼 수단이 정해지지 않은 결제는 운영자 선택을 그대로 쓴다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay', stage: 'collected' }));
    mocks.rpc.mockResolvedValue({ data: 'filed', error: null });

    const state = await recordOrderClaimRefundAction({}, refundForm('filed', 'bank_transfer'));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_refund', expect.objectContaining({ p_method: 'bank_transfer' }));
    expect(state.message).toBe('환불 접수를 기록했습니다.');
  });
});
