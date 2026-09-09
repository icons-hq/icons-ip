import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsList } from './goods-list.server';
import { normalizeGoodsListFilters } from './goods-list';

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));
vi.mock('./catalog.server', () => ({ getAdminCatalogRecords: vi.fn() }));
vi.mock('./goods-variants.server', () => ({ loadAdminGoodsVariants: vi.fn() }));

type Result = { data: unknown[] | null; count?: number; error: { message: string } | null };
function database(results: Result[]) {
  const calls: unknown[][] = [];
  const query = (result: Result) => {
    const builder = {
      select: (...args: unknown[]) => { calls.push(['select', ...args]); return builder; },
      eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return builder; },
      is: (...args: unknown[]) => { calls.push(['is', ...args]); return builder; },
      not: (...args: unknown[]) => { calls.push(['not', ...args]); return builder; },
      or: (...args: unknown[]) => { calls.push(['or', ...args]); return builder; },
      gt: (...args: unknown[]) => { calls.push(['gt', ...args]); return builder; },
      order: (...args: unknown[]) => { calls.push(['order', ...args]); return builder; },
      range: (...args: unknown[]) => { calls.push(['range', ...args]); return builder; },
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };
  mocks.client = {
    rpc: (...args: unknown[]) => { calls.push(['rpc', ...args]); return query(results.shift()!); },
    from: (...args: unknown[]) => { calls.push(['from', ...args]); return query(results.shift()!); },
  };
  return calls;
}
beforeEach(() => { vi.clearAllMocks(); });
describe('goods list server boundary', () => {
  it('requests twenty summary rows and exact count without the full catalogue or option payload', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`, code: `CODE-${i}`, name: `상품 ${i}`, ip_id: 'draft-ip', ip: { title: '초안 IP' },
      published_at: null, archived_at: null, stock: 'ok', stock_qty: 0,
    }));
    const calls = database([{ data: rows, count: 1000, error: null }, { data: [{ id: 'draft-ip', title: '초안 IP', archived_at: null }], error: null }]);
    const result = await loadAdminGoodsList(normalizeGoodsListFilters({ q: 'CODE', page: '2', ipId: 'draft-ip', status: 'draft', stock: 'soldout' }));
    expect(result.goods).toHaveLength(20); expect(result.total).toBe(1000);
    expect(result.goods[0]).toMatchObject({ code: 'CODE-0', ipTitle: '초안 IP', publishedAt: null, stockQty: 0 });
    expect(calls).toContainEqual(['rpc', 'admin_search_goods', { search_text: 'CODE' }, { count: 'exact' }]);
    expect(calls).toContainEqual(['range', 20, 39]);
    expect(calls).toContainEqual(['eq', 'ip_id', 'draft-ip']);
    expect(calls).toContainEqual(['is', 'published_at', null]);
    expect(calls).toContainEqual(['or', 'stock.eq.soldout,stock_qty.eq.0']);
    expect(calls.filter(([kind]) => kind === 'from')).toEqual([['from', 'ips']]);
  });
  it('corrects a now-empty page after deletion and returns a useful infrastructure error', async () => {
    database([{ data: [], count: 20, error: null }, { data: [], count: 20, error: null }, { data: [], error: null }]);
    expect((await loadAdminGoodsList(normalizeGoodsListFilters({ page: '99' }))).filters.page).toBe(1);
    database([{ data: null, error: { message: 'postgres private connection diagnostic' } }]);
    await expect(loadAdminGoodsList(normalizeGoodsListFilters({}))).rejects.toThrow('상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  });
});
