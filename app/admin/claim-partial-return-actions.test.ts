import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordOrderClaimRefundAction } from './claim-actions';

/*
 * 부분 반품(ADR-0047)의 환불 접수·완료. 주문 전체 결제 취소 경로(reconcileOrderCancellation)를 부르지 않고, 부분 환불 원장으로
 * 결제사 부분 취소를 확인한다. 결제사가 부분 취소를 받지 않으면 전액 환불로 돌리지 않는다.
 */

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const ORDER_ID = 'abcdef02-1234-4123-8123-123456789abc';
const REFUND_ID = 'abcdef03-1234-4123-8123-123456789abc';

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  loadAdminClaimPartialReturn: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  reconcileOrderPartialCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.loadAdminClaimDetail }));
vi.mock('@/lib/orders/partial-return.server', () => ({ loadAdminClaimPartialReturn: mocks.loadAdminClaimPartialReturn }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: mocks.reconcileOrderCancellation }));
vi.mock('@/lib/orders/partial-cancellation-orchestrator.server', () => ({ reconcileOrderPartialCancellation: mocks.reconcileOrderPartialCancellation }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: mocks.recoverGoodsPaymentManually }));

function detail(provider = 'toss', stage = 'processing') {
  return { claim: { id: CLAIM_ID, orderId: ORDER_ID, stage, claimType: 'return' }, payment: { provider }, refund: null };
}

function partial(refundId: string | null = REFUND_ID) {
  return {
    items: [], refundId, previewError: null,
    preview: refundId ? null : { provider: 'toss', balanceBefore: 40_000, goodsRefundAmount: 9_500, shippingRefundAmount: 0, grossRefundAmount: 9_500,
      returnFeeDeduction: 3_000, returnFeeBasis: 'one_way', returnFeeReason: null, refundAmount: 6_500, storeCreditRestoreAmount: 0, emptiedShipmentCount: 0 },
    history: refundId ? [{ id: refundId, state: 'processing' }] : [],
  };
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
  mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true,
    user: { id: 'staff-1', email: 'staff@example.test' }, role: 'staff', isStaff: true });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: 'completed', error: null });
});

describe('부분 반품 환불 액션(ADR-0047)', () => {
  it('토스 완료는 부분 환불 원장으로 결제사 부분 취소를 확인한 뒤 완료를 기록한다 — 주문 전체 정합화를 부르지 않는다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail());
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial());
    mocks.reconcileOrderPartialCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(mocks.reconcileOrderPartialCancellation).toHaveBeenCalledWith({ partialCancellationId: REFUND_ID, actorId: 'staff-1' });
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_refund', { p_claim_id: CLAIM_ID, p_method: 'pg_cancel', p_note: null, p_stage: 'completed' });
    expect(state.message).toContain('토스 부분 취소를 확인하고 부분 반품 환불 완료');
  });

  it('결제사가 부분 취소를 받지 않으면 완료를 기록하지 않고 전액 환불로 돌리지 말라고 알린다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail());
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial());
    mocks.reconcileOrderPartialCancellation.mockResolvedValue({ ok: false, code: 'partial_cancel_rejected' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(state.error).toContain('전액 환불로 돌리지 말고');
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.anything());
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('무통장 완료는 송금 증빙 경로로 안내하고 아무것도 시작하지 않는다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('bank_transfer'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial());

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toContain('부분 환불 기록에서 송금 증빙으로 완료');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
  });

  it('환불 접수는 DB가 금액을 정하고, 문구는 미리보기의 차감 뒤 금액을 말한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('toss', 'collected'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial(null));
    mocks.rpc.mockResolvedValue({ data: 'filed', error: null });

    const state = await recordOrderClaimRefundAction({}, refundForm('filed', 'pg_cancel'));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_refund', { p_claim_id: CLAIM_ID, p_method: 'pg_cancel', p_note: null, p_stage: 'filed' });
    expect(state.message).toContain('반품배송비 3,000원을 뺀 6,500원');
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
  });

  it('환불 수단이 결제와 다르면 결제사 호출 전에 거절한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail());
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial());

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toContain('부분 반품의 환불 수단과 다릅니다');
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
  });
});
