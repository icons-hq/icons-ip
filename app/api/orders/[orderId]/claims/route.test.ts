import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maxDuration, POST } from './route';

const ORDER_UUID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const USER_ID = 'user-1';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  order: { id: 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c', user_id: 'user-1' } as Record<string, unknown> | null,
  rpc: vi.fn(),
  scheduleApprovedOrderCancellation: vi.fn(),
}));

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
    headers: { Origin: 'https://icons.local', 'content-type': 'application/json' },
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
});
