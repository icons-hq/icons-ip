import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const ORDER_ID = `order_${ORDER_UUID}`;
const TICKET_ORDER_ID = `ticket_${ORDER_UUID}`;

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  fetchPayment: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateEqFirst: vi.fn(),
  updateEqSecond: vi.fn(),
  userTable: null as string | null,
  target: {
    id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
    user_id: 'user-1',
    status: 'pending',
    total: 42000,
    expires_at: null,
  } as Record<string, unknown> | null,
}));

vi.mock('@/lib/payments/toss', async () => await import('../../../../lib/payments/toss'));
vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: true, secretKey: 'configured' }),
  confirmTossPayment: mocks.confirm,
  cancelTossPayment: mocks.cancel,
  fetchTossPayment: mocks.fetchPayment,
}));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: true }),
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table !== 'payments') throw new Error(`Unexpected service table ${table}`);
      return { upsert: mocks.upsert, update: mocks.update };
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: mocks.target, error: null })),
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => {
        if (table !== 'orders' && table !== 'ticket_orders') throw new Error(`Unexpected user table ${table}`);
        mocks.userTable = table;
        return query;
      },
    };
  },
}));

function request(body: Record<string, unknown>) {
  return new Request('https://icons.local/api/payments/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callbackBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paymentKey: 'pk_1',
    orderId: ORDER_ID,
    amount: 42000,
    paymentType: 'NORMAL',
    ...overrides,
  };
}

function approvedPayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: 'pk_1',
    orderId: ORDER_ID,
    status: 'DONE',
    totalAmount: 42000,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
    ...overrides,
  };
}

