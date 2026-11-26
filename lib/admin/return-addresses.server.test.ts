import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countReturnAddressGoods, loadAdminReturnAddresses, loadGoodsReturnAddressOptions } from './return-addresses.server';

const mocks = vi.hoisted(() => ({ from: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const address = (id: string, name: string) => ({ id, name, address: `${name} 주소`, phone: '02-1234-5678', updated_at: '2026-11-26T00:00:00Z' });
const good = (id: string, return_address_id: string | null, patch: Record<string, unknown> = {}) => ({ id, name: `상품 ${id}`, archived_at: null, return_address_id, ...patch });

/** 표마다 결과를 돌려주는 가짜 연결. `select(...)` 뒤로 이어지는 호출은 모두 같은 결과를 기다린다. */
function tables(results: Record<string, { data?: unknown; error?: unknown; count?: number | null }>) {
  const calls: Record<string, unknown[][]> = {};
  mocks.from.mockImplementation((table: string) => {
    calls[table] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'not', 'limit', 'eq']) builder[method] = (...args: unknown[]) => { calls[table].push([method, ...args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null, count: null, ...results[table] });
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
    expect(calls.goods).toEqual(expect.arrayContaining([['select', 'id,name,archived_at,return_address_id'], ['not', 'return_address_id', 'is', null], ['order', 'name']]));
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
