import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { POST } from './route';

const TICKET_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  serviceConfigured: true,
  tossConfigured: true,
  auth: null as CurrentAuthState | null,
  order: {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: '33333333-3333-4333-8333-333333333333',
    status: 'paid',
  } as Record<string, unknown> | null,
  orderError: null as { message: string } | null,
  orderEq: vi.fn(),
  rpc: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', async () => await import('../../../../../lib/auth/onboarding'));
vi.mock('@/lib/ticketing', async () => await import('../../../../../lib/ticketing'));
vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: mocks.tossConfigured }),
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
      from: (table: string) => {
        if (table !== 'ticket_orders') throw new Error(`Unexpected user table ${table}`);
        return query;
      },
    };
  },
}));
vi.mock('@/lib/ticketing/cancellation-orchestrator.server', () => ({
  reconcileTicketCancellation: mocks.reconcile,
}));

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function request(origin = 'https://icons.local') {
  return new Request(`https://icons.local/api/ticket-orders/${TICKET_ORDER_ID}/cancel`, {
    method: 'POST',
    headers: { Origin: origin },
  });
}

function context(ticketOrderId = TICKET_ORDER_ID) {
  return { params: Promise.resolve({ ticketOrderId }) };
}

function requestResult(result: string, requestId: string | null = REQUEST_ID) {
  return [{ request_id: requestId, result }];
}

describe('POST /api/ticket-orders/[ticketOrderId]/cancel', () => {
  beforeEach(() => {
    mocks.supabaseConfigured = true;
    mocks.serviceConfigured = true;
    mocks.tossConfigured = true;
    mocks.auth = onboardedAuth();
    mocks.order = { id: TICKET_ORDER_ID, user_id: USER_ID, status: 'paid' };
    mocks.orderError = null;
    mocks.orderEq.mockReset();
    mocks.rpc.mockReset();
    mocks.reconcile.mockReset();
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'request_ticket_cancellation') {
        return { data: requestResult('requested'), error: null };
      }
      if (name === 'begin_ticket_cancellation_reconcile') {
        return { data: 'processing', error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.reconcile.mockResolvedValue({ ok: true, status: 'completed' });
  });

  it('canonical UUID·본인 소유권·온보딩을 확인하고 browser provider 입력 없이 정합화한다', async () => {
    const response = await POST(request(), context(TICKET_ORDER_ID.toUpperCase()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'canceled' });
    expect(mocks.orderEq).toHaveBeenCalledWith('id', TICKET_ORDER_ID);
    expect(mocks.orderEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mocks.rpc).toHaveBeenCalledWith('request_ticket_cancellation', {
      p_ticket_order_id: TICKET_ORDER_ID,
      p_user_id: USER_ID,
    });
    const beginCall = mocks.rpc.mock.calls.find(([name]) => name === 'begin_ticket_cancellation_reconcile');
    expect(beginCall).toEqual([
      'begin_ticket_cancellation_reconcile',
      {
        p_request_id: REQUEST_ID,
        p_user_id: USER_ID,
        p_attempt_token: expect.any(String),
      },
    ]);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      userId: USER_ID,
      attemptToken: beginCall?.[1].p_attempt_token,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/payment.?key|amount/i);
  });

  it('same-origin이 아니거나 canonical UUID가 아니면 인증·DB 쓰기 전에 차단한다', async () => {
    const forbidden = await POST(request('https://attacker.example'), context());
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: { code: 'forbidden' } });

    const missing = await POST(request(), context('not-a-uuid'));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expect(mocks.orderEq).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('Supabase·service role 중 하나라도 없으면 DB 쓰기 전에 fail closed한다', async () => {
    for (const unavailable of ['supabase', 'service']) {
      mocks.supabaseConfigured = unavailable !== 'supabase';
      mocks.serviceConfigured = unavailable !== 'service';

      const response = await POST(request(), context());
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: { code: 'not_configured' } });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('Toss 설정이 없어도 provider 호출이 필요 없는 무결제 완료 요청은 닫는다', async () => {
    mocks.tossConfigured = false;
    mocks.rpc.mockResolvedValueOnce({ data: requestResult('completed'), error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'canceled' });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('인증과 온보딩을 요구하고 본인에게 보이지 않는 예매는 404로 숨긴다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    const unauthorized = await POST(request(), context());
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: { code: 'auth_required' } });

    mocks.auth = { ...onboardedAuth(), profile: null };
    const onboarding = await POST(request(), context());
    expect(onboarding.status).toBe(409);
    await expect(onboarding.json()).resolves.toEqual({ error: { code: 'onboarding_required' } });

    mocks.auth = onboardedAuth();
    mocks.order = null;
    const notFound = await POST(request(), context());
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('owner preflight가 모순된 user_id row를 반환해도 service RPC 전에 404로 차단한다', async () => {
    mocks.order = {
      id: TICKET_ORDER_ID,
      user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'paid',
    };

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['not_cancelable', 409, 'not_cancelable'],
    ['policy_closed', 409, 'policy_closed'],
  ])('요청 결과 %s를 안전한 오류로 매핑한다', async (result, status, code) => {
    mocks.rpc.mockResolvedValueOnce({ data: requestResult(result, null), error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: { code } });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ['completed', 'canceled'],
    ['already_canceled', 'already_canceled'],
  ])('terminal 요청 결과 %s는 provider를 재호출하지 않는다', async (result, status) => {
    mocks.rpc.mockResolvedValueOnce({ data: requestResult(result), error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each(['processing', 'needs_review'])('%s 요청도 새 attempt로 재조정을 시작한다', async (result) => {
    mocks.rpc.mockResolvedValueOnce({ data: requestResult(result), error: null });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('begin_ticket_cancellation_reconcile', expect.any(Object));
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it('다른 attempt가 processing이면 provider를 중복 호출하지 않고 202를 반환한다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'request_ticket_cancellation') {
        return { data: requestResult('processing'), error: null };
      }
      return { data: 'in_progress', error: null };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'processing' });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('begin이 완료 상태를 확인하면 provider를 재호출하지 않고 200으로 수렴한다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'request_ticket_cancellation') {
        return { data: requestResult('needs_review'), error: null };
      }
      return { data: 'completed', error: null };
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'canceled' });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('provider 또는 로컬 정합화 실패는 식별자·원문 없이 202 review 상태로 제한한다', async () => {
    mocks.reconcile.mockResolvedValue({ ok: false, code: `private-${REQUEST_ID}` });

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ status: 'reviewing' });
    expect(JSON.stringify(body)).not.toContain(REQUEST_ID);
  });

  it('DB 오류·malformed table RPC 결과·예상 밖 begin 결과는 원문 없이 fail closed한다', async () => {
    mocks.orderError = { message: 'private order failure' };
    const lookupFailure = await POST(request(), context());
    expect(lookupFailure.status).toBe(502);
    expect(JSON.stringify(await lookupFailure.json())).not.toContain('private');

    mocks.orderError = null;
    mocks.rpc.mockResolvedValueOnce({
      data: [{ request_id: 'bad-id', result: 'requested', provider_key: 'must-not-leak' }],
      error: null,
    });
    const malformed = await POST(request(), context());
    expect(malformed.status).toBe(502);
    expect(JSON.stringify(await malformed.json())).not.toContain('must-not-leak');

    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'request_ticket_cancellation'
        ? { data: requestResult('requested'), error: null }
        : { data: 'private-state', error: null }
    ));
    const unexpected = await POST(request(), context());
    expect(unexpected.status).toBe(502);
    expect(JSON.stringify(await unexpected.json())).not.toContain('private-state');
  });
});
