import { beforeEach, describe, expect, it, vi } from 'vitest';
const VARIANT_ID = '00000000-0000-4000-8000-000000000001';
import type { CurrentAuthState } from '@/lib/auth/server';
import { deleteCartItemAction, setCartItemQuantityAction, syncCartAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  rpc: vi.fn(),
  variantQuery: vi.fn(),
  variantRows: { data: [{ id: '00000000-0000-4000-8000-000000000001', good_id: 'g1' }], error: null } as { data: {id:string;good_id:string}[]; error: {message:string}|null },
  from: vi.fn(),
  cartRows: { data: [{ good_id: 'g1', variant_id: '00000000-0000-4000-8000-000000000001', qty: 4 }], error: null } as {
    data: { good_id: string; variant_id?: string; qty: number }[] | null;
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
  goodsNot: vi.fn(),
  goodsRestrictionEq: vi.fn(),
  goodsMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
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
    mocks.variantRows = {data:[{id:VARIANT_ID,good_id:'g1'}],error:null};
    mocks.variantQuery.mockReset();
    mocks.cartRows = { data: [{ good_id: 'g1', variant_id: '00000000-0000-4000-8000-000000000001', qty: 4 }], error: null };
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
      mocks.goodsNot,
      mocks.goodsRestrictionEq,
      mocks.goodsMaybeSingle,
    ]) mock.mockReset();

    mocks.rpc.mockResolvedValue({ error: null });
    mocks.cartOrder.mockImplementation(async () => mocks.cartRows);
    mocks.cartSelectEq.mockReturnValue({ order: mocks.cartOrder });
    mocks.cartSelect.mockReturnValue({ eq: mocks.cartSelectEq });
    mocks.cartUpsert.mockImplementation(async () => mocks.upsertResult);
    mocks.cartDelete.mockImplementation(() => thenableDeleteBuilder());
    mocks.goodsMaybeSingle.mockImplementation(async () => mocks.goodRow);
    // 판매 제한(19금) 비노출 필터가 archived_at 뒤에 하나 더 붙는다(#392).
    const goodsFilters = { eq: mocks.goodsRestrictionEq, is: mocks.goodsIs, not: mocks.goodsNot, maybeSingle: mocks.goodsMaybeSingle };
    mocks.goodsRestrictionEq.mockReturnValue(goodsFilters);
    mocks.goodsIs.mockReturnValue(goodsFilters);
    mocks.goodsNot.mockReturnValue(goodsFilters);
    mocks.goodsEq.mockReturnValue(goodsFilters);
    mocks.goodsSelect.mockReturnValue({ eq: mocks.goodsEq });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'cart_items') {
        return {
          select: mocks.cartSelect,
          upsert: mocks.cartUpsert,
          delete: mocks.cartDelete,
        };
      }
      if (table === 'goods_variants') {
        const query = { select: mocks.variantQuery, in: mocks.variantQuery, eq: mocks.variantQuery, is: mocks.variantQuery, not: mocks.variantQuery, then: (resolve: (value: typeof mocks.variantRows) => unknown) => Promise.resolve(mocks.variantRows).then(resolve) };
        mocks.variantQuery.mockReturnValue(query); return query;
      }
      if (table === 'goods') return { select: mocks.goodsSelect };
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('preserves a normalized local cart without DB access when Supabase is not configured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

    await expect(syncCartAction([
      { goodId: 'g1', variantId: VARIANT_ID, qty: 2 },
      { goodId: 'g1', variantId: VARIANT_ID, qty: 1 },
      { goodId: '', qty: 3 },
    ])).resolves.toEqual({ ok: true, mode: 'local', items: [{ goodId: 'g1', variantId: VARIANT_ID, qty: 2 }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('keeps the local cart for anonymous and not-yet-onboarded users', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'local',
      items: [{ goodId: 'g1', variantId: VARIANT_ID, qty: 2 }],
    });

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'local',
      items: [{ goodId: 'g1', variantId: VARIANT_ID, qty: 2 }],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('merges an onboarded local cart and returns the server snapshot', async () => {
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toEqual({
      ok: true,
      mode: 'server',
      items: [{ goodId: 'g1', variantId: VARIANT_ID, qty: 4 }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', {
      p_items: [{ good_id: 'g1', variant_id: VARIANT_ID, qty: 2 }],
    });
    expect(mocks.cartSelect).toHaveBeenCalledWith('good_id,variant_id,qty');
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

  it('sends the selected option to the server-owned stock and visibility gate', async () => {
    const variantId = '00000000-0000-4000-8000-000000000002';
    mocks.cartRows.data = [{ good_id: 'g1', variant_id: variantId, qty: 3 }];
    await expect(setCartItemQuantityAction('g1', 3, variantId)).resolves.toEqual({
      ok: true, mode: 'server', items: [{ goodId: 'g1', variantId, qty: 3 }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', {
      p_good_id: 'g1', p_variant_id: variantId, p_qty: 3,
    });
    expect(mocks.cartUpsert).not.toHaveBeenCalled();
  });

  it('rejects missing option identity at the mutation boundary', async () => {
    await expect(setCartItemQuantityAction('g1', 2, undefined)).resolves.toMatchObject({ok:false});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports current option stock without exposing other database errors', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'out of stock' } });
    await expect(setCartItemQuantityAction('g1', 3, VARIANT_ID)).resolves.toEqual({
      ok: false, mode: 'server', error: '현재 재고보다 많이 담을 수 없습니다.',
    });
  });

  it('deletes only the selected option and refreshes the snapshot', async () => {
    const variantId = '00000000-0000-4000-8000-000000000002';
    await expect(deleteCartItemAction('g1', variantId)).resolves.toMatchObject({ ok: true, mode: 'server' });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', {
      p_good_id: 'g1', p_variant_id: variantId, p_qty: 0,
    });
    expect(mocks.cartDelete).not.toHaveBeenCalled();
  });

  it('preserves separate options when syncing the local cart', async () => {
    const variantId = '00000000-0000-4000-8000-000000000002';
    await syncCartAction([{ goodId: 'g1', variantId, qty: 2 }]);
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', {
      p_items: [{ good_id: 'g1', variant_id: variantId, qty: 2 }],
    });
  });

  it('adds legacy and already-selected default quantities before the idempotent server merge', async () => {
    await syncCartAction([{ goodId: 'g1', qty: 2 }, { goodId: 'g1', variantId: VARIANT_ID, qty: 3 }]);
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g1', variant_id: VARIANT_ID, qty: 5 }] });
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.published_at', 'is', null);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.archived_at', null);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.sale_restriction', 'none');
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.ips.published_at', 'is', null);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.ips.archived_at', null);
  });

  it('keeps unmigrated items when their public default cannot be resolved', async () => {
    mocks.variantRows = { data: [], error: null };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toMatchObject({
      ok: false, mode: 'local', unresolvedItems: [{ goodId: 'g1', qty: 2 }],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not discard a v1 cart while the backend is unconfigured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };
    await expect(syncCartAction([{ goodId: 'g1', qty: 2 }])).resolves.toMatchObject({
      ok: false, mode: 'local', unresolvedItems: [{ goodId: 'g1', qty: 2 }],
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects a malformed variant instead of silently selecting the default', async () => {
    await expect(setCartItemQuantityAction('g1', 1, 'bad-option')).resolves.toMatchObject({ ok: false });
    await expect(deleteCartItemAction('g1', {})).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not touch the DB for invalid inputs or an expired session', async () => {
    await expect(setCartItemQuantityAction('', 1, VARIANT_ID)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(deleteCartItemAction('g1', VARIANT_ID)).resolves.toEqual({ ok: false, mode: 'local' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns a generic error without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'sensitive database detail' } });

    await expect(setCartItemQuantityAction('g1', 3, VARIANT_ID)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니를 저장하지 못했습니다. 다시 시도해주세요.',
    });
  });

  it('rejects malformed runtime arguments without throwing', async () => {
    await expect(setCartItemQuantityAction(null, '2', VARIANT_ID)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    await expect(deleteCartItemAction({ goodId: 'g1' }, VARIANT_ID)).resolves.toEqual({
      ok: false,
      mode: 'server',
      error: '장바구니 수량을 확인해주세요.',
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
