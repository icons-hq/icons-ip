import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const OTHER_ORDER_UUID = 'c3f9b2d5-4e6f-407b-9c8d-0e1f2a3b4c5d';

interface ExistingPayment {
  id: string;
  provider: 'toss' | 'korpay';
  status: string;
  amount: number;
  purpose: 'order' | 'ticket';
  ref_id: string;
  payment_key: string | null;
  idempotency_key: string;
}

const mocks = vi.hoisted(() => ({
  fetchPayment: vi.fn(),
  cancel: vi.fn(),
  sendConfirmationEmail: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  updateEqFirst: vi.fn(),
  updateEqSecond: vi.fn(),
  updateEqThird: vi.fn(),
  upsert: vi.fn(),
  existingPayment: {
    id: 'payment-1',
    provider: 'toss',
    status: 'pending',
    amount: 42000,
    purpose: 'order',
    ref_id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
    payment_key: 'pk_virtual',
    idempotency_key: 'pk_virtual',
  } as ExistingPayment | null,
  paymentsByKey: null as Record<string, ExistingPayment | null> | null,
  confirmedTargetPayment: null as ExistingPayment | null,
  target: { user_id: 'user-1', status: 'pending', total: 42000 } as {
    user_id: string;
    status: string;
    total: number;
  } | null,
  reviewerProfile: { role: 'admin', suspended_at: null } as {
    role: string | null;
    suspended_at: string | null;
  } | null,
}));

vi.mock('@/lib/payments/checkout-availability', () => ({
  checkoutPaymentsEnabled: (reviewerAllowed: boolean) => reviewerAllowed,
}));

vi.mock('@/lib/email/transactional.server', () => ({
  sendOrderConfirmationEmail: mocks.sendConfirmationEmail,
}));

vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: true, secretKey: 'configured' }),
  fetchTossPayment: mocks.fetchPayment,
  cancelTossPayment: mocks.cancel,
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: true }),
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const filters = new Map<string, unknown>();
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          filters.set(column, value);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data: table === 'payments'
            ? mocks.paymentsByKey && typeof filters.get('idempotency_key') === 'string'
              ? mocks.paymentsByKey[filters.get('idempotency_key') as string] ?? null
              : filters.get('status') === 'paid' && filters.has('ref_id')
                ? mocks.confirmedTargetPayment
                : mocks.existingPayment
            : table === 'profiles'
              ? mocks.reviewerProfile
              : mocks.target,
          error: null,
        })),
      };
      if (table === 'payments') return { ...query, update: mocks.update, upsert: mocks.upsert };
      if (table === 'orders' || table === 'ticket_orders') return query;
      if (table === 'profiles') return query;
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function webhookRequest(paymentKey = 'pk_virtual') {
  return new Request('https://icons.local/api/webhooks/tosspayments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { paymentKey },
    }),
  });
}

function virtualAccountPayment(status: 'WAITING_FOR_DEPOSIT' | 'DONE') {
  return {
    paymentKey: 'pk_virtual',
    orderId: `order_${ORDER_UUID}`,
    status,
    totalAmount: 42000,
    type: 'NORMAL',
    currency: 'KRW',
    method: '가상계좌',
  };
}

function ticketPayment(status = 'pending'): ExistingPayment {
  return {
    id: 'payment-1',
    provider: 'toss',
    status,
    amount: 42000,
    purpose: 'ticket',
    ref_id: ORDER_UUID,
    payment_key: 'pk_virtual',
    idempotency_key: 'pk_virtual',
  };
}

function orderPayment(status = 'pending'): ExistingPayment {
  return {
    id: 'payment-1',
    provider: 'toss',
    status,
    amount: 42000,
    purpose: 'order',
    ref_id: ORDER_UUID,
    payment_key: 'pk_virtual',
    idempotency_key: 'pk_virtual',
  };
}

