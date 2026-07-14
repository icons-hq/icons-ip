import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  serviceConfigured: true,
  tossConfigured: true,
  user: { id: 'user-1' } as { id: string } | null,
  order: { id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c', user_id: 'user-1', status: 'paid' } as Record<string, unknown> | null,
  orderError: null as { message: string } | null,
  payments: [] as Array<{ id: string; status: 'pending' | 'paid'; payment_key: string | null }>,
  paymentsError: null as { message: string } | null,
  claimResult: null as { data: unknown; error: { message: string } | null } | null,
  cancelResult: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  orderEq: vi.fn(),
  paymentEq: vi.fn(),
  paymentIn: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: mocks.tossConfigured }),
  cancelTossPayment: mocks.cancel,
}));
vi.mock('@/lib/checkout', async () => await import('../../../../../lib/checkout'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.supabaseConfigured }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table !== 'payments') throw new Error(`Unexpected service table ${table}`);
      const query = {
        select: vi.fn(() => query),
        eq: mocks.paymentEq,
        in: mocks.paymentIn,
      };
      mocks.paymentEq.mockReturnValue(query);
      mocks.paymentIn.mockImplementation(async () => ({
        data: mocks.payments,
        error: mocks.paymentsError,
      }));
      return query;
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    const query = {
      select: vi.fn(() => query),
      eq: mocks.orderEq,
      maybeSingle: vi.fn(async () => ({ data: mocks.order, error: mocks.orderError })),
    };
    mocks.orderEq.mockReturnValue(query);
    return {
      auth: { getUser: async () => ({ data: { user: mocks.user } }) },
      from: (table: string) => {
        if (table !== 'orders') throw new Error(`Unexpected user table ${table}`);
        return query;
      },
    };
  },
}));

function request(origin = 'https://icons.local') {
  return new Request(`https://icons.local/api/orders/${ORDER_UUID}/cancel`, {
    method: 'POST',
    headers: { Origin: origin },
  });
}

function context(orderId = ORDER_UUID) {
  return { params: Promise.resolve({ orderId }) };
}

