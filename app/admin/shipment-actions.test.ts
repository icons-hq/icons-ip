import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeShipmentsAction, exportShipmentsAction, saveShipmentExportColumnsAction } from './shipment-actions';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from '@/lib/admin/shipment-workbook';

const ID = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const STAMP = '2026-09-08T00:00:00Z';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), build: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/shipment-workbook.server', () => ({ buildShipmentExport: mocks.build }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_shipment_export'
    ? { shipments: [{ id: ID, updatedAt: STAMP }] } : 1 }));
  mocks.build.mockResolvedValue({ bytes: Buffer.from('workbook'), mime: 'test/workbook', extension: 'xlsx' });
});

describe('shipment action boundaries', () => {
  it.each([null, { isConfigured: true, user: { id: 'buyer' }, isStaff: false }])('requires staff before reading export data', async (auth) => {
    mocks.auth.mockResolvedValue(auth ?? { isConfigured: true, user: null, isStaff: false });
    expect(await exportShipmentsAction([ID], 'xlsx')).toMatchObject({ error: '직원 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('marks the exact read version only after a file has been generated', async () => {
    const result = await exportShipmentsAction([ID, ID.toUpperCase()], 'xlsx');
    expect(result).toMatchObject({ file: { base64: Buffer.from('workbook').toString('base64') } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_export', { target_ids: [ID] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_mark_shipments_exported', { target_versions: [{ id: ID, updatedAt: STAMP }] });
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
  });
  it('does not record exported_at when file generation fails', async () => {
    mocks.build.mockRejectedValue(new Error('출고지시 양식 또는 상품 정보를 확인해주세요.'));
    expect(await exportShipmentsAction([ID], 'xlsx')).toMatchObject({ error: '출고지시 양식 또는 상품 정보를 확인해주세요.' });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_shipment_export']);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('withholds a generated file when a shipment changed before marking', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_shipment_export'
      ? { data: { shipments: [{ id: ID, updatedAt: STAMP }] }, error: null }
      : { data: null, error: { message: 'shipment_changed' } });
    expect(await exportShipmentsAction([ID], 'xlsx')).toEqual({ error: '배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('keeps successful completions and reports failed shipment IDs', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: ID, ok: true }, { id: SECOND, ok: false, error: 'invalid_shipment_transition' }], error: null });
    expect(await completeShipmentsAction([ID, SECOND])).toEqual({ message: '1건을 배송완료로 변경했습니다.', failed: [{ id: SECOND, reason: '발주확인 또는 현재 배송 상태를 확인해주세요.' }] });
  });
  it('rejects a 1001-row selection before DB access', async () => {
    expect(await completeShipmentsAction(Array.from({ length: 1001 }, () => ID))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('limits warehouse template changes to admins', async () => {
    expect(await saveShipmentExportColumnsAction(ID, DEFAULT_SHIPMENT_EXPORT_COLUMNS, STAMP)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
