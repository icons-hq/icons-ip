import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPartialReturnToTransferAction, recordOrderClaimRefundAction } from './claim-actions';

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

    expect(state.error).toContain('전액 환불로 돌리지 마세요');
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.anything());
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('무통장 완료는 송금 증빙 경로로 안내하고 아무것도 시작하지 않는다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('bank_transfer'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue(partial());

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toContain('부분 환불 기록에서 송금 근거를 적고 [송금 완료 기록]');
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

    expect(state.error).toContain('부분 반품의 환불 수단과 맞지 않는 처리입니다');
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
  });
});

describe('결제사 거절 뒤 계좌 송금 부분 환불로 전환(ADR-0047, 적대적 리뷰 2026-11-19)', () => {
  const OPERATION_ID = 'abcdef04-1234-4123-8123-123456789abc';
  function convertForm(patch: Record<string, string | null> = {}) {
    const form = new FormData();
    const values: Record<string, string | null> = { claimId: CLAIM_ID, operationId: OPERATION_ID, reason: 'TEST 카드사 부분 취소 불가 — 고객 통화로 계좌 송금 동의',
      bankName: 'TEST은행', accountNumber: '000-0000-1234', accountHolder: 'TEST 구매자', confirmed: 'on', ...patch };
    for (const [key, value] of Object.entries(values)) if (value !== null) form.set(key, value);
    return form;
  }

  beforeEach(() => {
    /* 결제 담당 = 레거시 모드의 관리자(무통장 송금 담당과 같은 판정). */
    mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true,
      user: { id: 'staff-1', email: 'staff@example.test' }, role: 'admin', isStaff: true });
  });

  it('결제 담당은 사유·계좌로 전환 RPC를 한 번 부르고 송금 대기를 알린다 — 결제사 호출·주문 전체 정합화는 없다', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: REFUND_ID, state: 'awaiting_transfer', refundAmount: 10_000, replayed: false }, error: null });

    const state = await convertPartialReturnToTransferAction({}, convertForm());

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_convert_partial_return_refund_to_transfer', {
      p_claim_id: CLAIM_ID, p_reason: 'TEST 카드사 부분 취소 불가 — 고객 통화로 계좌 송금 동의',
      p_refund_account: { bankName: 'TEST은행', accountNumber: '000-0000-1234', accountHolder: 'TEST 구매자' }, p_operation_id: OPERATION_ID,
    });
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toContain('계좌 송금 부분 환불(10,000원)로 바꿨습니다');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/refund-transfers');
  });

  it.each([
    ['짧은 사유', { reason: '짧음' }, '사유를 5~500자'],
    ['계좌번호 형식', { accountNumber: '12' }, '환불계좌'],
    ['예금주 없음', { accountHolder: '' }, '환불계좌'],
    ['확인 체크 없음', { confirmed: null }, '확인했다는 항목'],
  ])('%s는 RPC 전에 거절한다', async (_label, patch, message) => {
    const state = await convertPartialReturnToTransferAction({}, convertForm(patch));
    expect(state.error).toContain(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('결제 담당(레거시 관리자)이 아니면 거절한다', async () => {
    mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture('staff'), isConfigured: true,
      user: { id: 'staff-1', email: 'staff@example.test' }, role: 'staff', isStaff: true });
    const state = await convertPartialReturnToTransferAction({}, convertForm());
    expect(state.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['partial_return_transfer_unavailable', '결제사가 부분 취소를 받지 않은 부분 반품뿐'],
    ['partial_return_transfer_reason_required', '사유를 5~500자'],
    ['bank_refund_permission_required', '계좌 송금 환불 권한'],
  ])('DB 거절 %s를 운영자 문구로 옮긴다', async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
    const state = await convertPartialReturnToTransferAction({}, convertForm());
    expect(state.error).toContain(message);
  });

  it('계좌 송금으로 바꾼 부분 반품의 완료 확정은 송금 증빙 경로로 안내하고 결제사 부분 취소를 부르지 않는다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('toss', 'processing'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue({ ...partial(), settlement: 'bank_transfer', transferConvertible: false,
      history: [{ id: REFUND_ID, state: 'awaiting_transfer' }] });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(state.error).toBeTruthy();
    expect(mocks.reconcileOrderPartialCancellation).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.anything());
  });
});

describe('부분 반품 접수 때 재고 처리 저장(Codex 리뷰: 0원 반품이 불량 선택 전에 재고를 복원)', () => {
  const ITEM = 'abcdef05-1234-4123-8123-123456789abc';
  function fileForm() {
    const form = refundForm('filed', 'pg_cancel');
    form.set(`stockDisposition:${ITEM}`, 'defective');
    return form;
  }

  it('접수 양식에 실린 불량 선택을 접수 RPC보다 먼저 저장한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('toss', 'collected'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue({ ...partial(null), settlement: null, transferConvertible: false });
    mocks.rpc.mockResolvedValue({ data: 'filed', error: null });

    const state = await recordOrderClaimRefundAction({}, fileForm());

    const names = mocks.rpc.mock.calls.map(([name]) => name);
    expect(names.indexOf('admin_plan_claim_defective_stock')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('admin_plan_claim_defective_stock')).toBeLessThan(names.indexOf('admin_record_order_claim_refund'));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_plan_claim_defective_stock', { p_claim_id: CLAIM_ID, p_order_item_ids: [ITEM] });
    expect(state.error).toBeUndefined();
  });

  it('불량 선택 저장이 실패하면 접수하지 않는다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail('toss', 'collected'));
    mocks.loadAdminClaimPartialReturn.mockResolvedValue({ ...partial(null), settlement: null, transferConvertible: false });
    mocks.rpc.mockImplementation(async (name: string) => (name === 'admin_plan_claim_defective_stock'
      ? { data: null, error: { message: 'defective_stock_claim_closed' } } : { data: 'filed', error: null }));

    const state = await recordOrderClaimRefundAction({}, fileForm());

    expect(state.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.anything());
  });
});

