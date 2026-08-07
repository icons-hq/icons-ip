import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveAdminOrderCancellationAction,
  updateAdminOrderTrackingAction,
  reconcileAdminOrderCancellationAction,
  rejectAdminOrderCancellationAction,
  updateAdminOrderStatusAction,
} from './order-actions';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  rpc: vi.fn(),
  reconcile: vi.fn(),
  revalidatePath: vi.fn(),
  sendShippedEmail: vi.fn(),
}));

vi.mock('@/lib/email/transactional.server', () => ({
  sendOrderShippedEmail: mocks.sendShippedEmail,
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcile,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function statusForm(status = 'shipping') {
  const formData = new FormData();
  formData.set('orderId', ORDER_ID);
  formData.set('status', status);
  formData.set('carrier', 'hanjin');
  formData.set('trackingNumber', '1234-5678-9012');
  return formData;
}

function trackingForm(trackingNumber = '999888777666') {
  const formData = new FormData();
  formData.set('orderId', ORDER_ID);
  formData.set('carrier', 'hanjin');
  formData.set('trackingNumber', trackingNumber);
  return formData;
}

function requestForm(reason = '구매자와 확인 후 요청을 반려합니다') {
  const formData = new FormData();
  formData.set('requestId', REQUEST_ID);
  formData.set('reason', reason);
  formData.set('paymentKey', 'browser-must-not-control-this');
  formData.set('amount', '999999');
  return formData;
}

describe('admin order actions', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'completed' });
    mocks.revalidatePath.mockReset();
    mocks.sendShippedEmail.mockReset();
    mocks.sendShippedEmail.mockResolvedValue({ status: 'sent' });
  });

  it('배송 시작 전이에서만 배송 시작 메일 훅을 부른다', async () => {
    await updateAdminOrderStatusAction({}, statusForm('shipping'));
    expect(mocks.sendShippedEmail).toHaveBeenCalledWith({ orderId: ORDER_ID });

    mocks.sendShippedEmail.mockClear();
    await updateAdminOrderStatusAction({}, statusForm('done'));
    expect(mocks.sendShippedEmail).not.toHaveBeenCalled();
  });

  it('상태 전이가 실패하면 배송 시작 메일을 보내지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'order not shippable' } });

    const state = await updateAdminOrderStatusAction({}, statusForm('shipping'));

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.sendShippedEmail).not.toHaveBeenCalled();
  });

  it('비로그인은 관리자 로그인으로 보내고 RPC를 호출하지 않는다', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(updateAdminOrderStatusAction({}, statusForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비staff는 앱과 DB 쓰기 전에 차단한다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(updateAdminOrderStatusAction({}, statusForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('배송 상태 입력을 검증하고 audited DB RPC만 호출한다', async () => {
    await expect(updateAdminOrderStatusAction({}, statusForm('shipping'))).resolves.toEqual({
      message: '배송을 시작했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_order_status', {
      p_carrier: 'hanjin',
      p_order_id: ORDER_ID,
      p_status: 'shipping',
      p_tracking_number: '123456789012',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);

    mocks.rpc.mockClear();
    await expect(updateAdminOrderStatusAction({}, statusForm('canceled'))).resolves.toEqual({
      errors: { status: '허용된 배송 상태를 선택해주세요.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('운송장 없이는 배송 시작 RPC에 닿지 못한다', async () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'shipping');

    await expect(updateAdminOrderStatusAction({}, formData)).resolves.toEqual({
      errors: {
        carrier: '택배사를 선택해주세요.',
        trackingNumber: '송장번호를 입력해주세요.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('배송 완료 전이는 운송장 인자를 넘기지 않는다', async () => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', 'done');

    await expect(updateAdminOrderStatusAction({}, formData)).resolves.toEqual({
      message: '주문을 완료 처리했습니다.',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_order_status', {
      p_carrier: null,
      p_order_id: ORDER_ID,
      p_status: 'done',
      p_tracking_number: null,
    });
  });

  it('운송장 수정은 정규화한 값으로 audited RPC를 호출한다', async () => {
    await expect(updateAdminOrderTrackingAction({}, trackingForm(' 9998-8877-7666 '))).resolves.toEqual({
      message: '운송장 정보를 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_order_tracking', {
      p_carrier: 'hanjin',
      p_order_id: ORDER_ID,
      p_tracking_number: '999888777666',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER_ID}`);
  });

  it('운송장 수정 RPC 실패는 DB 오류 원문을 숨긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });

    await expect(updateAdminOrderTrackingAction({}, trackingForm())).resolves.toEqual({
      errors: { form: '운송장 정보를 저장하지 못했습니다. 최신 상태를 확인해주세요.' },
    });
  });

  it('청약철회 승인 RPC가 성공한 뒤에만 서버가 provider를 정합화한다', async () => {
    const form = requestForm();

    await expect(approveAdminOrderCancellationAction({}, form)).resolves.toEqual({
      message: '청약철회를 완료했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_decide_order_cancellation', {
      p_decision: 'approve',
      p_note: null,
      p_request_id: REQUEST_ID,
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      actorId: 'staff-1',
      requestId: REQUEST_ID,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('browser-must-not-control-this');
    expect(JSON.stringify(mocks.reconcile.mock.calls)).not.toContain('browser-must-not-control-this');
  });

  it('승인 RPC가 실패하면 provider를 호출하지 않고 오류 원문을 숨긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });

    const result = await approveAdminOrderCancellationAction({}, requestForm());

    expect(result).toEqual({ errors: { form: '청약철회 요청을 승인하지 못했습니다. 최신 상태를 확인해주세요.' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('provider 정합화가 불확실하면 완료로 거짓 보고하지 않는다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: false, code: 'provider_unreachable' });

    await expect(approveAdminOrderCancellationAction({}, requestForm())).resolves.toEqual({
      errors: { form: '결제 취소 상태를 확정하지 못했습니다. 운영 화면의 최신 상태에서 다시 확인해주세요.' },
    });
  });

  it('거절 사유는 DB RPC로 기록하되 provider를 호출하지 않는다', async () => {
    const form = requestForm();

    await expect(rejectAdminOrderCancellationAction({}, form)).resolves.toEqual({
      message: '청약철회 요청을 거절했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_decide_order_cancellation', {
      p_decision: 'reject',
      p_note: '구매자와 확인 후 요청을 반려합니다',
      p_request_id: REQUEST_ID,
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('needs_review 재정합화도 DB의 staff 게이트를 통과한 뒤 provider를 조회한다', async () => {
    await expect(reconcileAdminOrderCancellationAction({}, requestForm())).resolves.toEqual({
      message: '결제 취소 상태를 정합화했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_begin_order_cancellation_reconcile', {
      p_request_id: REQUEST_ID,
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      actorId: 'staff-1',
      requestId: REQUEST_ID,
    });
  });
});
