import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const ORDER_ID = `order_${ORDER_UUID}`;
const TICKET_ORDER_ID = `ticket_${ORDER_UUID}`;

const mocks = vi.hoisted(() => ({
  reviewerAllowed: true,
  confirm: vi.fn(),
  cancel: vi.fn(),
  fetchPayment: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateEqFirst: vi.fn(),
  updateEqSecond: vi.fn(),
  updateEqThird: vi.fn(),
  userTable: null as string | null,
  target: {
    id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
    user_id: 'user-1',
    status: 'pending',
    total: 42000,
    expires_at: null,
  } as Record<string, unknown> | null,
}));

vi.mock('@/lib/payments/checkout-availability', () => ({
  checkoutPaymentsEnabled: () => mocks.reviewerAllowed,
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => ({
    isConfigured: true,
    user: { id: 'user-1', email: 'reviewer@example.com' },
    profile: null,
    isStaff: mocks.reviewerAllowed,
  }),
}));

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
    mocks.reviewerAllowed = true;
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
    mocks.updateEqThird.mockReset();
    mocks.userTable = null;
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.updateEqFirst });
    mocks.updateEqFirst.mockReturnValue({ eq: mocks.updateEqSecond });
    mocks.updateEqSecond.mockReturnValue({ eq: mocks.updateEqThird });
    mocks.updateEqThird.mockResolvedValue({ error: null });
    mocks.confirm.mockResolvedValue({ ok: true, body: approvedPayment() });
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.fetchPayment.mockResolvedValue({ ok: true, body: approvedPayment() });
    mocks.rpc.mockResolvedValue({ data: 'pending', error: null });
  });

  it('신규 Toss 굿즈 callback은 provider 호출 전에 영구 차단한다', async () => {
    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'legacy_checkout_closed',
        message: '기존 굿즈 결제 경로는 종료되었습니다.',
      },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('staff/admin 검토 권한이 없는 사용자의 production 테스트 승인을 거부한다', async () => {
    mocks.reviewerAllowed = false;

    const response = await POST(request(callbackBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'payment_unavailable', message: '현재 계정에서는 결제를 진행할 수 없습니다.' },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
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
    expect(mocks.updateEqFirst).toHaveBeenCalledWith('provider', 'toss');
    expect(mocks.updateEqSecond).toHaveBeenCalledWith('idempotency_key', 'pk_1');
    expect(mocks.updateEqThird).toHaveBeenCalledWith('status', 'pending');
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
    expect(mocks.updateEqFirst).toHaveBeenCalledWith('provider', 'toss');
    expect(mocks.updateEqSecond).toHaveBeenCalledWith('idempotency_key', 'pk_1');
    expect(mocks.updateEqThird).toHaveBeenCalledWith('status', 'pending');
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

});
