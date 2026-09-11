import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminCategoryExportRows, loadAdminCategoryWorkspace } from './category.server';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

function query(data: unknown, error: { message: string } | null = null) {
  const api = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    range: vi.fn(async () => ({ data: Array.isArray(data) ? data : [], error })),
    maybeSingle: vi.fn(async () => ({ data, error })),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  return api;
}

beforeEach(() => {
  mocks.createClient.mockResolvedValue({
    from(table: string) {
      if (table === 'catalog_categories') return query([
        { id: 'c1', code: 'life', name: '생활', parent_id: null, depth: 1, sort_order: 1, archived_at: null, updated_at: '2026-09-10T00:00:00Z' },
        { id: 'c2', code: 'paper', name: '문구', parent_id: 'c1', depth: 2, sort_order: 1, archived_at: null, updated_at: '2026-09-10T00:00:00Z' },
      ]);
      if (table === 'catalog_category_erp_mappings') return query([{ category_id: 'c2', erp_code: 'ERP-01', erp_name: '문구', source: 'erp-sheet', verified_at: '2026-09-10T00:00:00Z', verified_by: 'staff' }]);
      if (table === 'goods_type_category_migrations') return query([]);
      if (table === 'category_activation_control') return query({ id: 'catalog', customer_enabled: true, erp_enabled: false, evidence: { customer: { source: 'sheet', reference: 'CAT-01', verifiedAt: '2026-09-10T00:00:00Z' } }, updated_at: '2026-09-10T00:00:00Z' });
      return query([{ id: 'g1', category_id: 'c2' }]);
    },
  });
});

describe('admin category loader', () => {
  it('joins child and assigned counts while keeping ERP activation separate', async () => {
    const data = await loadAdminCategoryWorkspace();
    expect(data.categories[0]).toMatchObject({ childCount: 1, assignedGoodCount: 0 });
    expect(data.categories[1]).toMatchObject({ childCount: 0, assignedGoodCount: 1 });
    expect(data.activation).toMatchObject({ customerEnabled: true, erpEnabled: false });
  });

  it('exports missing ERP values as explicit unconfigured labels', async () => {
    const rows = await loadAdminCategoryExportRows();
    expect(rows[0]).toMatchObject({ path: '생활', erpCode: '미설정' });
    expect(rows[1]).toMatchObject({ path: '생활 > 문구', erpCode: 'ERP-01', assignedGoods: 1 });
  });
});
