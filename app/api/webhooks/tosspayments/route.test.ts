import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const mocks = vi.hoisted(() => ({
  fetchPayment: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  updateEqFirst: vi.fn(),
  updateEqSecond: vi.fn(),
  upsert: vi.fn(),
  existingPayment: { id: 'payment-1', status: 'pending' } as { id: string; status: string } | null,
  target: { user_id: 'user-1', status: 'pending' } as { user_id: string; status: string } | null,
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

describe('POST /api/webhooks/tosspayments virtual-account cleanup', () => {
  beforeEach(() => {
    mocks.fetchPayment.mockReset();
    mocks.cancel.mockReset();
    mocks.rpc.mockReset();
    mocks.update.mockReset();
    mocks.updateEqFirst.mockReset();
    mocks.updateEqSecond.mockReset();
    mocks.upsert.mockReset();
    mocks.existingPayment = { id: 'payment-1', status: 'pending' };
    mocks.target = { user_id: 'user-1', status: 'pending' };
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
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order', {
      p_order_id: ORDER_UUID,
      p_reason: '미지원 가상계좌 자동 취소',
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
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order', expect.any(Object));
  });

  it('입금 완료 가상계좌는 환불계좌 없이 자동 취소하지 않는다', async () => {
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: virtualAccountPayment('DONE') });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(500);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
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
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
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
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order', expect.any(Object));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', ref_id: ORDER_UUID }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('terminal 결제 행이 먼저 canceled가 됐어도 pending 주문 원복을 재시도한다', async () => {
    mocks.existingPayment = { id: 'payment-1', status: 'canceled' };
    mocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: { ...virtualAccountPayment('DONE'), status: 'CANCELED' },
    });

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order', {
      p_order_id: ORDER_UUID,
      p_reason: '토스 결제 취소 웹훅 반영',
    });
  });
});
