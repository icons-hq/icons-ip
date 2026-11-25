import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];
type Call = { columns: string; options?: { count?: string; head?: boolean }; steps: Step[] };
type Result = { data?: unknown; count?: number | null; error?: unknown };
const mocks = vi.hoisted(() => ({ calls: [] as Call[], resolve: (() => ({})) as (call: Call) => Result }));
/* 조회 줄(select → is → not → … )을 그대로 기록하고, await 하면 테스트가 정한 결과로 답하는 가짜 클라이언트. */
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe('goods');
      const call: Call = { columns: '', steps: [] };
      mocks.calls.push(call);
      const builder: unknown = new Proxy({}, { get: (_target, name: string) => {
        if (name === 'then') return (ok: (value: Result) => unknown, fail: (reason: unknown) => unknown) => Promise.resolve(mocks.resolve(call)).then(ok, fail);
        if (name === 'select') return (columns: string, options?: Call['options']) => { call.columns = columns; call.options = options; return builder; };
        return (...args: unknown[]) => { call.steps.push([name, ...args]); return builder; };
      } });
      return builder;
    },
  }),
}));
import { listGoodsDisplayOrder, readGoodsDisplayOrderSlot, GOODS_DISPLAY_ORDER_LOOKUP_ERROR } from './goods-display-order.server';

const has = (call: Call, ...step: Step) => call.steps.some((entry) => JSON.stringify(entry) === JSON.stringify(step));
const isCount = (call: Call) => call.options?.head === true;
const isList = (call: Call) => call.columns.includes('image_path');
const isPrevious = (call: Call) => call.steps.some(([name]) => name === 'or');
const row = (id: string, order: number, extra: Record<string, unknown> = {}) => ({ id, name: `상품 ${id}`, image_path: null, bg: null, display_order: order, published_at: '2026-11-01T00:00:00Z', ...extra });

