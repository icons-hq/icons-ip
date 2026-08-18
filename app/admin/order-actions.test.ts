import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveAdminOrderCancellationAction,
  recoverAdminGoodsPaymentAction,
  updateAdminOrderTrackingAction,
  reconcileAdminOrderCancellationAction,
  rejectAdminOrderCancellationAction,
  resendOrderEmailAction,
  bulkConfirmAdminOrdersAction,
  updateAdminOrderStatusAction,
} from './order-actions';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

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
  recoverGoodsPayment: vi.fn(),
  revalidatePath: vi.fn(),
  sendShippedEmail: vi.fn(),
  sendConfirmationEmail: vi.fn(),
}));

/* 택배사 레지스트리는 DB(`public.shipping_carriers`)에서 온다(#251). 앱에 상수
   목록이 없으므로 테스트도 고정 레지스트리를 주입한다 — 여기서 확인하려는 것은
   목록 자체가 아니라 운송장이 그 목록을 거쳐 그려지는가다. */
vi.mock('@/lib/orders/shipment.server', () => {
  const carriers = [{
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
      + '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
  }];
  return {
    getShippingCarrierRegistry: async () => carriers,
    loadShippingCarrierRegistry: async () => carriers,
  };
});

vi.mock('@/lib/email/transactional.server', () => ({
  sendOrderShippedEmail: mocks.sendShippedEmail,
  sendOrderConfirmationEmail: mocks.sendConfirmationEmail,
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcile,
}));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({
  recoverGoodsPaymentManually: mocks.recoverGoodsPayment,
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
    mocks.recoverGoodsPayment.mockReset();
    mocks.recoverGoodsPayment.mockResolvedValue({ outcome: 'provider_cancel_confirmed' });
    mocks.revalidatePath.mockReset();
    mocks.sendShippedEmail.mockReset();
    mocks.sendShippedEmail.mockResolvedValue({ status: 'sent' });
    mocks.sendConfirmationEmail.mockReset();
    mocks.sendConfirmationEmail.mockResolvedValue({ status: 'sent' });
  });

  it('배송 시작 전이에서만 배송 시작 메일 훅을 부른다', async () => {
    await updateAdminOrderStatusAction({}, statusForm('shipping'));
    expect(mocks.sendShippedEmail).toHaveBeenCalledTimes(1);

    /* 발주확인·배송완료는 배송 시작이 아니다. 여기서 메일이 나가면 구매자는
       같은 배송 안내를 세 번 받는다(#250). */
    for (const other of ['confirmed', 'delivered']) {
      mocks.sendShippedEmail.mockClear();
      await updateAdminOrderStatusAction({}, statusForm(other));
      expect(mocks.sendShippedEmail).not.toHaveBeenCalled();
    }
  });

  // 운송장을 넘기지 않으면 구매자는 "운송장 정보가 등록되면…"만 담긴 메일을 받고,
  // dedupe 행이 sent로 닫혀 다시 보낼 수도 없다.
  it('배송 시작 메일에 방금 등록한 운송장을 실어 보낸다', async () => {
    await updateAdminOrderStatusAction({}, statusForm('shipping'));

    expect(mocks.sendShippedEmail).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      carrierName: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: expect.stringContaining('123456789012'),
    });
  });

  it('배송 시작 메일 실패를 삼키지 않고 로그로 남긴다', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sendShippedEmail.mockResolvedValue({ status: 'failed', error: 'resend 429' });

    await expect(updateAdminOrderStatusAction({}, statusForm('shipping'))).resolves.toEqual({
      message: '배송을 시작했습니다.',
    });

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(ORDER_ID));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('resend 429'));
    errorLog.mockRestore();
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
      errors: { status: '허용된 주문 상태를 선택해주세요.' },
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
        trackingNumber: '운송장번호를 입력해주세요.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['발주확인', 'confirmed', '주문을 발주확인했습니다.'],
    ['배송완료', 'delivered', '배송완료로 변경했습니다.'],
  ])('%s 전이는 운송장 인자를 넘기지 않는다', async (_label, status, message) => {
    const formData = new FormData();
    formData.set('orderId', ORDER_ID);
    formData.set('status', status);

    await expect(updateAdminOrderStatusAction({}, formData)).resolves.toEqual({ message });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_order_status', {
      p_carrier: null,
      p_order_id: ORDER_ID,
      p_status: status,
      p_tracking_number: null,
    });
  });

  /* done은 자동 거래확정 잡이, paid는 결제 웹훅이 소유한다. 운영자 폼이 그 칸을
     밀면 소유권이 두 곳이 되고, 자동확정 전에 청약철회 창이 닫힌다(#250). */
  it.each([['결제완료', 'paid'], ['거래확정', 'done']])(
    '%s 로는 상태 RPC에 닿지 못한다',
    async (_label, status) => {
      const formData = new FormData();
      formData.set('orderId', ORDER_ID);
      formData.set('status', status);

      await expect(updateAdminOrderStatusAction({}, formData)).resolves.toEqual({
        errors: { status: '허용된 주문 상태를 선택해주세요.' },
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

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

  // 실패한 메일을 다시 보낼 경로가 없으면 구매자는 계약내용 서면(L4)을 영구히 못 받는다.
  describe('재발송', () => {
    function resendForm(dedupeKey: string) {
      const formData = new FormData();
      formData.set('dedupeKey', dedupeKey);
      return formData;
    }

    it('실패한 주문 확인 메일을 audited 게이트를 지나 다시 보낸다', async () => {
      await expect(
        resendOrderEmailAction({}, resendForm(`order_confirmation:${ORDER_ID}`)),
      ).resolves.toEqual({ message: '메일을 다시 보냈습니다.' });

      expect(mocks.rpc).toHaveBeenCalledWith('admin_request_email_resend', {
        p_dedupe_key: `order_confirmation:${ORDER_ID}`,
      });
      expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
      expect(mocks.sendShippedEmail).not.toHaveBeenCalled();
    });

    it('배송 시작 메일 재발송은 운송장을 발송 훅이 읽게 맡긴다', async () => {
      await expect(
        resendOrderEmailAction({}, resendForm(`order_shipped:${ORDER_ID}`)),
      ).resolves.toEqual({ message: '메일을 다시 보냈습니다.' });

      expect(mocks.sendShippedEmail).toHaveBeenCalledWith({ orderId: ORDER_ID });
      expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('이미 발송된 건은 DB 게이트에서 막히고 발송 훅에 닿지 않는다', async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'email_already_sent' } });

      const result = await resendOrderEmailAction({}, resendForm(`order_confirmation:${ORDER_ID}`));

      expect(result.errors?.form).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain('email_already_sent');
      expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('클레임이 거절되면 보냈다고 거짓 보고하지 않는다', async () => {
      mocks.sendConfirmationEmail.mockResolvedValue({
        status: 'skipped',
        reason: 'already_delivered',
      });

      const result = await resendOrderEmailAction({}, resendForm(`order_confirmation:${ORDER_ID}`));

      expect(result.message).toBeUndefined();
      expect(result.errors?.form).toBeTruthy();
    });

    it('형식을 벗어난 키는 DB에 닿기 전에 거절한다', async () => {
      for (const key of ['', 'order_confirmation:not-a-uuid', `unknown_template:${ORDER_ID}`]) {
        await expect(resendOrderEmailAction({}, resendForm(key))).resolves.toEqual({
          errors: { form: '다시 보낼 수 있는 메일이 아닙니다.' },
        });
      }
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('비staff는 앱과 DB 게이트 전에 차단한다', async () => {
      mocks.adminState = {
        isConfigured: true,
        user: { id: 'fan-1', email: 'fan@icons.gg' },
        role: 'user',
        isStaff: false,
      };

      await expect(
        resendOrderEmailAction({}, resendForm(`order_confirmation:${ORDER_ID}`)),
      ).resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
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

  it('진행 중인 결제 상태는 완료로 거짓 보고하지 않고 주문·재고 보존을 안내한다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'in_progress' });

    await expect(approveAdminOrderCancellationAction({}, requestForm())).resolves.toEqual({
      message: '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다. 최신 상태를 확인한 뒤 다시 시도하고, 상태가 계속되면 관리자 결제 담당자에게 결제사 원장 확인을 요청해주세요.',
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

  it('재정합화에서도 진행 중인 결제 상태를 needs_review 오류로 표시하지 않는다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'in_progress' });

    await expect(reconcileAdminOrderCancellationAction({}, requestForm())).resolves.toEqual({
      message: '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다. 최신 상태를 확인한 뒤 다시 시도하고, 상태가 계속되면 관리자 결제 담당자에게 결제사 원장 확인을 요청해주세요.',
    });
  });

  describe('Korpay 굿즈 수동 복구', () => {
    function cancellationForm(attestation = 'provider_cancel_confirmed') {
      const form = new FormData();
      form.set('attemptId', ATTEMPT_ID);
      form.set('requestId', REQUEST_ID);
      form.set('operatorAttestation', attestation);
      form.set('paymentKey', 'browser-must-not-control-this');
      return form;
    }

    it('취소 확인은 exact attestation과 opaque case만 전달한다', async () => {
      mocks.adminState.user = { id: ADMIN_ID, email: 'admin@icons.gg' };
      mocks.adminState.role = 'admin';
      mocks.recoverGoodsPayment.mockResolvedValue({ outcome: 'provider_cancel_confirmed' });

      await expect(recoverAdminGoodsPaymentAction({}, cancellationForm())).resolves.toEqual({
        message: 'Korpay 전액 취소 확인을 주문 정합화에 반영했습니다.',
      });

      expect(mocks.recoverGoodsPayment).toHaveBeenCalledWith({
        operation: 'provider_cancel_confirmed',
        attemptId: ATTEMPT_ID,
        actorId: ADMIN_ID,
        requestId: REQUEST_ID,
        operatorAttested: true,
      });
      expect(JSON.stringify(mocks.recoverGoodsPayment.mock.calls)).not.toContain(
        'browser-must-not-control-this',
      );
    });

    it('잘못된 attestation과 staff 계정은 deep module 전에 차단한다', async () => {
      mocks.adminState.user = { id: ADMIN_ID, email: 'admin@icons.gg' };
      mocks.adminState.role = 'admin';
      await expect(recoverAdminGoodsPaymentAction(
        {},
        cancellationForm('yes'),
      )).resolves.toEqual(expect.objectContaining({ errors: expect.any(Object) }));

      mocks.adminState = {
        isConfigured: true,
        user: { id: 'staff-1', email: 'staff@icons.gg' },
        role: 'staff',
        isStaff: true,
      };
      await expect(recoverAdminGoodsPaymentAction({}, cancellationForm())).resolves.toEqual({
        errors: { form: 'Korpay 수동 복구는 관리자 계정만 수행할 수 있습니다.' },
      });
      expect(mocks.recoverGoodsPayment).not.toHaveBeenCalled();
    });

    it('active lease와 repository 오류를 성공으로 거짓 보고하지 않는다', async () => {
      mocks.adminState.user = { id: ADMIN_ID, email: 'admin@icons.gg' };
      mocks.adminState.role = 'admin';
      mocks.recoverGoodsPayment.mockResolvedValueOnce({ outcome: 'in_progress' });
      await expect(recoverAdminGoodsPaymentAction({}, cancellationForm())).resolves.toEqual({
        errors: { form: '다른 운영 확인이 진행 중입니다. 잠시 뒤 최신 상태를 확인해주세요.' },
      });

      mocks.recoverGoodsPayment.mockRejectedValueOnce(new Error('private db detail'));
      const failed = await recoverAdminGoodsPaymentAction({}, cancellationForm());
      expect(failed.errors?.form).toBeTruthy();
      expect(JSON.stringify(failed)).not.toContain('private');
    });
  });

  /* 일괄 발주확인(#250) — 전이 규칙·클레임 검사·감사 로그는 전부 기존 RPC 안에
     있다. 이 액션은 선택 목록을 좁혀 건별로 그 RPC를 부르는 일만 한다. */
  describe('일괄 발주확인', () => {
    function bulkForm(...orderIds: string[]) {
      const formData = new FormData();
      for (const id of orderIds) formData.append('orderIds', id);
      return formData;
    }

    const SECOND_ORDER_ID = '22222222-2222-4222-8222-222222222222';

    it('선택한 주문마다 audited 상태 RPC를 confirmed로 부른다', async () => {
      await expect(bulkConfirmAdminOrdersAction({}, bulkForm(ORDER_ID, SECOND_ORDER_ID)))
        .resolves.toEqual({ message: '2건을 발주확인했습니다.' });

      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenCalledWith('admin_update_order_status', {
        p_carrier: null,
        p_order_id: ORDER_ID,
        p_status: 'confirmed',
        p_tracking_number: null,
      });
    });

    /* 한 건이 취소 클레임에 막혔다고 나머지 39건이 함께 실패하면, 운영자는 무엇이
       처리됐는지 모른 채 전부 다시 누른다. */
    it('한 건이 실패해도 나머지를 처리하고 건수를 함께 보고한다', async () => {
      mocks.rpc.mockImplementation(async (_fn: string, args: { p_order_id: string }) => (
        args.p_order_id === ORDER_ID
          ? { data: null, error: { message: 'order cancellation in progress' } }
          : { data: null, error: null }
      ));

      const state = await bulkConfirmAdminOrdersAction({}, bulkForm(ORDER_ID, SECOND_ORDER_ID));

      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(state.message).toContain('1건을 발주확인했습니다');
      /* 건수만으로는 100건 목록에서 남은 주문을 못 찾는다. 주문번호를 실어 보낸다. */
      expect(state.message).toContain('처리하지 못한 1건');
      expect(state.message).toContain('11111111');
    });

    it('전부 실패하면 성공 문구를 내보내지 않는다', async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid_order_transition' } });

      const state = await bulkConfirmAdminOrdersAction({}, bulkForm(ORDER_ID));

      expect(state.message).toBeUndefined();
      expect(state.errors?.form).toContain('발주확인하지 못했습니다');
    });

    /* 브라우저가 보낸 값은 그대로 RPC 인자가 된다. UUID가 아닌 값은 닿기 전에 버린다. */
    it('UUID가 아닌 선택값은 RPC에 닿기 전에 버린다', async () => {
      await expect(bulkConfirmAdminOrdersAction({}, bulkForm('not-a-uuid', '  ')))
        .resolves.toEqual({ errors: { form: '발주확인할 주문을 선택해주세요.' } });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('같은 주문이 두 번 실려도 한 번만 부른다', async () => {
      await bulkConfirmAdminOrdersAction({}, bulkForm(ORDER_ID, ORDER_ID.toUpperCase()));

      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    });

    /* 상한이 없으면 전체선택 한 번이 수백 건의 순차 RPC가 된다. */
    it('상한을 넘는 선택은 RPC를 시작하지도 않는다', async () => {
      const ids = Array.from({ length: 101 }, (_, index) => (
        `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
      ));

      const state = await bulkConfirmAdminOrdersAction({}, bulkForm(...ids));

      expect(state.errors?.form).toContain('100건까지');
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('스태프가 아니면 아무것도 부르지 않는다', async () => {
      mocks.adminState = {
        isConfigured: true,
        user: { id: 'fan-1', email: 'fan@icons.gg' },
        role: 'user',
        isStaff: false,
      };

      await expect(bulkConfirmAdminOrdersAction({}, bulkForm(ORDER_ID)))
        .resolves.toEqual({ errors: { form: '관리자 권한이 필요합니다.' } });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });
});