describe('POST /api/payments/confirm', () => {
  beforeEach(() => {
    mocks.target = {
      id: ORDER_UUID,
      user_id: 'user-1',
      status: 'pending',
      total: 42000,
      expires_at: null,
    };
    mocks.confirm.mockReset();
    mocks.cancel.mockReset();
    mocks.fetchPayment.mockReset();
    mocks.rpc.mockReset();
    mocks.upsert.mockReset();
    mocks.update.mockReset();
    mocks.updateEqFirst.mockReset();
    mocks.updateEqSecond.mockReset();
    mocks.userTable = null;
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.updateEqFirst });
    mocks.updateEqFirst.mockReturnValue({ eq: mocks.updateEqSecond });
    mocks.updateEqSecond.mockResolvedValue({ error: null });
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment() });
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: approvedPayment() });
    mocks.rpc.mockResolvedValue({ data: 'pending', error: null });
  });

  it.each([undefined, 'BRANDPAY'])('paymentType=%s 콜백은 NORMAL이 아니면 승인 전에 거부한다', async (paymentType) => {
    const body = callbackBody();
    if (paymentType === undefined) delete body.paymentType;
    else body.paymentType = paymentType;

    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_payment_type', message: '지원하지 않는 결제 유형입니다.' },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('승인 응답의 paymentKey·orderId·amount가 콜백과 다르면 pending을 기록하지 않는다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ orderId: `ticket_${ORDER_UUID}` }) });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'provider_response_mismatch',
        message: '결제 승인 결과를 확인하지 못했습니다. 고객센터에 문의해주세요.',
      },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('입금 전 가상계좌는 토스에서 취소한 뒤 주문과 재고를 즉시 원복한다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }) });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unsupported_payment_method_canceled',
        message: '지원하지 않는 결제수단이 취소되었습니다. 주문을 다시 생성해주세요.',
      },
    });
    expect(mocks.cancel).toHaveBeenCalledWith('pk_1', 'ICONS 미지원 가상계좌 자동 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '미지원 가상계좌 자동 취소',
      p_provider_payment_keys: ['pk_1'],
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', raw: approvedPayment({ status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }) }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('입금 전 티켓 가상계좌는 해당 paymentKey 증거만으로 예매를 정리한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: true,
      body: approvedPayment({
        orderId: TICKET_ORDER_ID,
        status: 'WAITING_FOR_DEPOSIT',
        method: '가상계좌',
      }),
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith('refund_ticket_order_with_provider_evidence', {
      p_ticket_order_id: ORDER_UUID,
      p_reason: '미지원 가상계좌 자동 취소',
      p_provider_payment_key: 'pk_1',
    });
  });

  it('가상계좌 취소 결과를 모르면 pending 증거와 재고를 보존해 재시도한다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }) });
    mocks.cancel.mockResolvedValue({ ok: false, status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: 'raw' });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('이미 취소된 입금 전 가상계좌도 로컬 주문을 멱등 원복한다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ status: 'WAITING_FOR_DEPOSIT', method: '가상계좌' }) });
    mocks.cancel.mockResolvedValue({ ok: false, status: 400, code: 'ALREADY_CANCELED_PAYMENT', message: 'already canceled' });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_provider_payment_keys: ['pk_1'],
    }));
  });

  it('입금 완료 가상계좌는 환불계좌 없이 자동 취소하지 않는다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ status: 'DONE', method: '가상계좌' }) });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(502);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('이미 승인된 계약 밖 결제도 pending 증거를 남기고 운영 오류로 fail closed한다', async () => {
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment({ currency: 'USD' }) });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unsupported_payment_contract',
        message: '지원하지 않는 결제 조건이 승인되었습니다. 고객센터에 문의해주세요.',
      },
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', raw: approvedPayment({ currency: 'USD' }) }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('검증된 NORMAL·KRW 승인만 pending으로 기록한다', async () => {
    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'approved' });
    expect(mocks.confirm).toHaveBeenCalledWith({
      paymentKey: 'pk_1',
      orderId: ORDER_ID,
      amount: 42000,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', raw: approvedPayment() }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });

  it('티켓 결제는 본인 ticket_orders 원장을 조회하고 전용 RPC로 선점한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: true,
      body: approvedPayment({ orderId: TICKET_ORDER_ID }),
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(200);
    expect(mocks.userTable).toBe('ticket_orders');
    expect(mocks.confirm).toHaveBeenCalledWith({
      paymentKey: 'pk_1',
      orderId: TICKET_ORDER_ID,
      amount: 42000,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_payment_approval', {
      p_user_id: 'user-1',
      p_ticket_order_id: ORDER_UUID,
      p_payment_key: 'pk_1',
      p_amount: 42000,
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('취소가 선점한 티켓 예매는 provider 승인을 호출하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'ticket cancellation in progress' },
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_payable', message: '결제할 수 없는 예매 상태입니다.' },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_payment_approval', {
      p_user_id: 'user-1',
      p_ticket_order_id: ORDER_UUID,
      p_payment_key: 'pk_1',
      p_amount: 42000,
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('티켓 결제 선점 RPC의 예기치 못한 실패는 내부 상세 없이 중단한다', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'private database detail' },
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({
      error: {
        code: 'payment_prepare_failed',
        message: '결제 준비 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
      },
    });
    expect(JSON.stringify(json)).not.toContain('private database detail');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('이미 확정된 티켓 결제 재시도는 provider를 재호출하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'already_confirmed', error: null });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'already_confirmed' });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('티켓 결제 placeholder를 provider 승인보다 먼저 원자적으로 선점한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: true,
      body: approvedPayment({ orderId: TICKET_ORDER_ID }),
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_payment_approval', {
      p_user_id: 'user-1',
      p_ticket_order_id: ORDER_UUID,
      p_payment_key: 'pk_1',
      p_amount: 42000,
    });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0]);
  });

  it('검증된 티켓 승인 응답으로 기존 pending placeholder의 raw를 갱신한다', async () => {
    const approved = approvedPayment({ orderId: TICKET_ORDER_ID });
    mocks.confirm.mockResolvedValue({ ok: true, body: approved });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ raw: approved });
    expect(mocks.updateEqFirst).toHaveBeenCalledWith('idempotency_key', 'pk_1');
    expect(mocks.updateEqSecond).toHaveBeenCalledWith('status', 'pending');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('provider가 명확히 거부한 티켓 결제는 placeholder를 failed로 전환한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'REJECT_CARD_COMPANY',
      message: 'provider raw message with internal detail',
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(mocks.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(mocks.updateEqFirst).toHaveBeenCalledWith('idempotency_key', 'pk_1');
    expect(mocks.updateEqSecond).toHaveBeenCalledWith('status', 'pending');
    expect(JSON.stringify(json)).not.toContain('provider raw message');
  });

  it('provider 승인 결과가 불확실하면 티켓 placeholder를 pending으로 유지한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'socket closed after request',
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(502);
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_payment_approval', expect.any(Object));
    expect(mocks.update).not.toHaveBeenCalledWith({ status: 'failed' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('provider 승인 응답의 정체성이 다르면 티켓 placeholder에 raw를 연결하지 않고 pending을 유지한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: true,
      body: approvedPayment({ orderId: ORDER_ID }),
    });

    const response = await POST(request(callbackBody({ orderId: TICKET_ORDER_ID })));

    expect(response.status).toBe(502);
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_payment_approval', expect.any(Object));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('승인 뒤 pending 증거 기록에 실패하면 성공으로 응답하지 않고 같은 paymentKey 재시도를 유도한다', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'private database detail' } });

    const response = await POST(request(callbackBody()));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({
      error: {
        code: 'payment_record_failed',
        message: '결제 승인 기록을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
      },
    });
    expect(JSON.stringify(json)).not.toContain('private database detail');
  });

  it('토스 승인 실패 원문을 응답에 노출하거나 failed 행으로 기록하지 않는다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'REJECT_CARD_COMPANY',
      message: 'provider raw message with internal detail',
    });

    const response = await POST(request(callbackBody()));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: 'payment_approval_failed',
        message: '결제를 승인하지 못했습니다. 결제 정보를 확인하고 다시 시도해주세요.',
      },
    });
    expect(JSON.stringify(json)).not.toContain('provider raw message');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('이미 승인된 재시도는 조회 응답까지 동일 계약으로 검증한 뒤 pending을 기록한다', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'ALREADY_PROCESSED_PAYMENT',
      message: 'already processed',
    });

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(200);
    expect(mocks.fetchPayment).toHaveBeenCalledWith('pk_1');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', raw: approvedPayment() }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  });
});
