import { beforeEach, describe, expect, it, vi } from 'vitest';
const VARIANT_ID = '00000000-0000-4000-8000-000000000001';
import type { CurrentAuthState } from '@/lib/auth/server';
import { addCartSelectionAction, deleteCartItemAction, setCartItemQuantityAction, syncCartAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  rpc: vi.fn(),
  variantQuery: vi.fn(),
  adultGoods: 'hidden' as 'hidden' | 'masked' | 'full',
  variantRows: { data: [{ id: '00000000-0000-4000-8000-000000000001', good_id: 'g1' }], error: null } as { data: {id:string;good_id:string}[]; error: {message:string}|null },
  from: vi.fn(),
  cartRows: { data: [{ good_id: 'g1', variant_id: '00000000-0000-4000-8000-000000000001', qty: 4 }], error: null } as {
    data: { good_id: string; variant_id?: string; qty: number; input_snapshot?:unknown }[] | null;
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

vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsAccess: async () => mocks.adultGoods }));
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
        let afterId:string|null=null,pageSize=1000;
        const query={
          eq:mocks.cartSelectEq,order:mocks.cartOrder,
          gt(_column:string,value:string){afterId=value;return query;},
          limit(value:number){pageSize=value;return query;},
          then(resolve:(value:unknown)=>unknown){
            const rows=(mocks.cartRows.data??[]).map((row,index)=>({id:String(index).padStart(12,'0'),...row})).filter(row=>afterId===null||row.id>afterId);
            return Promise.resolve({data:mocks.cartRows.error?null:rows.slice(0,Math.min(pageSize,1000)),error:mocks.cartRows.error,count:rows.length}).then(resolve);
          },
        };
        mocks.cartSelect.mockReturnValue(query);mocks.cartSelectEq.mockReturnValue(query);mocks.cartOrder.mockReturnValue(query);
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

  it('같은 옵션의 다른 문구를 서버 읽기와 값별 수정·삭제에서 보존한다', async () => {
    const fieldId='00000000-0000-4000-8000-000000063311';
    const customInputs={revision:2,fields:[{id:fieldId,name:'각인 문구',value:'첫 문구'}]};
    const other={...customInputs,fields:[{...customInputs.fields[0],value:'다른 문구'}]};
    mocks.cartRows={data:[{good_id:'g1',variant_id:VARIANT_ID,qty:1,input_snapshot:customInputs},{good_id:'g1',variant_id:VARIANT_ID,qty:2,input_snapshot:other}],error:null};
    expect(await setCartItemQuantityAction('g1',1,VARIANT_ID,customInputs)).toEqual({ok:true,mode:'server',items:[
      {goodId:'g1',variantId:VARIANT_ID,qty:1,customInputs},{goodId:'g1',variantId:VARIANT_ID,qty:2,customInputs:other},
    ]});
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity_with_inputs',{p_good_id:'g1',p_variant_id:VARIANT_ID,p_qty:1,p_input_revision:2,p_input_values:{[fieldId]:'첫 문구'}});
    await deleteCartItemAction('g1',VARIANT_ID,customInputs);
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_cart_item_quantity_with_inputs',{p_good_id:'g1',p_variant_id:VARIANT_ID,p_qty:0,p_input_revision:2,p_input_values:{[fieldId]:'첫 문구'}});
  });
  it('같은 옵션의 1001개 문구를 PostgREST 상한에서 자르지 않고 전부 동기화한다', async () => {
    mocks.cartRows={data:Array.from({length:1001},(_,index)=>({good_id:'g1',variant_id:VARIANT_ID,qty:1,
      input_snapshot:{revision:1,fields:[{id:'00000000-0000-4000-8000-000000063311',name:'각인 문구',value:`문구 ${index}`}]}})),error:null};
    const result=await syncCartAction([]);
    expect(result.ok).toBe(true);
    if(!result.ok)throw new Error('sync failed');
    expect(result.items).toHaveLength(1001);
    expect(result.items.at(-1)?.customInputs?.fields[0].value).toBe('문구 1000');
    expect(result.items.reduce((total,item)=>total+item.qty,0)).toBe(1001);
    expect(mocks.cartSelect).toHaveBeenCalledTimes(3);
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
    expect(mocks.cartSelect).toHaveBeenCalledWith('id,good_id,variant_id,qty,input_snapshot',{count:'exact'});
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
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.sale_restriction', ['none']);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.ips.published_at', 'is', null);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.ips.archived_at', null);
  });

  it('19금 굿즈의 기본 옵션은 인증 성인에게만 찾는다(ADR-0024)', async () => {
    mocks.adultGoods = 'full';
    await syncCartAction([{ goodId: 'g1', qty: 2 }]);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.sale_restriction', ['none', 'adult']);

    mocks.variantQuery.mockClear();
    mocks.adultGoods = 'masked';
    await syncCartAction([{ goodId: 'g1', qty: 2 }]);
    expect(mocks.variantQuery).toHaveBeenCalledWith('goods.sale_restriction', ['none']);
    mocks.adultGoods = 'hidden';
  });

  it('DB의 성인 인증 요구를 담기 오류 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'adult_verification_required' } });
    await expect(setCartItemQuantityAction('g1', 1, VARIANT_ID)).resolves.toMatchObject({
      ok: false,
      error: '19금 굿즈는 성인 인증을 마친 회원만 담을 수 있어요. 마이 > 성인 인증에서 인증해주세요.',
    });
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

  it('adds one base and its extras through a single quantity comparison RPC and uses its committed snapshot', async () => {
    const extraVariant = '00000000-0000-4000-8000-000000000002';
    const snapshot = [{ goodId: 'g1', variantId: VARIANT_ID, qty: 3 }, { goodId: 'g2', variantId: extraVariant, qty: 2 }];
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
    expect(await addCartSelectionAction('g1', [
      { goodId: 'g1', variantId: VARIANT_ID, qty: 2, expectedQty: 1 },
      { goodId: 'g2', variantId: extraVariant, qty: 2, expectedQty: 0 },
    ])).toEqual({ ok: true, mode: 'server', items: snapshot });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('add_cart_selection', { p_base_good_id: 'g1', p_items: [
      { good_id: 'g1', variant_id: VARIANT_ID, qty: 2, expected_qty: 1 },
      { good_id: 'g2', variant_id: extraVariant, qty: 2, expected_qty: 0 },
    ] });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('cannot report success for a malformed extra or a stale cart snapshot', async () => {
    expect(await addCartSelectionAction('g1', [
      { goodId: 'g1', variantId: VARIANT_ID, qty: 1, expectedQty: 0 },
      { goodId: 'g2', variantId: 'bad', qty: 1, expectedQty: 0 },
    ])).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'cart_selection_changed' } });
    expect(await addCartSelectionAction('g1', [{ goodId: 'g1', variantId: VARIANT_ID, qty: 1, expectedQty: 0 }]))
      .toMatchObject({ ok: false, error: expect.stringContaining('장바구니가 변경') });
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
