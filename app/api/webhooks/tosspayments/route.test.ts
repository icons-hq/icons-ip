import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const OTHER_ORDER_UUID = 'c3f9b2d5-4e6f-407b-9c8d-0e1f2a3b4c5d';

interface ExistingPayment {
  id: string;
  status: string;
  amount: number;
  purpose: 'order' | 'ticket';
  ref_id: string;
  payment_key: string | null;
  idempotency_key: string;
}

const mocks = vi.hoisted(() => ({
  reviewerAllowed: true,
  fetchPayment: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  updateEqFirst: vi.fn(),
  updateEqSecond: vi.fn(),
  upsert: vi.fn(),
  existingPayment: {
    id: 'payment-1',
    status: 'pending',
    amount: 42000,
    purpose: 'order',
    ref_id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
    payment_key: 'pk_virtual',
    idempotency_key: 'pk_virtual',
  } as ExistingPayment | null,
  target: { user_id: 'user-1', status: 'pending', total: 42000 } as {
    user_id: string;
    status: string;
    total: number;
  } | null,
}));

vi.mock('@/lib/payments/checkout-availability', () => ({
  checkoutPaymentsEnabled: () => mocks.reviewerAllowed,
}));

vi.mock('@/lib/payments/toss', async () => await import('../../../../lib/payments/toss'));
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
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: table === 'payments' ? mocks.existingPayment : mocks.target,
          error: null,
        })),
      };
      if (table === 'payments') return { ...query, update: mocks.update, upsert: mocks.upsert };
      if (table === 'orders' || table === 'ticket_orders') return query;
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function webhookRequest() {
  return new Request('https://icons.local/api/webhooks/tosspayments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { paymentKey: 'pk_virtual' },
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
    status,
    amount: 42000,
    purpose: 'order',
    ref_id: ORDER_UUID,
    payment_key: 'pk_virtual',
    idempotency_key: 'pk_virtual',
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
    mocks.reviewerAllowed = true;
    mocks.fetchPayment.mockReset();
    mocks.cancel.mockReset();
    mocks.rpc.mockReset();
    mocks.update.mockReset();
    mocks.updateEqFirst.mockReset();
    mocks.updateEqSecond.mockReset();
    mocks.upsert.mockReset();
    mocks.existingPayment = {
      id: 'payment-1',
      status: 'pending',
      amount: 42000,
      purpose: 'order',
      ref_id: ORDER_UUID,
      payment_key: 'pk_virtual',
      idempotency_key: 'pk_virtual',
    };
    mocks.target = { user_id: 'user-1', status: 'pending', total: 42000 };
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.updateEqFirst });
    mocks.updateEqFirst.mockReturnValue({ eq: mocks.updateEqSecond });
    mocks.updateEqSecond.mockResolvedValue({ error: null });
    mocks.upsert.mockResolvedValue({ error: null });
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
    mocks.updateEqSecond.mockResolvedValue({ error: { message: 'private database detail' } });

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

  it('DONE 티켓 결제는 티켓 확정 RPC로만 전달한다', async () => {
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

  it('승인 계정 밖의 production 테스트 결제는 확정하지 않고 provider와 로컬 선점을 취소한다', async () => {
    mocks.reviewerAllowed = false;
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
    })],
    ['malformed cancellation', canceledTicketPayment({ balanceAmount: undefined, cancels: undefined })],
    ['amount mismatch', canceledTicketPayment({
      totalAmount: 41000,
      cancels: [{ cancelAmount: 41000, cancelStatus: 'DONE' }],
    })],
    ['order mismatch', canceledTicketPayment({ orderId: `ticket_${OTHER_ORDER_UUID}` })],
    ['unsupported contract', canceledTicketPayment({ currency: 'USD' })],
    ['incomplete cancellation item', canceledTicketPayment({
      cancels: [{ cancelAmount: 42000, cancelStatus: 'PENDING' }],
    })],
  ])('%s CANCELED 티켓 raw는 wrapper 호출 전에 차단한다', async (_label, providerRaw) => {
    mocks.existingPayment = ticketPayment();
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const response = await POST(webhookRequest());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: { code: 'ticket_cancel_evidence_invalid' } });
    expect(JSON.stringify(json)).not.toMatch(/pk_virtual|payment-1|private/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('로컬 티켓 payment metadata와 금액이 어긋나면 wrapper 전에 차단한다', async () => {
    mocks.existingPayment = { ...ticketPayment(), amount: 41000 };
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: canceledTicketPayment() });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
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
    mocks.updateEqSecond.mockResolvedValue({ error: { message: 'private database detail' } });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
      p_provider_payment_keys: ['pk_virtual'],
    });
  });

  it('CANCELED 웹훅은 결제 행이 없어도 대상 주문을 닫고 terminal 증거를 복구한다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_provider_payment_keys: ['pk_virtual'],
    }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', ref_id: ORDER_UUID }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it('CANCELED 웹훅의 terminal 증거 복구가 실패하면 로컬 취소 RPC를 호출하지 않는다', async () => {
    mocks.existingPayment = null;
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED', method: '카드' },
    });
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
