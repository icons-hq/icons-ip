import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  serviceConfigured: true,
  user: { id: 'user-1' } as { id: string } | null,
  order: {
    id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
    user_id: 'user-1',
    status: 'paid',
  } as Record<string, unknown> | null,
  orderError: null as { message: string } | null,
  orderEq: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: true }),
  cancelTossPayment: mocks.cancel,
}));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.supabaseConfigured }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: () => ({ rpc: mocks.rpc }),
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

function request(origin = 'https://icons.local', body?: unknown) {
  return new Request(`https://icons.local/api/orders/${ORDER_UUID}/cancel`, {
    method: 'POST',
    headers: { Origin: origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function context(orderId = ORDER_UUID) {
  return { params: Promise.resolve({ orderId }) };
}

describe('POST /api/orders/[orderId]/cancel', () => {
  beforeEach(() => {
    mocks.supabaseConfigured = true;
    mocks.serviceConfigured = true;
    mocks.user = { id: USER_ID };
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'paid' };
    mocks.orderError = null;
    mocks.orderEq.mockReset();
    mocks.cancel.mockReset();
    mocks.rpc.mockReset();
    mocks.cancel.mockResolvedValue({ ok: true, body: { status: 'CANCELED' } });
    mocks.rpc.mockResolvedValue({ data: 'requested', error: null });
  });

  it('RouteContext params를 await하고 canonical UUID와 본인 user_id로 조회한다', async () => {
    const response = await POST(request(), context(ORDER_UUID.toUpperCase()));

    expect(response.status).toBe(202);
    expect(mocks.orderEq).toHaveBeenCalledWith('id', ORDER_UUID);
    expect(mocks.orderEq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('same-origin이 아닌 요청은 인증과 쓰기 전에 차단한다', async () => {
    const response = await POST(request('https://attacker.example'), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'forbidden' } });
    expect(mocks.orderEq).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
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
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비로그인 요청은 401이고 요청 RPC를 호출하지 않는다', async () => {
    mocks.user = null;

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'auth_required' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RLS와 user_id 조회에서 보이지 않는 주문은 404로 숨긴다', async () => {
    mocks.order = null;

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.orderEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('주문 조회 실패 원문을 숨기고 fail closed한다', async () => {
    mocks.orderError = { message: 'private database failure' };

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(body)).not.toContain('private');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('유료 주문은 provider 식별자 없이 취소 요청만 생성한다', async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'requested' });
    expect(mocks.rpc).toHaveBeenCalledWith('request_order_cancellation', {
      p_order_id: ORDER_UUID,
      p_reason: '사용자 주문 취소',
      p_reason_type: 'change_of_mind',
      p_user_id: USER_ID,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('paymentKey');
  });

  it('하자·오배송 사유를 RPC에 그대로 전달한다', async () => {
    const response = await POST(
      request('https://icons.local', { reasonType: 'defect' }),
      context(),
    );

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith('request_order_cancellation', {
      p_order_id: ORDER_UUID,
      p_reason: '상품 하자·오배송',
      p_reason_type: 'defect',
      p_user_id: USER_ID,
    });
  });

  it('사유를 명시하지 않으면 기한이 가장 짧은 단순 변심으로 처리한다', async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'request_order_cancellation',
      expect.objectContaining({ p_reason_type: 'change_of_mind' }),
    );
  });

  it('허용되지 않은 사유는 RPC를 호출하지 않고 400으로 막는다', async () => {
    const response = await POST(
      request('https://icons.local', { reasonType: 'free_refund' }),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_reason_type' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('기한이 지난 요청을 409로 구분해 응답한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'deadline_expired', error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: 'deadline_expired' } });
  });

  it('결제 없는 pending 주문의 자동 완료를 canceled로 응답한다', async () => {
    mocks.order = { id: ORDER_UUID, user_id: USER_ID, status: 'pending' };
    mocks.rpc.mockResolvedValue({ data: 'completed', error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'canceled' });
  });

  it.each([
    ['already_requested', 200, 'requested'],
    ['already_canceled', 200, 'already_canceled'],
  ])('멱등 결과 %s를 안전한 상태로 응답한다', async (rpcResult, status, responseStatus) => {
    mocks.rpc.mockResolvedValue({ data: rpcResult, error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ status: responseStatus });
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['not_cancelable', 409, 'not_cancelable'],
  ])('RPC 결과 %s를 노출 없는 HTTP 오류로 매핑한다', async (rpcResult, status, code) => {
    mocks.rpc.mockResolvedValue({ data: rpcResult, error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it('RPC 오류와 예상하지 못한 결과는 내부 원문 없이 일반화한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private rpc failure' } });
    const failed = await POST(request(), context());
    const failedBody = await failed.json();

    expect(failed.status).toBe(502);
    expect(failedBody).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(failedBody)).not.toContain('private');

    mocks.rpc.mockResolvedValue({ data: 'provider_private_state', error: null });
    const unexpected = await POST(request(), context());
    const unexpectedBody = await unexpected.json();

    expect(unexpected.status).toBe(502);
    expect(unexpectedBody).toEqual({ error: { code: 'cancel_failed' } });
    expect(JSON.stringify(unexpectedBody)).not.toContain('provider_private_state');
  });
});