beforeEach(() => { mocks.calls = []; vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('진열 순서 목록', () => {
  it('순서를 넣은 상품이 없으면 목록을 읽지 않고 빈 쪽을 돌려준다', async () => {
    mocks.resolve = () => ({ count: 0 });
    expect(await listGoodsDisplayOrder({ query: '', page: 3 })).toEqual({ rows: [], total: 0, page: 1, pageSize: 20 });
    expect(mocks.calls).toHaveLength(1);
  });

  it('보관하지 않고 번호를 넣은 상품을 번호 오름차순(같으면 상품 URL 순)으로 20개씩 읽는다', async () => {
    mocks.resolve = (call) => isCount(call) ? { count: 3 } : { data: [row('hw-a', 1), row('hw-b', 3), row('hw-c', 3, { published_at: null })] };
    const page = await listGoodsDisplayOrder({ query: '', page: 1 });
    const list = mocks.calls.find(isList)!;
    expect(list.columns).toBe('id,name,image_path,bg,display_order,published_at');
    for (const call of mocks.calls) { expect(has(call, 'is', 'archived_at', null)).toBe(true); expect(has(call, 'not', 'display_order', 'is', null)).toBe(true); }
    expect(list.steps.filter(([name]) => name === 'order')).toEqual([['order', 'display_order', { ascending: true }], ['order', 'id', { ascending: true }]]);
    expect(has(list, 'range', 0, 19)).toBe(true);
    expect(page.total).toBe(3);
    expect(page.rows.map((entry) => [entry.id, entry.order, entry.previousOrder, entry.published])).toEqual([['hw-a', 1, null, true], ['hw-b', 3, 1, true], ['hw-c', 3, 3, false]]);
    expect(mocks.calls.some(isPrevious)).toBe(false);
  });

  it('첫 쪽이 아니면 첫 줄의 바로 앞 줄 번호만 따로 읽고 나머지는 앞 줄의 번호를 쓴다', async () => {
    mocks.resolve = (call) => isCount(call) ? { count: 25 } : isPrevious(call) ? { data: [{ display_order: 7 }] } : { data: [row('hw-x', 9), row('hw-y', 10)] };
    const page = await listGoodsDisplayOrder({ query: '', page: 2 });
    expect(has(mocks.calls.find(isList)!, 'range', 20, 39)).toBe(true);
    const lookups = mocks.calls.filter(isPrevious);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].steps.find(([name]) => name === 'or')?.[1]).toBe('display_order.lt.9,and(display_order.eq.9,id.lt."hw-x")');
    expect(has(lookups[0], 'order', 'display_order', { ascending: false })).toBe(true);
    expect(has(lookups[0], 'limit', 1)).toBe(true);
    expect(page.rows.map((entry) => entry.previousOrder)).toEqual([7, 9]);
  });

  it('범위를 넘은 쪽은 마지막 유효 쪽으로 보정한다', async () => {
    mocks.resolve = (call) => isCount(call) ? { count: 25 } : isPrevious(call) ? { data: [] } : { data: [row('hw-z', 30)] };
    const page = await listGoodsDisplayOrder({ query: '', page: 9 });
    expect(page.page).toBe(2);
    expect(has(mocks.calls.find(isList)!, 'range', 20, 39)).toBe(true);
  });

  it('검색하면 상품명에서 찾고(와일드카드는 글자 그대로) 줄마다 바로 앞 줄 번호를 따로 읽는다', async () => {
    mocks.resolve = (call) => {
      if (isCount(call)) return { count: 2 };
      if (isPrevious(call)) return { data: String(call.steps.find(([name]) => name === 'or')?.[1]).includes('.lt.5,') ? [{ display_order: 2 }] : [] };
      return { data: [row('hw-p', 5), row('hw-q', 8)] };
    };
    const page = await listGoodsDisplayOrder({ query: '키링%_', page: 1 });
    for (const call of mocks.calls.filter((entry) => isCount(entry) || isList(entry))) expect(has(call, 'ilike', 'name', '%키링\\%\\_%')).toBe(true);
    expect(mocks.calls.filter(isPrevious)).toHaveLength(2);
    expect(page.rows.map((entry) => [entry.order, entry.previousOrder])).toEqual([[5, 2], [8, null]]);
  });

  it('상품 URL에 따옴표·역슬래시가 있어도 한 값으로 묶어 묻는다', async () => {
    mocks.resolve = (call) => isCount(call) ? { count: 1 } : isPrevious(call) ? { data: [] } : { data: [row('a"b\\c', 4)] };
    await listGoodsDisplayOrder({ query: '찾기', page: 1 });
    expect(mocks.calls.find(isPrevious)!.steps.find(([name]) => name === 'or')?.[1]).toBe('display_order.lt.4,and(display_order.eq.4,id.lt."a\\"b\\\\c")');
  });

  it('사진은 올린 사진이 우선이고 없으면 옛 배경 이미지를 쓴다', async () => {
    mocks.resolve = (call) => isCount(call) ? { count: 3 } : { data: [row('hw-a', 1, { image_path: 'goods/a.png' }), row('hw-b', 2, { bg: 'url("/generated/b.png") center / cover no-repeat' }), row('hw-c', 3)] };
    const page = await listGoodsDisplayOrder({ query: '', page: 1 });
    expect(page.rows.map((entry) => entry.imageUrl)).toEqual(['https://example.supabase.co/storage/v1/object/public/public-media/goods/a.png', '/generated/b.png', null]);
  });

  it('읽지 못하거나 모양이 틀린 줄이 있으면 오류를 던진다', async () => {
    mocks.resolve = () => ({ error: { message: 'down' } });
    await expect(listGoodsDisplayOrder({ query: '', page: 1 })).rejects.toThrow(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
    mocks.resolve = (call) => isCount(call) ? { count: 1 } : { data: [row('hw-a', 1, { display_order: null })] };
    await expect(listGoodsDisplayOrder({ query: '', page: 1 })).rejects.toThrow(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  });
});

describe('번호를 쓰는 상품', () => {
  it('그 번호를 쓰는 다른 상품의 이름 몇 개와 전체 개수를 준다', async () => {
    mocks.resolve = () => ({ data: [{ name: '키링' }, { name: '스티커' }], count: 5 });
    expect(await readGoodsDisplayOrderSlot(4, 'hw-self')).toEqual({ order: 4, names: ['키링', '스티커'], total: 5 });
    const call = mocks.calls[0];
    expect(has(call, 'eq', 'display_order', 4)).toBe(true);
    expect(has(call, 'neq', 'id', 'hw-self')).toBe(true);
    expect(has(call, 'limit', 3)).toBe(true);
  });
  it('새 상품은 제외할 상품이 없다', async () => {
    mocks.resolve = () => ({ data: [], count: 0 });
    expect(await readGoodsDisplayOrderSlot(0, null)).toEqual({ order: 0, names: [], total: 0 });
    expect(mocks.calls[0].steps.some(([name]) => name === 'neq')).toBe(false);
  });
  it('읽지 못하면 오류를 던진다', async () => {
    mocks.resolve = () => ({ error: { message: 'down' } });
    await expect(readGoodsDisplayOrderSlot(1, null)).rejects.toThrow(GOODS_DISPLAY_ORDER_LOOKUP_ERROR);
  });
});
