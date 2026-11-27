import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countReturnAddressGoods, loadAdminReturnAddresses, loadGoodsReturnAddressOptions } from './return-addresses.server';

const mocks = vi.hoisted(() => ({ from: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const address = (id: string, name: string) => ({ id, name, address: `${name} 주소`, phone: '02-1234-5678', updated_at: '2026-11-26T00:00:00Z' });
const good = (id: string, return_address_id: string | null, patch: Record<string, unknown> = {}) => ({ id, name: `상품 ${id}`, archived_at: null, return_address_id, ...patch });

type Result = { data?: unknown; error?: unknown; count?: number | null };
/**
 * 표마다 결과를 돌려주는 가짜 연결. `select(...)` 뒤로 이어지는 호출은 모두 같은 결과를 기다린다.
 * 상품 표(goods)에 줄을 주고 전체 수(count)를 따로 주지 않으면 받은 줄 수가 전체 수다 — 줄이 모자라지 않은 보통의 읽기다.
 */
function tables(results: Record<string, Result>) {
  const calls: Record<string, unknown[][]> = {};
  mocks.from.mockImplementation((table: string) => {
    calls[table] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'not', 'limit', 'eq']) builder[method] = (...args: unknown[]) => { calls[table].push([method, ...args]); return builder; };
    const result = results[table];
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null, count: table === 'goods' && Array.isArray(result?.data) && !('count' in result) ? result.data.length : null, ...result });
    return builder;
  });
  return calls;
}
/** 같은 표를 여러 번 읽으면 부른 차례대로 다른 결과를 돌려주는 가짜 연결. 읽을 때마다 부른 순서를 따로 적는다. */
function sequence(results: Record<string, Result[]>) {
  const calls: Record<string, unknown[][][]> = {};
  const used: Record<string, number> = {};
  mocks.from.mockImplementation((table: string) => {
    const index = used[table] = (used[table] ?? -1) + 1;
    const log: unknown[][] = [];
    (calls[table] ??= []).push(log);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'not', 'limit', 'eq']) builder[method] = (...args: unknown[]) => { log.push([method, ...args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null, count: null, ...results[table]?.[index] });
    return builder;
  });
  return calls;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockImplementation(async () => ({ from: mocks.from }));
});

