import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEmailDeliveries } from './deliveries.server';

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase/server', () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

function row(overrides: Record<string, unknown> = {}) {
  return {
    dedupe_key: `order_confirmation:${ORDER_ID}`,
    template: 'order_confirmation',
    recipient: 'buyer@example.com',
    subject: '[ICONS] 주문이 접수됐어요',
    status: 'failed',
    attempt_count: 2,
    last_error: 'resend 429',
    claimed_at: '2026-08-07T02:30:00.000Z',
    completed_at: '2026-08-07T02:30:01.000Z',
    created_at: '2026-08-07T02:00:00.000Z',
    total_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [row()], error: null });
});

describe('loadEmailDeliveries', () => {
  // 테이블은 service_role에서도 revoke되어 있다. 조회 경로는 staff 게이트 RPC 하나뿐이다.
  it('테이블을 직접 읽지 않고 staff 게이트 RPC로 실패 목록을 읽는다', async () => {
    const deliveries = await loadEmailDeliveries();

    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_email_deliveries', {
      p_status: 'failed',
      p_limit: 20,
      p_offset: 0,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      dedupeKey: `order_confirmation:${ORDER_ID}`,
      template: 'order_confirmation',
      templateLabel: '주문 확인',
      orderId: ORDER_ID,
      status: 'failed',
      attemptCount: 2,
      lastError: 'resend 429',
    });
  });

  it('앱이 모르는 템플릿·상태는 목록에서 뺀다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        row({ dedupe_key: 'newsletter:1', template: 'newsletter' }),
        row({ dedupe_key: `order_shipped:${ORDER_ID}`, template: 'order_shipped', status: 'queued' }),
        row(),
      ],
      error: null,
    });

    const deliveries = await loadEmailDeliveries();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].template).toBe('order_confirmation');
  });

  it('주문 id를 못 읽는 키도 목록에는 남긴다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [row({ dedupe_key: 'order_confirmation:legacy-key' })],
      error: null,
    });

    const deliveries = await loadEmailDeliveries();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].orderId).toBeNull();
  });

  it('staff가 아니면 RPC 오류를 삼키지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'staff required' } });

    await expect(loadEmailDeliveries()).rejects.toThrow('staff required');
  });
});
