import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startAdminOrderCancellationAction } from './order-actions';
import { ADMIN_CANCELLATION_RECHECK_LABELS } from '@/lib/admin/orders';

/*
 * 운영자 전액 취소(ADR-0018, 2026-10-12 점검 OPS-8·OPS-5·REF-1).
 * 시작 RPC가 성공한 뒤에만 같은 오케스트레이터로 결제사 전액 취소를 실행하고,
 * 결과를 사실대로 보고한다. 브라우저가 보낸 결제 식별자는 어디에도 싣지 않는다.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as { isConfigured: boolean; user: { id: string; email: string | null } | null; role: string | null; isStaff: boolean },
  rpc: vi.fn(),
  reconcile: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: mocks.reconcile }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: vi.fn() }));
vi.mock('@/lib/email/transactional.server', () => ({ sendOrderShippedEmail: vi.fn(), sendOrderConfirmationEmail: vi.fn() }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: async () => [] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function form(fields: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('orderId', ORDER_ID);
  formData.set('reasonCode', 'test_payment_cleanup');
  formData.set('note', '');
  formData.set('paymentKey', 'browser-must-not-control-this');
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe('startAdminOrderCancellationAction', () => {
  beforeEach(() => {
    mocks.adminState = { isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.gg' }, role: 'staff', isStaff: true };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: REQUEST_ID, error: null });
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'completed' });
    mocks.revalidatePath.mockReset();
  });

  it('시작 RPC가 만든 요청을 staff actor로 곧바로 결제사 전액 취소까지 실행한다', async () => {
    const state = await startAdminOrderCancellationAction({}, form({ warehouseStopConfirmed: 'confirmed', note: '심사 창 테스트 결제' }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_start_order_cancellation', {
      p_note: '심사 창 테스트 결제',
      p_order_id: ORDER_ID,
      p_reason_code: 'test_payment_cleanup',
      p_warehouse_stop_confirmed: true,
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: 'staff-1' });
    expect(state.message).toContain('토스 전액 취소를 확인하고 주문 취소를 마쳤습니다');
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('browser-must-not-control-this');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/cancels');
  });

  it('창고 출고 중단 확인이 없으면 DB 거절을 운영자 문구로 옮기고 결제사를 부르지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'warehouse_stop_confirmation_required' } });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(state.errors?.form).toContain('창고에서 출고 중단을 확인한 뒤');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ['shipment_already_dispatched', '이미 발송된 배송 건이 있어'],
    ['order_claim_in_progress', '이미 진행 중인 취소·반품·교환 요청'],
    ['staff_cancellation_toss_only', '토스 결제 주문만'],
    ['payment_reconciliation_required', '결제 결과가 아직 확정되지 않았습니다'],
    ['private db detail', '전액 취소를 시작하지 못했습니다'],
  ])('%s 거절은 결제사 호출 없이 안전한 문구로 답한다', async (message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(state.errors?.form).toContain(expected);
    expect(JSON.stringify(state)).not.toContain('private');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('결제사 취소를 확정하지 못하면 완료로 보고하지 않고 재시도 표면을 안내한다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: false, code: 'provider_cancel_failed' });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(state.errors?.form).toContain('provider_cancel_failed');
    // 실패하면 요청은 결제확인필요가 된다. 그때 주문 패널 버튼은 [상태 다시 확인]이고,
    // 취소 관리 요청 상세에는 [환불 완료 확정]이 그려진다 — 화면에 있는 버튼만 가리킨다.
    expect(state.errors?.form).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}]`);
    expect(state.errors?.form).toContain('[환불 완료 확정]');
    expect(state.errors?.form).not.toContain('[처리 상태 확인]으로');
    expect(state.message).toBeUndefined();
  });

  it('결제 상태 처리가 끝나지 않으면 완료로 보고하지 않고 주문 패널의 재확인 버튼을 가리킨다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'in_progress' });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(state.message).toContain('주문과 재고는 그대로 유지됩니다');
    expect(state.message).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]`);
    expect(state.message).not.toContain('마쳤습니다');
  });

  it('기타 사유는 메모 없이 DB에 닿지 않는다', async () => {
    const state = await startAdminOrderCancellationAction({}, form({ reasonCode: 'other', note: '짧음' }));

    expect(state.errors?.note).toBe('기타 사유는 메모를 5자 이상 입력해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('허용 목록 밖 사유와 잘못된 주문 id는 거절한다', async () => {
    const state = await startAdminOrderCancellationAction({}, form({ reasonCode: 'refund_anyway', orderId: 'not-a-uuid' }));

    expect(state.errors).toMatchObject({ reasonCode: '취소 사유를 선택해주세요.', orderId: '주문을 찾을 수 없습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비staff는 DB 게이트 전에 차단한다', async () => {
    mocks.adminState = { isConfigured: true, user: { id: 'fan-1', email: 'fan@icons.gg' }, role: 'user', isStaff: false };

    await expect(startAdminOrderCancellationAction({}, form())).resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
