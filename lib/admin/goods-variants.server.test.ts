import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminGoodsVariants } from './goods-variants.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

describe('admin goods variants server boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('combines the public option row with nullable private ERP fields', async () => {
    const range = vi.fn().mockResolvedValue({ data: [{
      id: '11111111-1111-4111-8111-111111111111',
      code: 'OWN-01', good_id: 'good-1', name: '기본 옵션', attributes: {}, price: 1000,
      stock_qty: 5, low_stock_threshold: 2, is_default: true, archived_at: null,
      updated_at: '2026-09-10T07:00:00.000Z',
    }], error: null });
    const query = {
      select: vi.fn(() => query), order: vi.fn(() => query), eq: vi.fn(() => query), range,
    };
    const rpc = vi.fn().mockResolvedValue({ data: [{
      variant_id: '11111111-1111-4111-8111-111111111111', good_id: 'good-1',
      erp_code: '0000123', erp_name: 'ERP 품명', barcode: '0007',
      updated_at: '2026-09-10T07:01:00.000Z',
    }], error: null });
    mocks.client = { from: vi.fn(() => query), rpc };

    await expect(loadAdminGoodsVariants('good-1')).resolves.toEqual([{
      id: '11111111-1111-4111-8111-111111111111', code: 'OWN-01', goodId: 'good-1', name: '기본 옵션', attributes: {},
      price: 1000, stockQty: 5, lowStockThreshold: 2, isDefault: true, archivedAt: null,
      updatedAt: '2026-09-10T07:00:00.000Z', erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
      externalUpdatedAt: '2026-09-10T07:01:00.000Z',
    }]);
    expect(rpc).toHaveBeenCalledWith('admin_list_goods_variant_external_identities', { target_good_id: 'good-1' });
  });

  it('keeps an option with no ERP row explicit and nullable', async () => {
    const query = {
      select: vi.fn(() => query), order: vi.fn(() => query), eq: vi.fn(() => query),
      range: vi.fn().mockResolvedValue({ data: [{
        id: '11111111-1111-4111-8111-111111111112', code: 'OWN-02', good_id: 'good-2', name: '옵션',
        attributes: {}, price: 2000, stock_qty: 0, low_stock_threshold: null, is_default: true,
        archived_at: null, updated_at: '2026-09-10T07:00:00.000Z',
      }], error: null }),
    };
    mocks.client = {
      from: vi.fn(() => query),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    await expect(loadAdminGoodsVariants('good-2')).resolves.toMatchObject([{
      erpCode: null, erpName: null, barcode: null, externalUpdatedAt: null,
    }]);
  });
});
