import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { deleteCartItemAction, setCartItemQuantityAction, syncCartAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  rpc: vi.fn(),
  from: vi.fn(),
  cartRows: { data: [{ good_id: 'g1', qty: 4 }], error: null } as {
    data: { good_id: string; qty: number }[] | null;
    error: { message: string } | null;
  },
  goodRow: { data: { stock: 'ok', stock_qty: 5 }, error: null } as {
    data: { stock: string; stock_qty: number } | null;
    error: { message: string } | null;
  },
  upsertResult: { error: null } as { error: { message: string } | null },
  deleteResult: { error: null } as { error: { message: string } | null },
  cartSelect: vi.fn(),
  cartSelectEq: vi.fn(),
  cartOrder: vi.fn(),
  cartUpsert: vi.fn(),
  cartDelete: vi.fn(),
  cartDeleteEq: vi.fn(),
  goodsSelect: vi.fn(),
  goodsEq: vi.fn(),
  goodsIs: vi.fn(),
  goodsMaybeSingle: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/cart', async () => await import('../../lib/cart'));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
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

function thenableDeleteBuilder() {
  const builder = {
    eq: mocks.cartDeleteEq,
    then<TResult1 = typeof mocks.deleteResult, TResult2 = never>(
      onfulfilled?: ((value: typeof mocks.deleteResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(mocks.deleteResult).then(onfulfilled, onrejected);
    },
  };
  mocks.cartDeleteEq.mockReturnValue(builder);
  return builder;
}

describe('cart Server Actions', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.cartRows = { data: [{ good_id: 'g1', qty: 4 }], error: null };
    mocks.goodRow = { data: { stock: 'ok', stock_qty: 5 }, error: null };
    mocks.upsertResult = { error: null };
    mocks.deleteResult = { error: null };

    for (const mock of [
      mocks.rpc,
      mocks.from,
      mocks.cartSelect,
      mocks.cartSelectEq,
      mocks.cartOrder,
      mocks.cartUpsert,
      mocks.cartDelete,
      mocks.cartDeleteEq,
      mocks.goodsSelect,
      mocks.goodsEq,
      mocks.goodsIs,
      mocks.goodsMaybeSingle,
    ]) mock.mockReset();

    mocks.rpc.mockResolvedValue({ error: null });
    mocks.cartOrder.mockImplementation(async () => mocks.cartRows);
    mocks.cartSelectEq.mockReturnValue({ order: mocks.cartOrder });
    mocks.cartSelect.mockReturnValue({ eq: mocks.cartSelectEq });
    mocks.cartUpsert.mockImplementation(async () => mocks.upsertResult);
    mocks.cartDelete.mockImplementation(() => thenableDeleteBuilder());
    mocks.goodsMaybeSingle.mockImplementation(async () => mocks.goodRow);
    mocks.goodsIs.mockReturnValue({ maybeSingle: mocks.goodsMaybeSingle });
    mocks.goodsEq.mockReturnValue({ is: mocks.goodsIs });
    mocks.goodsSelect.mockReturnValue({ eq: mocks.goodsEq });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'cart_items') {
        return {
          select: mocks.cartSelect,
          upsert: mocks.cartUpsert,
          delete: mocks.cartDelete,
        };
      }
      if (table === 'goods') return { select: mocks.goodsSelect };
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('preserves a normalized local cart without DB access when Supabase is not configured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

    await expect(syncCartAction([
      { goodId: 'g1', qty: 2 },
      { goodId: 'g1', qty: 1 },
      { goodId: '', qty: 3 },
    ])).resolves.toEqual({ ok: true, mode: 'local', items: [{ goodId: 'g1', qty: 2 }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('keeps the local cart for anonymous and not-yet-onboarded users', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'local',
      items: [{ goodId: 'g1', qty: 2 }],
    });

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'local',
      items: [{ goodId: 'g1', qty: 2 }],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('merges an onboarded local cart and returns the server snapshot', async () => {
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'server',
      items: [{ goodId: 'g1', qty: 4 }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', {
      p_items: [{ good_id: 'g1', qty: 2 }],
    });
    expect(mocks.cartSelect).toHaveBeenCalledWith('good_id,qty');
    expect(mocks.cartSelectEq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('keeps local items when merge fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } });

    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: false,
      mode: 'local',
      error: '장바구니를 동기화하지 못했습니다. 다시 시도해주세요.',
    });
    expect(mocks.cartSelect).not.toHaveBeenCalled();
  });

  it('validates current stock, upserts through RLS, and returns the current snapshot', async () => {
    await expect(setCartItemQuantityAction('g1', 3)).resolves.toEqual({
      ok: true,
      mode: 'server',
      items: [{ goodId: 'g1', qty: 4 }],
    });
    expect(mocks.goodsSelect).toHaveBeenCalledWith('stock,stock_qty');
    expect(mocks.goodsEq).toHaveBeenCalledWith('id', 'g1');
    expect(mocks.goodsIs).toHaveBeenCalledWith('archived_at', null);
    expect(mocks.cartUpsert).toHaveBeenCalledWith(
      { user_id: 'user-1', good_id: 'g1', qty: 3 },
      { onConflict: 'user_id,good_id' },
    );
  });

  it('rejects sold-out or excessive quantities before writing', async () => {
    mocks.goodRow = { data: { stock: 'low', stock_qty: 2 }, error: null };

    await expect(setCartItemQuantityAction('g1', 3)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '현재 재고보다 많이 담을 수 없습니다.',
    });
    expect(mocks.cartUpsert).not.toHaveBeenCalled();
  });

  it('deletes an authenticated cart item and refreshes the snapshot', async () => {
    await expect(deleteCartItemAction('g1')).resolves.toEqual({
      ok: true,
      mode: 'server',
      items: [{ goodId: 'g1', qty: 4 }],
    });
    expect(mocks.cartDelete).toHaveBeenCalled();
    expect(mocks.cartDeleteEq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(mocks.cartDeleteEq).toHaveBeenNthCalledWith(2, 'good_id', 'g1');
  });

  it('does not touch the DB for invalid inputs or an expired session', async () => {
    await expect(setCartItemQuantityAction('', 1)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(deleteCartItemAction('g1')).resolves.toEqual({ ok: false, mode: 'local' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns a generic error without exposing database details', async () => {
    mocks.upsertResult = { error: { message: 'sensitive database detail' } };

    await expect(setCartItemQuantityAction('g1', 3)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니를 저장하지 못했습니다. 다시 시도해주세요.',
    });
  });

  it('rejects malformed runtime arguments without throwing', async () => {
    await expect(setCartItemQuantityAction(null, '2')).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    await expect(deleteCartItemAction({ goodId: 'g1' })).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
