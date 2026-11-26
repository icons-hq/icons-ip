import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn(), origins: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('./fulfillment-origins.server', () => ({ loadGoodsFulfillmentOptions: mocks.origins }));
import { loadGoodsExportNames } from './goods-export-names.server';
import { normalizeGoodsListFilters } from './goods-list';

const CATEGORY = '3f2c8e1a-0000-4000-8000-000000000001';
const ORIGIN = '3f2c8e1a-0000-4000-8000-000000000002';
const calls: { table: string; columns: string; column: string; value: string }[] = [];
let rows: Record<string, { data: Record<string, unknown> | null }> = {};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rows = { ips: { data: { title: '메이플스토리' } }, catalog_categories: { data: { name: '키링' } } };
  mocks.client.mockResolvedValue({
    from: (table: string) => ({ select: (columns: string) => ({ eq: (column: string, value: string) => ({
      maybeSingle: async () => { calls.push({ table, columns, column, value }); return rows[table]; },
    }) }) }),
  });
  mocks.origins.mockResolvedValue([{ id: 'other', name: '남양주' }, { id: ORIGIN, name: '김포' }]);
});

describe('엑셀 내보내기가 조건을 되읽을 이름', () => {
  it('걸리지 않은 조건은 읽지 않는다', async () => {
    expect(await loadGoodsExportNames(normalizeGoodsListFilters({ q: '머그', stock: 'low' }))).toEqual({ ip: null, category: null, origin: null });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.origins).not.toHaveBeenCalled();
  });

  it('걸린 IP·카테고리·출고지의 이름만 읽는다', async () => {
    const names = await loadGoodsExportNames(normalizeGoodsListFilters({ ipId: 'maple', categoryId: CATEGORY, originId: ORIGIN }));
    expect(names).toEqual({ ip: '메이플스토리', category: '키링', origin: '김포' });
    expect(calls).toEqual([
      { table: 'ips', columns: 'title', column: 'id', value: 'maple' },
      { table: 'catalog_categories', columns: 'name', column: 'id', value: CATEGORY },
    ]);
  });

  it('없는 IP·카테고리·출고지는 이름 없이 둔다', async () => {
    rows = { ips: { data: null }, catalog_categories: { data: null } };
    mocks.origins.mockResolvedValue([]);
    expect(await loadGoodsExportNames(normalizeGoodsListFilters({ ipId: 'gone', categoryId: CATEGORY, originId: ORIGIN }))).toEqual({ ip: null, category: null, origin: null });
  });

  it('이름을 못 읽어도 내려받기를 막지 않는다(그 이름만 비운다)', async () => {
    mocks.client.mockRejectedValue(new Error('db down'));
    mocks.origins.mockRejectedValue(new Error('rpc down'));
    expect(await loadGoodsExportNames(normalizeGoodsListFilters({ ipId: 'maple', categoryId: CATEGORY, originId: ORIGIN }))).toEqual({ ip: null, category: null, origin: null });
  });

  it('Next가 화면 흐름으로 던진 오류(이동·404)는 삼키지 않는다', async () => {
    mocks.client.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }));
    await expect(loadGoodsExportNames(normalizeGoodsListFilters({ ipId: 'maple' }))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
  });
});
