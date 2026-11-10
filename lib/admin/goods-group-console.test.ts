import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_FILTERS, goodsGroupConsoleHref, normalizeGoodsGroupFilters, parseGoodsGroupConsole, parseGoodsGroupFilters } from './goods-group-console';

describe('group console search contract', () => {
  it('preserves filters through the shared URL, including KST calendar bounds and paging', () => {
    const filters = { ...DEFAULT_GROUP_FILTERS, query: '코드 & 001', field: 'code' as const, status: 'draft' as const, from: '2026-02-01', to: '2026-02-28', page: 3, pageSize: 100, sort: 'name_asc' as const };
    expect(normalizeGoodsGroupFilters(Object.fromEntries(new URL(goodsGroupConsoleHref(filters), 'https://example.test').searchParams))).toEqual(filters);
    expect(parseGoodsGroupFilters(filters)).toEqual(filters);
  });
  it('rejects unvalidated action filters instead of silently changing the requested scope', () => {
    for (const patch of [{ page: 0 }, { page: '1' }, { pageSize: 10000 }, { status: 'approval' }, { from: '2026-02-30' }, { from: '2026-03-01', to: '2026-02-01' }, { categoryId: 'not-a-uuid' }, { extra: true }]) expect(parseGoodsGroupFilters({ ...DEFAULT_GROUP_FILTERS, ...patch })).toBeNull();
  });
  it('requires disjoint server status counts and metadata for exactly the returned rows', () => {
    const page = { rows: [], total: 0, page: 1, pageSize: 50, counts: { all: 3, published: 1, draft: 1, archived: 1 }, metadata: {} };
    expect(parseGoodsGroupConsole(page)).toEqual(page);
    expect(parseGoodsGroupConsole({ ...page, counts: { ...page.counts, all: 4 } })).toBeNull();
    expect(parseGoodsGroupConsole({ ...page, total: 4 })).toBeNull();
    expect(parseGoodsGroupConsole({ ...page, metadata: { unknown: {} } })).toBeNull();
  });
});
