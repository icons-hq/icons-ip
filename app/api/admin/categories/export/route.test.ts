import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rows: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/category.server', () => ({ loadAdminCategoryExportRows: mocks.rows }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { throw error; } }));

import { GET } from './route';

describe('admin category export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
    mocks.rows.mockResolvedValue([{
      code: 'life', name: '생활', path: '생활', depth: 1, status: '사용', assignedGoods: 2,
      erpCode: 'ERP-01', erpName: '문구', erpSource: '실제 ERP 표', erpVerifiedAt: '2026-09-10T00:00:00Z',
    }, {
      code: 'paper', name: '=위험', path: '생활 > =위험', depth: 2, status: '사용', assignedGoods: 0,
      erpCode: '미설정', erpName: '미설정', erpSource: '미설정', erpVerifiedAt: '미설정',
    }]);
  });

  it('requires staff before reading export rows', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(GET()).rejects.toThrow('forbidden');
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it('returns private CSV with explicit unconfigured ERP values and formula-safe cells', async () => {
    const response = await GET();
    expect(mocks.guard).toHaveBeenCalledWith('/admin/catalog/categories');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('icons-category-erp.csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('"ERP 코드"');
    expect(csv).toContain('"미설정"');
    expect(csv).toContain('"\'=위험"');
  });
});