describe('주소록과 쓰는 상품 (A-3)', () => {
  it('주소마다 고른 상품 수와 앞의 상품 이름을 붙인다 — 보관한 상품도 센다', async () => {
    const calls = tables({
      return_addresses: { data: [address(A, '서울 센터'), address(B, '부산 센터')] },
      goods: { data: [good('a1', A), good('a2', A, { archived_at: '2026-11-01T00:00:00Z' }), good('b1', B)] },
    });
    const result = await loadAdminReturnAddresses();
    expect(result.map(({ id, goodsCount }) => [id, goodsCount])).toEqual([[A, 2], [B, 1]]);
    expect(result[0].goods).toEqual([{ id: 'a1', name: '상품 a1', archived: false }, { id: 'a2', name: '상품 a2', archived: true }]);
    expect(result[1].goods).toEqual([{ id: 'b1', name: '상품 b1', archived: false }]);
    /* 반품/교환지를 고른 상품만, 이름순으로 읽는다. */
    expect(calls.goods).toEqual(expect.arrayContaining([['select', 'id,name,archived_at,return_address_id', { count: 'exact' }], ['not', 'return_address_id', 'is', null], ['order', 'name']]));
  });
  /*
   * API가 한 번에 돌려주는 줄 수에는 상한(max_rows 1,000)이 있다. 반품/교환지를 고른 상품이 그보다 많으면 줄이 모자란 채 세게 되고,
   * 0개로 세어진 주소에 [삭제]가 열려 확인창이 '고른 상품은 없고'라고 말하게 된다. 받은 줄 수가 전체 수와 다르면 주소마다 정확히 다시 읽는다.
   */
  describe('상품이 한 번에 받을 수 있는 줄 수를 넘을 때', () => {
    const bulk = Array.from({ length: 1000 }, (_, index) => good(`b${String(index).padStart(4, '0')}`, B));
    it('주소마다 그 주소를 고른 상품의 전체 수와 이름순 앞의 다섯 개를 다시 읽는다 — 줄에서 잘려 나간 주소도 0개로 세지 않는다', async () => {
      const calls = sequence({
        return_addresses: [{ data: [address(A, '서울 센터'), address(B, '부산 센터')] }],
        goods: [{ data: bulk, count: 1500 }, { data: [good('a1', A), good('a2', A, { archived_at: '2026-11-01T00:00:00Z' })], count: 500 }, { data: bulk.slice(0, 5), count: 1000 }],
      });
      const result = await loadAdminReturnAddresses();
      expect(result.map(({ id, goodsCount }) => [id, goodsCount])).toEqual([[A, 500], [B, 1000]]);
      expect(result[0].goods).toEqual([{ id: 'a1', name: '상품 a1', archived: false }, { id: 'a2', name: '상품 a2', archived: true }]);
      expect(result[1].goods.map((entry) => entry.id)).toEqual(['b0000', 'b0001', 'b0002', 'b0003', 'b0004']);
      expect(calls.goods).toHaveLength(3);
      for (const [index, id] of [[1, A], [2, B]] as const) {
        expect(calls.goods[index]).toEqual([['select', 'id,name,archived_at', { count: 'exact' }], ['eq', 'return_address_id', id], ['order', 'name'], ['limit', 5]]);
      }
    });
    it('받은 줄 수가 전체 수와 같으면 다시 읽지 않는다', async () => {
      const calls = sequence({ return_addresses: [{ data: [address(A, '서울 센터')] }], goods: [{ data: [good('a1', A)], count: 1 }] });
      expect((await loadAdminReturnAddresses())[0].goodsCount).toBe(1);
      expect(calls.goods).toHaveLength(1);
    });
    it('전체 수를 받지 못했을 때도 모르는 채 세지 않고 주소마다 읽는다', async () => {
      const calls = sequence({ return_addresses: [{ data: [address(A, '서울 센터')] }], goods: [{ data: [good('a1', A)], count: null }, { data: [good('a1', A)], count: 1 }] });
      expect((await loadAdminReturnAddresses())[0]).toMatchObject({ goodsCount: 1, goods: [{ id: 'a1' }] });
      expect(calls.goods).toHaveLength(2);
    });
    it('주소마다 다시 읽다 틀리면(오류·전체 수 없음) 지어내지 않고 던진다', async () => {
      sequence({ return_addresses: [{ data: [address(A, '서울 센터')] }], goods: [{ data: bulk, count: 1500 }, { error: { message: 'x' } }] });
      await expect(loadAdminReturnAddresses()).rejects.toThrow('반품/교환지를 불러오지 못했습니다');
      sequence({ return_addresses: [{ data: [address(A, '서울 센터')] }], goods: [{ data: bulk, count: 1500 }, { data: [], count: null }] });
      await expect(loadAdminReturnAddresses()).rejects.toThrow('반품/교환지를 불러오지 못했습니다');
    });
  });
  it('이름은 다섯 개까지만 싣고 수는 전부 센다', async () => {
    tables({ return_addresses: { data: [address(A, '서울 센터')] }, goods: { data: Array.from({ length: 8 }, (_, index) => good(`g${index}`, A)) } });
    const [only] = await loadAdminReturnAddresses();
    expect(only.goodsCount).toBe(8);
    expect(only.goods.map((entry) => entry.id)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
  });
  it('상품이 없는 반품/교환지는 수 0과 빈 목록이다', async () => {
    tables({ return_addresses: { data: [address(A, '서울 센터')] }, goods: { data: [] } });
    expect(await loadAdminReturnAddresses()).toEqual([expect.objectContaining({ goodsCount: 0, goods: [] })]);
  });
  it('읽지 못하면 지어내지 않고 던진다', async () => {
    tables({ return_addresses: { data: [address(A, '서울 센터')] }, goods: { error: { message: 'x' } } });
    await expect(loadAdminReturnAddresses()).rejects.toThrow('반품/교환지를 불러오지 못했습니다');
    tables({ return_addresses: { data: [{ id: 'x' }] }, goods: { data: [] } });
    await expect(loadAdminReturnAddresses()).rejects.toThrow('반품/교환지를 불러오지 못했습니다');
  });
});

describe('저장 직후 상품 수', () => {
  it('이 반품/교환지를 고른 상품 수만 센다', async () => {
    const calls = tables({ goods: { count: 4 } });
    expect(await countReturnAddressGoods(A)).toBe(4);
    expect(calls.goods).toEqual([['select', 'id', { count: 'exact', head: true }], ['eq', 'return_address_id', A]]);
  });
  it('읽지 못하면 null이다(0으로 말하지 않는다)', async () => {
    tables({ goods: { error: { message: 'x' }, count: null } });
    expect(await countReturnAddressGoods(A)).toBeNull();
    tables({ goods: { count: null } });
    expect(await countReturnAddressGoods(A)).toBeNull();
  });
});

describe('상품 편집기 선택지', () => {
  it('이름과 주소만 돌려준다', async () => {
    tables({ return_addresses: { data: [address(A, '서울 센터')] } });
    expect(await loadGoodsReturnAddressOptions()).toEqual([{ id: A, name: '서울 센터', address: '서울 센터 주소' }]);
  });
});
