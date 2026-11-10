import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), range: vi.fn(), workspace: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('./category.server', () => ({ loadAdminCategoryWorkspace: mocks.workspace }));

import { loadErpItemsWorkspace } from './erp-items.server';

const item = (code: string) => ({
  code, name: `${code} 품명`, category: null, sale_price: null, barcode: null, mapped_category_id: null,
  imported_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.workspace.mockResolvedValue({ categories: [{ id: 'leaf' }], mappings: [{ categoryId: 'leaf', erpCode: 'K', erpName: '키링' }] });
  mocks.rpc.mockImplementation((name: string) => name === 'admin_list_erp_categories'
    ? { range: mocks.range }
    : Promise.resolve({ data: { total: 51, items: [item('A')] }, error: null }));
  mocks.range.mockResolvedValue({ data: [{ erp_category: '문구 > 키링', item_count: 2, category_id: null, updated_at: null, fallback_category_id: null }], error: null });
});

describe('ERP 품목 화면 로더', () => {
  it('목록·분류·고객 카테고리를 함께 읽고 페이지 범위를 RPC에 넘긴다', async () => {
    const data = await loadErpItemsWorkspace({ query: '키링', page: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_erp_items', { p_query: '키링', p_offset: 50, p_limit: 50 });
    expect(mocks.range).toHaveBeenCalledWith(0, 999);
    expect(data).toMatchObject({
      filters: { query: '키링', page: 2 },
      page: { total: 51, items: [{ code: 'A' }] },
      erpCategories: [{ erpCategory: '문구 > 키링', itemCount: 2 }],
      categories: [{ id: 'leaf' }],
      categoryErpMappings: [{ erpCode: 'K' }],
    });
  });

  it('마지막 페이지를 넘으면 마지막 페이지로 다시 읽는다', async () => {
    const data = await loadErpItemsWorkspace({ query: '', page: 9 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_erp_items', { p_query: null, p_offset: 50, p_limit: 50 });
    expect(data.filters.page).toBe(2);
  });

  it('분류가 1,000개를 넘으면 나눠 읽는다', async () => {
    mocks.range
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, index) => ({ erp_category: `분류 ${index}`, item_count: 1, category_id: null, updated_at: null, fallback_category_id: null })), error: null })
      .mockResolvedValueOnce({ data: [{ erp_category: '마지막', item_count: 1, category_id: null, updated_at: null, fallback_category_id: null }], error: null });
    const data = await loadErpItemsWorkspace({ query: '', page: 1 });
    expect(mocks.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(data.erpCategories).toHaveLength(1001);
  });

  it('형식이 다르거나 오류면 화면 오류로 알린다', async () => {
    mocks.range.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
    await expect(loadErpItemsWorkspace({ query: '', page: 1 })).rejects.toThrow('ERP 품목을 불러오지 못했습니다.');
    mocks.rpc.mockImplementation((name: string) => name === 'admin_list_erp_categories'
      ? { range: mocks.range }
      : Promise.resolve({ data: { total: 'x' }, error: null }));
    await expect(loadErpItemsWorkspace({ query: '', page: 1 })).rejects.toThrow('ERP 품목을 불러오지 못했습니다.');
  });
});
