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

/* 상태별로 한 번씩 부르므로 응답도 상태별로 준다. */
function respondByStatus(byStatus: Record<string, unknown[]>) {
  mocks.rpc.mockImplementation(async (_fn: string, args: { p_status: string }) => ({
    data: byStatus[args.p_status] ?? [],
    error: null,
  }));
}

beforeEach(() => {
  mocks.rpc.mockReset();
  respondByStatus({ failed: [row()], pending: [] });
});

describe('loadEmailDeliveries', () => {
  // 테이블은 service_role에서도 revoke되어 있다. 조회 경로는 staff 게이트 RPC 하나뿐이다.
  it('테이블을 직접 읽지 않고 staff 게이트 RPC로 읽는다', async () => {
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

  /*
   * 발송 훅이 클레임한 뒤 함수가 죽으면 행은 pending으로 남는다 — 메일은 안 갔는데
   * failed 목록에는 없다. 그 건이 목록에서 빠지면 운영자가 정상으로 오인한다.
   */
  it('클레임된 채 멈춘 pending 건도 함께 읽는다', async () => {
    respondByStatus({
      failed: [row({ claimed_at: '2026-08-07T02:00:00.000Z' })],
      pending: [row({
        dedupe_key: `order_shipped:${ORDER_ID}`,
        template: 'order_shipped',
        status: 'pending',
        completed_at: null,
        last_error: null,
        claimed_at: '2026-08-07T03:00:00.000Z',
      })],
    });

    const deliveries = await loadEmailDeliveries();

    expect(mocks.rpc).toHaveBeenCalledWith(
      'admin_search_email_deliveries',
      expect.objectContaining({ p_status: 'pending' }),
    );
    expect(deliveries.map((d) => d.status)).toEqual(['pending', 'failed']);
  });

  it('앱이 모르는 템플릿·상태는 목록에서 뺀다', async () => {
    respondByStatus({
      failed: [
        row({ dedupe_key: 'newsletter:1', template: 'newsletter' }),
        row({ dedupe_key: `order_shipped:${ORDER_ID}`, template: 'order_shipped', status: 'queued' }),
        row(),
      ],
      pending: [],
    });

    const deliveries = await loadEmailDeliveries();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].template).toBe('order_confirmation');
  });

  it('주문 id를 못 읽는 키도 목록에는 남긴다', async () => {
    respondByStatus({
      failed: [row({ dedupe_key: 'order_confirmation:legacy-key' })],
      pending: [],
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
