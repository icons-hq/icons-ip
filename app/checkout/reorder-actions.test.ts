import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { restoreCanceledOrderToCartAction } from './reorder-actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  rows: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as { table: string; eq: [string, unknown][] }[],
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record = { table, eq: [] as [string, unknown][] };
      mocks.queries.push(record);
      const result = () => {
        let rows = mocks.rows[table] ?? [];
        for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
        return { data: rows, error: null };
      };
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { record.eq.push([column, value]); return query; },
        order: () => query,
        maybeSingle: () => Promise.resolve({ data: result().data[0] ?? null, error: null }),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    rpc: mocks.rpc,
  }),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const orderId = '5cbcbbed-202d-4676-821a-7706398e57c0';
const variantA = '10000000-0000-4000-8000-00000000000a';
const variantB = '10000000-0000-4000-8000-00000000000b';

function onboardedAuth(overrides: Partial<NonNullable<CurrentAuthState['profile']>> = {}): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: userId, email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      ...overrides,
    },
    isStaff: false,
  } as CurrentAuthState;
}

describe('restoreCanceledOrderToCartAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.queries = [];
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.rows = {
      orders: [{ id: orderId, user_id: userId, status: 'canceled' }],
      order_items: [
        { order_id: orderId, good_id: 'g1', variant_id: variantA, qty: 2, good_name_snapshot: '홍실 키링', variant_name_snapshot: '파랑' },
        { order_id: orderId, good_id: 'g2', variant_id: variantB, qty: 1, good_name_snapshot: '홍실 쿠션', variant_name_snapshot: null },
      ],
      cart_items: [],
    };
  });

  it('DB가 취소를 확정한 본인 주문의 품목을 장바구니 수량 RPC로 다시 담는다', async () => {
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true,
      restoredLines: 2,
      skipped: [],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g1', p_variant_id: variantA, p_qty: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g2', p_variant_id: variantB, p_qty: 1 });
    expect(mocks.queries.find((query) => query.table === 'orders')?.eq).toEqual([
      ['id', orderId],
      ['user_id', userId],
    ]);
  });

  it('취소되지 않은 주문은 담지 않는다', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'pending' }];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'not_canceled' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('남의 주문·형식 밖 주문번호는 찾지 못한 것으로 답한다', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: 'someone-else', status: 'canceled' }];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(restoreCanceledOrderToCartAction('not-a-uuid')).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('로그인·온보딩이 안 됐거나 정지된 계정은 담지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'auth_required' });
    mocks.auth = onboardedAuth({ suspended_at: '2026-10-01T00:00:00.000Z' } as never);
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'account_suspended' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('품절·판매 중지 품목은 기존 RPC 판정대로 건너뛰고 나머지는 담는다', async () => {
    mocks.rpc.mockImplementation((_name: string, args: { p_variant_id: string }) => Promise.resolve(
      args.p_variant_id === variantA
        ? { data: null, error: { message: 'out of stock' } }
        : { data: null, error: { message: 'catalog_item_unavailable' } },
    ));
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true,
      restoredLines: 0,
      skipped: [
        { name: '홍실 키링 (파랑)', reason: 'out_of_stock' },
        { name: '홍실 쿠션', reason: 'unavailable' },
      ],
    });
  });

  it('장바구니에 이미 같은 옵션이 충분히 있으면 수량을 더하지 않는다', async () => {
    mocks.rows.cart_items = [
      { user_id: userId, variant_id: variantA, qty: 3 },
      { user_id: userId, variant_id: variantB, qty: 0 },
    ];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: true, restoredLines: 2, skipped: [] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g2', p_variant_id: variantB, p_qty: 1 });
  });
});
