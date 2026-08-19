import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  serviceConfigured: true,
  tossConfigured: true,
  user: { id: 'user-1' } as { id: string } | null,
  confirm: vi.fn(),
  fetchPayment: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: vi.fn(async () => ({ user: mocks.user })),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.supabaseConfigured }),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
}));

vi.mock('@/lib/payments/toss-api', () => ({
  getTossConfig: () => ({ isConfigured: mocks.tossConfigured }),
  confirmTossPayment: mocks.confirm,
  fetchTossPayment: mocks.fetchPayment,
}));

import { POST } from './route';

const ORDER_ID = 'order_00000000-0000-4000-8000-000000000088';
const TICKET_ORDER_ID = 'ticket_00000000-0000-4000-8000-000000000088';

function request(orderId: string) {
  return new Request('http://localhost/api/payments/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      paymentKey: 'legacy-payment-key',
      orderId,
      amount: 42_000,
      paymentType: 'NORMAL',
    }),
  });
}

describe('POST /api/payments/confirm', () => {
  beforeEach(() => {
    mocks.supabaseConfigured = true;
    mocks.serviceConfigured = true;
    mocks.tossConfigured = true;
    mocks.user = { id: 'user-1' };
    mocks.confirm.mockReset();
    mocks.fetchPayment.mockReset();
  });

  it('Preview처럼 Toss secret이 없으면 503으로 fail closed한다', async () => {
    mocks.tossConfigured = false;

    const response = await POST(request(TICKET_ORDER_ID));

    expect(response.status).toBe(503);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });

  it('로그인하지 않은 요청은 retired callback contract도 열지 않는다', async () => {
    mocks.user = null;

    const response = await POST(request(TICKET_ORDER_ID));

    expect(response.status).toBe(401);
  });

  it.each([
    ['굿즈', ORDER_ID, '신규 굿즈 결제'],
    ['티켓', TICKET_ORDER_ID, '신규 티켓 결제'],
  ])('%s Toss checkout을 provider 호출 전에 영구 차단한다', async (_label, orderId, message) => {
    const response = await POST(request(orderId));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'legacy_checkout_closed',
        message: expect.stringContaining(message),
      },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });

  it('잘못된 callback body는 provider 호출 없이 거절한다', async () => {
    const response = await POST(new Request('http://localhost/api/payments/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: TICKET_ORDER_ID }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