describe('POST /api/orders/[orderId]/cancel', () => {
  beforeEach(() => {
    mocks.supabaseConfigured = true;
    mocks.serviceConfigured = true;
    mocks.tossConfigured = true;
    mocks.user = { id: USER_ID };
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'paid' };
    mocks.orderError = null;
    mocks.payments = [];
    mocks.paymentsError = null;
    mocks.claimResult = null;
    mocks.cancelResult = { data: null, error: null };
    mocks.orderEq.mockReset();
    mocks.paymentEq.mockReset();
    mocks.paymentIn.mockReset();
    mocks.cancel.mockReset();
    mocks.rpc.mockReset();
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.rpc.mockImplementation(async (functionName: string) => {
      if (functionName === 'claim_order_cancellation') {
        if (mocks.claimResult) return mocks.claimResult;
        const status = mocks.order?.status;
        return {
          data: status === 'canceled' ? 'already_canceled' : status,
          error: null,
        };
      }
      return mocks.cancelResult;
    });
  });

  it('RouteContext params를 await하고 UUID를 소문자 canonical 형식으로 조회한다', async () => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'canceled' };

    const response = await POST(request(), context(ORDER_UUID.toUpperCase()));

    expect(response.status).toBe(200);
    expect(mocks.orderEq).toHaveBeenCalledWith('id', ORDER_UUID);
    expect(mocks.orderEq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('잘못된 UUID는 DB를 조회하지 않고 404로 숨긴다', async () => {
    const response = await POST(request(), context('not-a-uuid'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expect(mocks.orderEq).not.toHaveBeenCalled();
  });

  it('Supabase 또는 service role 환경이 없으면 fail closed한다', async () => {
    mocks.serviceConfigured = false;

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_configured' } });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('비로그인 요청은 401이고 provider와 RPC를 호출하지 않는다', async () => {
    mocks.user = null;

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'auth_required' } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('same-origin이 아닌 POST는 인증·provider·RPC 전에 403으로 차단한다', async () => {
    const response = await POST(request('https://attacker.example'), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'forbidden' } });
    expect(mocks.orderEq).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RLS와 user_id 조회에서 보이지 않는 주문은 404로 숨긴다', async () => {
    mocks.order = null;

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.orderEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('이미 canceled이고 active 결제가 없어도 provider 없이 local terminal 증거를 멱등 정합화한다', async () => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'canceled' };

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'already_canceled' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '사용자 주문 취소',
      p_provider_payment_keys: [],
    });
  });

  it('이미 canceled인 주문에 늦게 기록된 active 결제도 provider 취소 후 멱등 정합화한다', async () => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'canceled' };
    mocks.payments = [{ id: 'payment-late', status: 'pending', payment_key: 'pk_late' }];

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'already_canceled' });
    expect(mocks.cancel).toHaveBeenCalledWith('pk_late', '사용자 주문 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '사용자 주문 취소',
      p_provider_payment_keys: ['pk_late'],
    });
  });

  it.each(['shipping', 'done'])('%s 주문은 409이고 provider를 호출하지 않는다', async (status) => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status };

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_cancelable' } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { claim: 'not_found', status: 404, code: 'not_found' },
    { claim: 'not_cancelable', status: 409, code: 'not_cancelable' },
  ])('provider 호출 직전 claim 결과 $claim을 안전한 오류로 매핑한다', async ({ claim, status, code }) => {
    mocks.payments = [{ id: 'payment-1', status: 'paid', payment_key: 'pk_private' }];
    mocks.claimResult = { data: claim, error: null };

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'cancel_order_with_provider_evidence',
      expect.anything(),
    );
  });

  it('claim DB 오류와 예상하지 못한 결과는 provider 전에 일반화된 실패로 닫는다', async () => {
    mocks.payments = [{ id: 'payment-1', status: 'paid', payment_key: 'pk_private' }];
    mocks.claimResult = { data: null, error: { message: 'private claim raw' } };

    const failedClaim = await POST(request(), context());
    const failedBody = await failedClaim.json();

    expect(failedClaim.status).toBe(502);
    expect(failedBody).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(failedBody)).not.toContain('private');
    expect(mocks.cancel).not.toHaveBeenCalled();

    mocks.claimResult = { data: 'unexpected-private-state', error: null };
    const unexpectedClaim = await POST(request(), context());
    const unexpectedBody = await unexpectedClaim.json();

    expect(unexpectedClaim.status).toBe(502);
    expect(unexpectedBody).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(unexpectedBody)).not.toContain('unexpected-private-state');
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('active 결제가 없는 pending 주문은 Toss 설정 없이 empty evidence로 취소한다', async () => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'pending' };
    mocks.tossConfigured = false;

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'canceled' });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '사용자 주문 취소',
      p_provider_payment_keys: [],
    });
  });

  it('paid 주문도 active 증거가 없으면 empty evidence RPC가 DB에서 fail closed한다', async () => {
    mocks.cancelResult = { data: null, error: { message: 'paid order requires provider evidence: pk_private' } };

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(body)).not.toContain('pk_private');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_provider_payment_keys: [],
    }));
  });

  it('모든 active payment를 provider에서 전액 취소한 뒤 key 배열 전체를 RPC에 전달한다', async () => {
    mocks.payments = [
      { id: 'payment-1', status: 'pending', payment_key: 'pk_pending' },
      { id: 'payment-2', status: 'paid', payment_key: 'pk_paid' },
    ];

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.paymentEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.paymentEq).toHaveBeenCalledWith('purpose', 'order');
    expect(mocks.paymentEq).toHaveBeenCalledWith('ref_id', ORDER_UUID);
    expect(mocks.paymentIn).toHaveBeenCalledWith('status', ['pending', 'paid']);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'claim_order_cancellation', {
      p_order_id: ORDER_UUID,
      p_user_id: USER_ID,
    });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.cancel.mock.invocationCallOrder[0]);
    expect(mocks.cancel).toHaveBeenNthCalledWith(1, 'pk_pending', '사용자 주문 취소');
    expect(mocks.cancel).toHaveBeenNthCalledWith(2, 'pk_paid', '사용자 주문 취소');
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', {
      p_order_id: ORDER_UUID,
      p_reason: '사용자 주문 취소',
      p_provider_payment_keys: ['pk_pending', 'pk_paid'],
    });
  });

  it('active payment의 payment_key가 비어 있으면 provider와 RPC 모두 호출하지 않는다', async () => {
    mocks.payments = [{ id: 'payment-1', status: 'paid', payment_key: null }];

    const response = await POST(request(), context());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'payment_evidence_invalid' } });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('active provider 결제가 있을 때만 Toss 설정을 요구한다', async () => {
    mocks.tossConfigured = false;
    mocks.payments = [{ id: 'payment-1', status: 'paid', payment_key: 'pk_private' }];

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: { code: 'not_configured' } });
    expect(JSON.stringify(body)).not.toContain('pk_private');
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, status: 0, code: 'TIMEOUT', message: 'pk_timeout raw timeout' },
    { ok: false, status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: 'provider raw' },
    { ok: false, status: 400, code: 'NOT_CANCELABLE_AMOUNT', message: 'explicit raw' },
  ])('provider 취소 실패($code)는 RPC 없이 일반화된 오류만 응답한다', async (providerFailure) => {
    mocks.payments = [{ id: 'payment-1', status: 'paid', payment_key: 'pk_private' }];
    mocks.cancel.mockResolvedValue(providerFailure);

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: 'provider_cancel_failed' } });
    expect(JSON.stringify(body)).not.toContain(providerFailure.code);
    expect(JSON.stringify(body)).not.toContain(providerFailure.message);
    expect(JSON.stringify(body)).not.toContain('pk_private');
    expect(mocks.rpc).toHaveBeenCalledWith('claim_order_cancellation', {
      p_order_id: ORDER_UUID,
      p_user_id: USER_ID,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'cancel_order_with_provider_evidence',
      expect.anything(),
    );
  });

  it('여러 active payment 중 일부만 취소되면 로컬 RPC를 보류해 다음 요청에서 재시도할 수 있다', async () => {
    mocks.payments = [
      { id: 'payment-1', status: 'paid', payment_key: 'pk_first' },
      { id: 'payment-2', status: 'pending', payment_key: 'pk_second' },
    ];
    mocks.cancel
      .mockResolvedValueOnce({ ok: true, body: { status: 'CANCELED' } })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        code: 'FAILED_INTERNAL_SYSTEM_PROCESSING',
        message: 'provider raw',
      });

    const response = await POST(request(), context());

    expect(response.status).toBe(502);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('claim_order_cancellation', {
      p_order_id: ORDER_UUID,
      p_user_id: USER_ID,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'cancel_order_with_provider_evidence',
      expect.anything(),
    );
  });

  it('부분 성공 뒤 재시도는 이미 취소 응답을 성공으로 인정해 나머지 key와 로컬 상태를 정합화한다', async () => {
    mocks.payments = [
      { id: 'payment-1', status: 'paid', payment_key: 'pk_first' },
      { id: 'payment-2', status: 'pending', payment_key: 'pk_second' },
    ];
    mocks.cancel
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        code: 'ALREADY_CANCELED_PAYMENT',
        message: 'already canceled',
      })
      .mockResolvedValueOnce({ ok: true, body: { status: 'CANCELED' } });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_order_with_provider_evidence', expect.objectContaining({
      p_provider_payment_keys: ['pk_first', 'pk_second'],
    }));
  });

  it('DB 조회와 RPC의 원문·payment key는 응답에 노출하지 않는다', async () => {
    mocks.paymentsError = { message: 'private database pk_secret raw payload' };

    const lookupResponse = await POST(request(), context());
    const lookupBody = await lookupResponse.json();

    expect(lookupResponse.status).toBe(502);
    expect(lookupBody).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(lookupBody)).not.toContain('private');
    expect(JSON.stringify(lookupBody)).not.toContain('pk_secret');
  });
});