function paymentRecord(
  purpose: 'order' | 'ticket',
  status: string,
  paymentKey: string,
): ExistingPayment {
  return {
    ...(purpose === 'order' ? orderPayment(status) : ticketPayment(status)),
    payment_key: paymentKey,
    idempotency_key: paymentKey,
  };
}

function canceledTicketPayment(overrides: Record<string, unknown> = {}) {
  return {
    ...virtualAccountPayment('DONE'),
    orderId: `ticket_${ORDER_UUID}`,
    status: 'CANCELED',
    method: '카드',
    balanceAmount: 0,
    cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    ...overrides,
  };
}

describe('POST /api/webhooks/tosspayments virtual-account cleanup', () => {
  beforeEach(() => {
    mocks.fetchPayment.mockReset();
    mocks.cancel.mockReset();
    mocks.sendConfirmationEmail.mockReset();
    mocks.sendConfirmationEmail.mockResolvedValue({ status: 'sent' });
    mocks.rpc.mockReset();
    mocks.update.mockReset();
    mocks.updateEqFirst.mockReset();
    mocks.updateEqSecond.mockReset();
    mocks.updateEqThird.mockReset();
    mocks.upsert.mockReset();
    mocks.existingPayment = {
      id: 'payment-1',
      provider: 'toss',
      status: 'pending',
      amount: 42000,
      purpose: 'order',
      ref_id: ORDER_UUID,
      payment_key: 'pk_virtual',
      idempotency_key: 'pk_virtual',
    };
    mocks.paymentsByKey = null;
    mocks.confirmedTargetPayment = null;
    mocks.target = { user_id: 'user-1', status: 'pending', total: 42000 };
    mocks.reviewerProfile = { role: 'admin', suspended_at: null };
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.updateEqFirst });
    mocks.updateEqFirst.mockReturnValue({ eq: mocks.updateEqSecond });
    mocks.updateEqSecond.mockReturnValue({ eq: mocks.updateEqThird });
    mocks.updateEqThird.mockResolvedValue({ error: null });
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it('같은 payment key가 Korpay 원장에 속하면 Toss 조회·취소를 호출하지 않는다', async () => {
    mocks.existingPayment = { ...orderPayment(), provider: 'korpay' };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: virtualAccountPayment('WAITING_FOR_DEPOSIT'),
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'payment_provider_mismatch' },
    });
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('known Toss key도 local goods identity와 provider 조회가 다르면 변경하지 않는다', async () => {
    mocks.existingPayment = {
      ...orderPayment(),
      ref_id: '20000000-0000-4000-8000-000000000999',
    };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'legacy_payment_identity_mismatch' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('입금 전 가상계좌를 취소하고 pending 주문·결제 기록을 함께 닫는다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: virtualAccountPayment('WAITING_FOR_DEPOSIT') });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith('pk_virtual', 'ICONS 미지원 가상계좌 자동 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '미지원 가상계좌 자동 취소',
      p_provider_payment_keys: ['pk_virtual'],
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }));
  });

  it('토스 취소 결과가 불명확하면 재고를 복원하지 않고 웹훅 재시도를 요청한다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: virtualAccountPayment('WAITING_FOR_DEPOSIT') });
    mocks.cancel.mockResolvedValue({ ok: false, status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: 'raw' });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('provider 취소 뒤 terminal 기록이 실패하면 로컬을 원복하되 웹훅 재시도를 요청한다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: virtualAccountPayment('WAITING_FOR_DEPOSIT') });
    mocks.updateEqThird.mockResolvedValue({ error: { message: 'private database detail' } });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_provider_payment_keys: ['pk_virtual'],
    }));
  });

  it('입금 완료 가상계좌는 환불계좌 없이 자동 취소하지 않는다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: virtualAccountPayment('DONE') });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['가상계좌', { method: '가상계좌' }],
    ['BRANDPAY', { method: '카드', type: 'BRANDPAY' }],
    ['비원화', { method: '카드', currency: 'USD' }],
  ])('검토 권한 밖의 unsupported DONE %s도 확정 전에 provider와 로컬을 취소한다', async (_label, overrides) => {
    mocks.reviewerProfile = { role: 'user', suspended_at: null };
    const completed = { ...virtualAccountPayment('DONE'), ...overrides };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: completed });
    mocks.cancel.mockResolvedValue({
      ok: true,
      body: {
        ...completed,
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith('pk_virtual', 'ICONS 승인 계정 외 테스트 결제 자동 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_order_id: ORDER_UUID,
      p_provider_payment_keys: ['pk_virtual'],
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_order_payment', expect.anything());
  });

  it('DONE 티켓 결제는 티켓 확정 RPC로만 전달한다', async () => {
    mocks.existingPayment = ticketPayment();
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        orderId: `ticket_${ORDER_UUID}`,
        method: '카드',
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_ticket_payment', {
      p_idempotency_key: 'pk_virtual',
      p_ticket_order_id: ORDER_UUID,
      p_payment_key: 'pk_virtual',
      p_amount: 42000,
      p_raw: expect.objectContaining({ orderId: `ticket_${ORDER_UUID}`, status: 'DONE' }),
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_order_payment', expect.anything());
  });

  it('staff/admin 검토 권한 밖의 production 테스트 결제는 확정하지 않고 provider와 로컬 선점을 취소한다', async () => {
    mocks.reviewerProfile = { role: 'user', suspended_at: null };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), method: '카드' },
    });
    mocks.cancel.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        method: '카드',
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith('pk_virtual', 'ICONS 승인 계정 외 테스트 결제 자동 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_order_id: ORDER_UUID,
      p_provider_payment_keys: ['pk_virtual'],
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_order_payment', expect.anything());
  });

  it.each([
    ['상품 주문', 'order', orderPayment('paid')],
    ['티켓 주문', 'ticket', ticketPayment('paid')],
  ] as const)('이미 확정된 %s의 duplicate DONE은 현재 권한이 바뀌어도 취소하지 않는다', async (
    _label,
    purpose,
    existingPayment,
  ) => {
    mocks.reviewerProfile = { role: 'user', suspended_at: null };
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.existingPayment = existingPayment;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        orderId: `${purpose}_${ORDER_UUID}`,
        method: '카드',
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      purpose === 'order' ? 'confirm_order_payment' : 'confirm_ticket_payment',
      expect.objectContaining({ p_payment_key: 'pk_virtual' }),
    );
  });

  it.each([
    ['티켓 주문', 'ticket', ticketPayment('paid')],
  ] as const)('이미 확정된 %s에 들어온 다른 결제는 provider만 취소하고 기존 target을 보존한다', async (
    _label,
    purpose,
    confirmedPayment,
  ) => {
    const secondPayment = {
      ...virtualAccountPayment('DONE'),
      paymentKey: 'pk_second',
      orderId: `${purpose}_${ORDER_UUID}`,
      method: '카드',
    };
    mocks.reviewerProfile = { role: 'admin', suspended_at: null };
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.paymentsByKey = {
      pk_virtual: confirmedPayment,
      pk_second: null,
    };
    mocks.confirmedTargetPayment = confirmedPayment;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: secondPayment,
    });
    mocks.cancel.mockResolvedValue({
      ok: true,
      body: {
        ...secondPayment,
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
      },
    });

    const response = await POST(webhookRequest('pk_second'));

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(
      'pk_second',
      'ICONS 승인 계정 외 테스트 결제 자동 취소',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'canceled',
        purpose,
        ref_id: ORDER_UUID,
        payment_key: 'pk_second',
      }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it.each([
    ['상품 주문', 'order'],
    ['티켓 주문', 'ticket'],
  ] as const)('provider-only DONE 뒤 후속 CANCELED인 %s의 기존 target을 보존한다', async (
    _label,
    purpose,
  ) => {
    const confirmedPayment = paymentRecord(purpose, 'paid', 'pk_virtual');
    const canceledSecondPayment = {
      ...virtualAccountPayment('DONE'),
      paymentKey: 'pk_second',
      orderId: `${purpose}_${ORDER_UUID}`,
      method: '카드',
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    };
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.confirmedTargetPayment = confirmedPayment;
    mocks.paymentsByKey = {
      pk_virtual: confirmedPayment,
      pk_second: paymentRecord(purpose, 'canceled', 'pk_second'),
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledSecondPayment });

    const response = await POST(webhookRequest('pk_second'));

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['상품 주문', 'order'],
    ['티켓 주문', 'ticket'],
  ] as const)('local failed인 추가 결제의 CANCELED도 %s의 기존 target을 보존한다', async (
    _label,
    purpose,
  ) => {
    const confirmedPayment = paymentRecord(purpose, 'paid', 'pk_virtual');
    const failedSecondPayment = paymentRecord(purpose, 'failed', 'pk_second');
    const canceledSecondPayment = {
      ...virtualAccountPayment('DONE'),
      paymentKey: 'pk_second',
      orderId: `${purpose}_${ORDER_UUID}`,
      method: '카드',
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    };
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.confirmedTargetPayment = confirmedPayment;
    mocks.paymentsByKey = {
      pk_virtual: confirmedPayment,
      pk_second: failedSecondPayment,
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledSecondPayment });

    const response = await POST(webhookRequest('pk_second'));

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }));
    expect(mocks.updateEqThird).toHaveBeenCalledWith('status', 'failed');
  });

  it.each([
    ['티켓 주문', 'ticket'],
  ] as const)('terminal 기록 실패 뒤 fresh CANCELED로 재시도한 %s의 기존 target을 보존한다', async (
    _label,
    purpose,
  ) => {
    const confirmedPayment = paymentRecord(purpose, 'paid', 'pk_virtual');
    const canceledSecondPayment = {
      ...virtualAccountPayment('DONE'),
      paymentKey: 'pk_second',
      orderId: `${purpose}_${ORDER_UUID}`,
      method: '카드',
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    };
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.confirmedTargetPayment = confirmedPayment;
    mocks.paymentsByKey = {
      pk_virtual: confirmedPayment,
      pk_second: null,
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledSecondPayment });

    const response = await POST(webhookRequest('pk_second'));

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'canceled',
        purpose,
        payment_key: 'pk_second',
      }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('검토 권한 밖 결제가 provider에서 이미 취소됐어도 fresh GET 뒤 로컬 선점을 원복한다', async () => {
    mocks.reviewerProfile = { role: 'admin', suspended_at: '2026-07-22T00:00:00.000Z' };
    mocks.fetchPayment
      .mockResolvedValueOnce({
        ok: true,
        body: { ...virtualAccountPayment('DONE'), method: '카드' },
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          ...virtualAccountPayment('DONE'),
          method: '카드',
          status: 'CANCELED',
          balanceAmount: 0,
          cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
        },
      });
    mocks.cancel.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'ALREADY_CANCELED_PAYMENT',
      message: 'already canceled',
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.fetchPayment).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_order_id: ORDER_UUID,
      p_provider_payment_keys: ['pk_virtual'],
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_order_payment', expect.anything());
  });

  it('검토 권한 밖 결제의 취소 응답이 원 결제와 다르면 로컬 선점을 원복하지 않는다', async () => {
    mocks.reviewerProfile = { role: 'user', suspended_at: null };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), method: '카드' },
    });
    mocks.cancel.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        paymentKey: 'different-provider-key',
        method: '카드',
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'auto_cancel_verification_failed' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('fresh GET이 webhook event와 다른 paymentKey를 반환하면 로컬 mutation 없이 fail closed한다', async () => {
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        paymentKey: 'different-provider-key',
        status: 'CANCELED',
        method: '카드',
      },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'provider_response_mismatch' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['partial balance', canceledTicketPayment({
      balanceAmount: 21000,
      cancels: [{ cancelAmount: 21000, cancelStatus: 'DONE' }],
    }), 500, 'ticket_cancel_evidence_invalid'],
    ['malformed cancellation', canceledTicketPayment({ balanceAmount: undefined, cancels: undefined }), 500, 'ticket_cancel_evidence_invalid'],
    ['amount mismatch', canceledTicketPayment({
      totalAmount: 41000,
      cancels: [{ cancelAmount: 41000, cancelStatus: 'DONE' }],
    }), 409, 'legacy_payment_identity_mismatch'],
    ['order mismatch', canceledTicketPayment({ orderId: `ticket_${OTHER_ORDER_UUID}` }), 409, 'legacy_payment_identity_mismatch'],
    ['unsupported contract', canceledTicketPayment({ currency: 'USD' }), 500, 'ticket_cancel_evidence_invalid'],
    ['incomplete cancellation item', canceledTicketPayment({
      cancels: [{ cancelAmount: 42000, cancelStatus: 'PENDING' }],
    }), 500, 'ticket_cancel_evidence_invalid'],
  ] as const)('%s CANCELED 티켓 raw는 wrapper 호출 전에 차단한다', async (
    _label,
    providerRaw,
    expectedStatus,
    expectedCode,
  ) => {
    mocks.existingPayment = ticketPayment();
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const response = await POST(webhookRequest());
    const json = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(json).toEqual({ error: { code: expectedCode } });
    expect(JSON.stringify(json)).not.toMatch(/pk_virtual|payment-1|private/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('로컬 티켓 payment metadata와 금액이 어긋나면 wrapper 전에 차단한다', async () => {
    mocks.existingPayment = { ...ticketPayment(), amount: 41000 };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledTicketPayment() });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'legacy_payment_identity_mismatch' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('로컬 payment 행이 없어도 malformed CANCELED 티켓 raw를 terminal 행으로 복구하지 않는다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: canceledTicketPayment({ balanceAmount: undefined, cancels: undefined }),
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('CANCELED 웹훅의 local pending 기록 갱신이 실패하면 재시도를 요청한다', async () => {
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: {
        ...virtualAccountPayment('DONE'),
        status: 'CANCELED',
        method: '카드',
      },
    });
    mocks.updateEqThird.mockResolvedValue({ error: { message: 'private database detail' } });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_keys: ['pk_virtual'],
    });
  });

  it('unknown Toss 굿즈 webhook은 provider 조회 뒤에도 로컬 원장을 만들지 않는다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: 'legacy_payment_unknown' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('unknown_compatibility는 전환 중인 ticket webhook에만 남긴다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledTicketPayment() });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', expect.objectContaining({
      p_ticket_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_key: 'pk_virtual',
    }));
  });

  it('CANCELED 웹훅의 terminal 증거 복구가 실패하면 로컬 취소 RPC를 호출하지 않는다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledTicketPayment() });
    mocks.upsert.mockResolvedValue({ error: { message: 'private database detail' } });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: 'terminal_record_failed' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('terminal 결제 행이 먼저 canceled가 됐어도 pending 주문 원복을 재시도한다', async () => {
    mocks.existingPayment = orderPayment('canceled');
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_keys: ['pk_virtual'],
    });
  });

  it('local failed 결제도 verified CANCELED key로 paid 주문을 terminal 상태에 수렴시킨다', async () => {
    mocks.existingPayment = orderPayment('failed');
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_keys: ['pk_virtual'],
    });
  });

  it('local failed 결제도 verified CANCELED key로 paid 티켓을 terminal 상태에 수렴시킨다', async () => {
    mocks.existingPayment = ticketPayment('failed');
    mocks.target = { user_id: 'user-1', status: 'paid', total: 42000 };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledTicketPayment() });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', {
      p_ticket_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_key: 'pk_virtual',
      p_provider_raw: expect.objectContaining({ status: 'CANCELED' }),
      p_refund_confirmed: true,
    });
  });

  it('CANCELED 웹훅은 이미 canceled인 상품 주문의 늦은 결제·환불 정합화도 재시도한다', async () => {
    mocks.existingPayment = orderPayment('canceled');
    mocks.target = { user_id: 'user-1', status: 'canceled', total: 42000 };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_keys: ['pk_virtual'],
    });
  });

  it('이미 canceled인 티켓 주문도 늦은 결제 취소 증거를 멱등 정합화한다', async () => {
    mocks.existingPayment = ticketPayment('canceled');
    mocks.target = { user_id: 'user-1', status: 'canceled', total: 42000 };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: canceledTicketPayment(),
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', {
      p_ticket_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_key: 'pk_virtual',
      p_provider_raw: expect.objectContaining({
        orderId: `ticket_${ORDER_UUID}`,
        status: 'CANCELED',
      }),
      p_refund_confirmed: true,
    });
  });

  it('CANCELED 티켓 결제는 pending 예매를 티켓 환불 RPC로 닫는다', async () => {
    mocks.existingPayment = ticketPayment();
    const providerRaw = {
      ...virtualAccountPayment('DONE'),
      orderId: `ticket_${ORDER_UUID}`,
      status: 'CANCELED',
      method: '카드',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
      privateProviderTrace: 'must-not-leak',
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const response = await POST(webhookRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', {
      p_ticket_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_key: 'pk_virtual',
      p_provider_raw: providerRaw,
      p_refund_confirmed: true,
    });
    expect(JSON.stringify(json)).not.toMatch(/must-not-leak|pk_virtual/);
  });

  it.each([
    ['paid', 'paid'],
    ['refunded', 'canceled'],
  ])('기존 %s 티켓 결제도 fresh CANCELED raw를 환불 증거로 저장한다', async (paymentStatus, orderStatus) => {
    mocks.existingPayment = ticketPayment(paymentStatus);
    mocks.target = { user_id: 'user-1', status: orderStatus, total: 42000 };
    const providerRaw = {
      ...virtualAccountPayment('DONE'),
      orderId: `ticket_${ORDER_UUID}`,
      status: 'CANCELED',
      method: '카드',
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', {
      p_ticket_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_key: 'pk_virtual',
      p_provider_raw: providerRaw,
      p_refund_confirmed: true,
    });
  });

  function confirmedCardPayment(purpose: 'order' | 'ticket' = 'order') {
    return {
      ...virtualAccountPayment('DONE'),
      orderId: `${purpose}_${ORDER_UUID}`,
      method: '카드',
    };
  }

  it('주문 확정에 성공하면 확인 메일 훅을 1회 호출한다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: confirmedCardPayment() });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_order_payment', expect.objectContaining({
      p_order_id: ORDER_UUID,
    }));
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendConfirmationEmail).toHaveBeenCalledWith(ORDER_UUID);
  });

  it('확인 메일 발송이 실패해도 주문 확정 응답은 200을 유지한다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: confirmedCardPayment() });
    mocks.sendConfirmationEmail.mockResolvedValue({ status: 'failed', error: 'provider responded 500' });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('티켓 확정에는 굿즈 주문 확인 메일을 보내지 않는다', async () => {
    mocks.existingPayment = ticketPayment();
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: confirmedCardPayment('ticket') });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['가상계좌', '가상계좌', true],
    ['미승인', null, false],
  ])('%s CANCELED 티켓 결제는 로컬 mutation 없이 fail closed한다', async (_label, method, hasExisting) => {
    mocks.existingPayment = hasExisting ? ticketPayment() : null;
    const providerRaw = {
      ...virtualAccountPayment('DONE'),
      orderId: `ticket_${ORDER_UUID}`,
      status: 'CANCELED',
      method,
      balanceAmount: 0,
      cancels: [{ cancelAmount: 42000, cancelStatus: 'DONE' }],
    };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const response = await POST(webhookRequest());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: { code: 'unsupported_ticket_payment_method' } });
    expect(JSON.stringify(json)).not.toContain('pk_virtual');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
