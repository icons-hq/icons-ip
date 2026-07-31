import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminInsights } from './insights.server';

interface QueryState {
  head: boolean;
}

const mocks = vi.hoisted(() => ({
  profileRows: [{ id: '11111111-1111-4111-8111-111111111111', nickname: '구매자' }],
  rpcResult: {
    data: [{ current_count: '2', previous_count: 1 }],
    error: null as { message: string } | null,
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: vi.fn(async () => mocks.rpcResult),
    from: (table: string) => {
      const state: QueryState = { head: false };
      const result = () => {
        if (state.head) return { data: null, error: null, count: 0 };
        if (table === 'orders') {
          return {
            data: [{
              id: 'order-1',
              user_id: '11111111-1111-4111-8111-111111111111',
              total: 1000,
              status: 'paid',
              created_at: '2026-07-17T02:00:00.000Z',
            }],
            error: null,
          };
        }
        if (table === 'ticket_orders') {
          return {
            data: [{
              id: 'ticket-order-1',
              user_id: '22222222-2222-4222-8222-222222222222',
              total: 2000,
              status: 'paid',
              created_at: '2026-07-17T01:00:00.000Z',
            }],
            error: null,
          };
        }
        if (table === 'public_profiles') return { data: mocks.profileRows, error: null };
        return { data: [], error: null };
      };
      const query = {
        select: (_columns: string, options?: { head?: boolean }) => {
          state.head = options?.head === true;
          return query;
        },
        eq: () => (state.head ? Promise.resolve(result()) : query),
        in: () => (table === 'public_profiles' || table === 'ips' ? Promise.resolve(result()) : query),
        gte: () => query,
        lt: () => query,
        order: () => query,
        range: () => Promise.resolve(result()),
        limit: () => Promise.resolve(result()),
      };
      return query;
    },
  }),
}));

describe('getAdminInsights profile boundaries', () => {
  beforeEach(() => {
    mocks.profileRows = [{ id: '11111111-1111-4111-8111-111111111111', nickname: '구매자' }];
    mocks.rpcResult = { data: [{ current_count: '2', previous_count: 1 }], error: null };
  });

  it('가입 집계 RPC와 공개 프로필 닉네임만 사용한다', async () => {
    const result = await getAdminInsights();

    expect(result.signupCount).toEqual({ current: 2, previous: 1 });
    expect(result.recentOrders).toEqual([
      expect.objectContaining({ id: 'order-1', buyerName: '구매자' }),
      expect.objectContaining({ id: 'ticket-order-1', buyerName: 'fan_222222' }),
    ]);
  });

  it('가입 집계 오류와 잘못된 집계는 닫힌 상태로 실패한다', async () => {
    mocks.rpcResult = { data: [], error: { message: 'private detail' } };
    await expect(getAdminInsights()).rejects.toThrow('Failed to count admin profiles: private detail');

    mocks.rpcResult = { data: [{ current_count: 'invalid', previous_count: 1 }], error: null };
    await expect(getAdminInsights()).rejects.toThrow('Failed to count admin profiles: invalid aggregate');
  });
});
