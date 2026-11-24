import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maxDuration, POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  order: { id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c', user_id: 'user-1' } as Record<string, unknown> | null,
  rpc: vi.fn(),
  scheduleApprovedOrderCancellation: vi.fn(),
  partialReturnEnabled: true,
}));

vi.mock('@/lib/orders/partial-return.server', () => ({
  loadPartialReturnPolicy: async () => ({ enabled: mocks.partialReturnEnabled }),
}));

vi.mock('@/lib/gifts-order.server', () => ({ loadGiftCheckoutOrder: async () => ({ kind: 'ordinary' }) }));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: true }),
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: mocks.order, error: null })),
    };
    return {
      auth: { getUser: async () => ({ data: { user: mocks.user } }) },
      from: () => query,
    };
  },
}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({
  scheduleApprovedOrderCancellation: mocks.scheduleApprovedOrderCancellation,
}));

function request(body: Record<string, unknown>) {
  return new Request(`https://icons.local/api/orders/${ORDER_UUID}/claims`, {
    method: 'POST',
    headers: { host: 'icons.local', Origin: 'https://icons.local', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ orderId: ORDER_UUID }) };

describe('POST /api/orders/[orderId]/claims — 승인된 취소의 결제사 취소 예약', () => {
  beforeEach(() => {
    mocks.user = { id: USER_ID };
    mocks.order = { id: ORDER_UUID, user_id: USER_ID };
    mocks.rpc.mockReset();
    mocks.scheduleApprovedOrderCancellation.mockReset();
  });

  it('maxDuration은 응답 뒤 결제사 취소 대기·발행 예산(90초)을 선언한다', () => {
    expect(maxDuration).toBe(90);
  });

  // 자동 승인은 DB 원장만 연다. 이 예약이 없으면 결제사 취소가 어디서도 나가지 않는다
  // (2026-10-12 점검 REF-2).
  it('자동 승인된 취소는 202로 답하고 결제사 전액 취소 경로를 예약한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'auto_approved', error: null });

    const response = await POST(request({ claimType: 'cancel' }), context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'auto_approved' });
    expect(mocks.scheduleApprovedOrderCancellation).toHaveBeenCalledWith(ORDER_UUID);
  });

  // 결제 승인 확인 중에 접수된 취소는 requested로 남고 finalizer가 그 결과로 요청을
  // 자동 승인하거나 종결한다. 그 판정을 기다렸다가 발행하는 경로도 같은 예약이다(DB-2).
  it('접수(requested)된 취소도 같은 경로를 예약한다 — 실행 여부는 DB 상태가 정한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'requested', error: null });

    const response = await POST(request({ claimType: 'cancel' }), context);

    expect(response.status).toBe(202);
    expect(mocks.scheduleApprovedOrderCancellation).toHaveBeenCalledTimes(1);
  });

  it.each(['return', 'exchange'])('%s 접수는 결제사 취소를 예약하지 않는다(회수 확인이 선행한다)', async (claimType) => {
    mocks.rpc.mockResolvedValue({ data: 'requested', error: null });

    const response = await POST(request({ claimType }), context);

    expect(response.status).toBe(202);
    expect(mocks.scheduleApprovedOrderCancellation).not.toHaveBeenCalled();
  });

  it.each(['already_requested', 'completed', 'already_canceled', 'not_cancelable'])(
    '%s 결과는 예약하지 않는다(중복 실행 방지)',
    async (result) => {
      mocks.rpc.mockResolvedValue({ data: result, error: null });

      await POST(request({ claimType: 'cancel' }), context);

      expect(mocks.scheduleApprovedOrderCancellation).not.toHaveBeenCalled();
    },
  );

  it('RPC 실패는 예약 없이 502로 숨긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private failure' } });

    const response = await POST(request({ claimType: 'cancel' }), context);

    expect(response.status).toBe(502);
    expect(mocks.scheduleApprovedOrderCancellation).not.toHaveBeenCalled();
  });

  it('가상계좌 주문이 받지 않은 환급 계좌는 계좌 오류(400)로 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid_virtual_account_refund_account' } });

    const response = await POST(request({
      claimType: 'cancel', bankName: '농협', accountNumber: '110987654321', accountHolder: '김합성',
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_refund_account' } });
    expect(mocks.scheduleApprovedOrderCancellation).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/[orderId]/claims — 부분 반품(ADR-0047)', () => {
  const ITEM = 'c3a9b2d5-4e6f-4a7b-8c9d-0e1f2a3b4c5d';

  beforeEach(() => {
    mocks.user = { id: USER_ID };
    mocks.order = { id: ORDER_UUID, user_id: USER_ID };
    mocks.rpc.mockReset();
    mocks.scheduleApprovedOrderCancellation.mockReset();
    mocks.partialReturnEnabled = true;
  });

  it('품목을 보낸 반품은 부분 반품 접수 함수로 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'requested', error: null });

    const response = await POST(request({ claimType: 'return', reasonType: 'change_of_mind', items: [{ orderItemId: ITEM, qty: 1 }] }), context);

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith('request_order_partial_return', expect.objectContaining({
      p_items: [{ orderItemId: ITEM, qty: 1 }],
      p_order_id: ORDER_UUID,
      p_reason_type: 'change_of_mind',
      p_user_id: USER_ID,
    }));
    expect(mocks.scheduleApprovedOrderCancellation).not.toHaveBeenCalled();
  });

  it('스위치가 꺼져 있으면 품목이 든 요청은 예전처럼 인증·주문 조회 전에 invalid_body다 — 주문 전체로 바꿔 접수하지 않는다', async () => {
    mocks.partialReturnEnabled = false;
    mocks.user = null;

    const response = await POST(request({ claimType: 'return', items: [{ orderItemId: ITEM, qty: 1 }] }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_body' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('켜져 있다가 접수 사이 꺼지면(partial_return_disabled) 같은 invalid_body로 거부한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'partial_return_disabled', error: null });

    const response = await POST(request({ claimType: 'return', items: [{ orderItemId: ITEM, qty: 1 }] }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_body' } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['partial_return_unavailable', 'partial_return_item_unavailable'])('%s는 409로 그 사유를 돌려준다', async (result) => {
    mocks.rpc.mockResolvedValue({ data: result, error: null });

    const response = await POST(request({ claimType: 'return', items: [{ orderItemId: ITEM, qty: 1 }] }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: result } });
  });

  it.each([
    ['교환에 품목', { claimType: 'exchange', items: [{ orderItemId: ITEM, qty: 1 }] }],
    ['취소에 품목', { claimType: 'cancel', items: [{ orderItemId: ITEM, qty: 1 }] }],
    ['빈 품목', { claimType: 'return', items: [] }],
    ['수량 0', { claimType: 'return', items: [{ orderItemId: ITEM, qty: 0 }] }],
    ['같은 품목 두 번', { claimType: 'return', items: [{ orderItemId: ITEM, qty: 1 }, { orderItemId: ITEM, qty: 1 }] }],
    ['금액 키', { claimType: 'return', refundAmount: 1000 }],
    ['품목 단수 키', { claimType: 'return', orderItemId: ITEM }],
  ])('%s는 DB에 닿기 전에 invalid_body다', async (_label, body) => {
    const response = await POST(request(body), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_body' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('품목이 없는 반품은 지금처럼 주문 전체 접수 함수로 간다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'requested', error: null });

    await POST(request({ claimType: 'return' }), context);

    expect(mocks.rpc).toHaveBeenCalledWith('request_order_claim', expect.objectContaining({ p_claim_type: 'return' }));
  });
});
