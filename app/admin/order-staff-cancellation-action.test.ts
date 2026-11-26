import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
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
    operatorAccess: undefined,
  } as { isConfigured: boolean; user: { id: string; email: string | null } | null; role: string | null; isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture> },
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

const STAFF_DENIED = '판매 관리 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.';

describe('startAdminOrderCancellationAction', () => {
  beforeEach(() => {
    mocks.adminState = { isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: REQUEST_ID, error: null });
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'completed' });
    mocks.revalidatePath.mockReset();
  });

  it('시작 RPC가 만든 요청을 staff actor로 곧바로 결제사 전액 취소까지 실행한다', async () => {
    const state = await startAdminOrderCancellationAction({}, form({ warehouseStopConfirmed: 'confirmed', note: '심사 창 테스트 결제' }));

    /* 화면에 확인란이 없다. DB는 그 값을 근거로 보지 않고(시그니처 호환용) 창고 회신 기록으로 판정하므로, 브라우저가 보낸 값은 받지 않는다. */
    expect(mocks.rpc).toHaveBeenCalledWith('admin_start_order_cancellation', {
      p_note: '심사 창 테스트 결제',
      p_order_id: ORDER_ID,
      p_reason_code: 'test_payment_cleanup',
      p_warehouse_stop_confirmed: false,
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: 'staff-1' });
    /* 결제사가 토스든 나이스페이든 같은 문장이다. */
    expect(state.message).toContain('결제 전액 취소를 확인하고 주문 취소를 마쳤습니다');
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('browser-must-not-control-this');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/cancels');
  });

  /* ADR-0046: 출고지시가 나간 배송 건은 확인란이 아니라 주문 상세의 창고 회신 기록이 근거다. */
  it('창고 회신 기록이 없으면 DB 거절을 회신 기록 안내로 옮기고 결제사를 부르지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'warehouse_stop_reply_required' } });

    const state = await startAdminOrderCancellationAction({}, form({ warehouseStopConfirmed: 'confirmed' }));

    expect(state.errors?.form).toContain('창고 회신 기록');
    expect(state.errors?.form).not.toContain('확인란');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('창고가 이미 출고했다고 회신했으면 취소 대신 발송 처리·반품 접수를 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'warehouse_already_shipped' } });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(state.errors?.form).toContain('이미 출고했다고 회신');
    expect(state.errors?.form).toContain('반품');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  /* 2026-10-12 브라우저 QA R2-2: 양식을 연 뒤 출고지시가 나가면 열 때의 패널에는 회신 안내가
     없다. 서버가 거절하면 주문 패널을 다시 그려 회신 상태가 나타나게 한다. */
  it('서버가 거절하면 주문 패널을 최신 상태로 다시 그린다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'warehouse_stop_reply_used' } });

    const state = await startAdminOrderCancellationAction({}, form());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/orders');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
    expect(state.errors?.form).toContain('다른 취소에 쓰였습니다');
  });

  it.each([
    ['shipment_already_dispatched', '이미 발송된 배송 건이 있어'],
    ['order_claim_in_progress', '이미 진행 중인 취소·반품·교환 요청'],
    ['partial_cancel_in_progress', '재고 부족 부분 취소의 결제 확인을 먼저 마쳐주세요'],
    ['staff_cancellation_toss_only', '토스·나이스페이 결제 주문만'],
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

    /* 환불이 됐는지 모른다는 사실과 다음 할 일을 먼저 말하고, 코드는 끝에 문의용으로 한 번만 붙는다. */
    expect(state.errors?.form).toContain('고객 환불이 끝났는지 아직 확인되지 않았고');
    expect(state.errors?.form).toContain('결제사 취소에 실패했습니다');
    expect(state.errors?.form?.endsWith('문의할 때 알려 줄 코드: provider_cancel_failed')).toBe(true);
    expect(state.errors?.form).not.toContain('(provider_cancel_failed)');
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

  it('staff role alone cannot start cancellation without sales.manage', async()=>{
    mocks.adminState.operatorAccess=undefined;
    expect(await startAdminOrderCancellationAction({},form())).toEqual({errors:{form:STAFF_DENIED}});
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('비staff는 DB 게이트 전에 차단한다', async () => {
    mocks.adminState = { isConfigured: true, user: { id: 'fan-1', email: 'fan@icons.gg' }, role: 'user', isStaff: false };

    await expect(startAdminOrderCancellationAction({}, form())).resolves.toEqual({ errors: { form: STAFF_DENIED } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
