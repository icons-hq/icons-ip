import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeShipmentsAction, exportPendingOriginShipmentsAction, exportShipmentsAction, saveShipmentExportColumnsAction } from './shipment-actions';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from '@/lib/admin/shipment-workbook';

const ID = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const STAMP = '2026-09-08T00:00:00Z';
const credentials = { password: '1234', passwordConfirmation: '1234' };
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), build: vi.fn(), encrypt: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/shipment-workbook.server', () => ({ buildShipmentExport: mocks.build }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_shipment_export' || name === 'admin_smartstore_shipment_export'
    ? { shipments: [{ id: ID, updatedAt: STAMP }] } : 1 }));
  mocks.build.mockResolvedValue({ bytes: Buffer.from('workbook'), mime: 'test/workbook', extension: 'xlsx', name: 'ICONS-출고지시-2026-10-12-남양주.xlsx' });
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-workbook'), sha256: 'a'.repeat(64) });
});

describe('shipment action boundaries', () => {
  it('counts all affected package members once even when only one member was selected', async () => {
    mocks.rpc.mockResolvedValue({data:[{id:ID,ok:true,affectedIds:[ID,SECOND]}],error:null});
    expect(await completeShipmentsAction([ID])).toEqual({message:'2건을 배송완료로 변경했습니다.',failed:[]});
  });
  it.each([null, { isConfigured: true, user: { id: 'buyer' }, isStaff: false }])('requires staff before reading export data', async (auth) => {
    mocks.auth.mockResolvedValue(auth ?? { isConfigured: true, user: null, isStaff: false });
    expect(await exportShipmentsAction([ID], 'xlsx')).toMatchObject({ error: '직원 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('marks the exact read version only after a file has been generated and encrypted', async () => {
    const result = await exportShipmentsAction([ID, ID.toUpperCase()], 'xlsx', 'smartstore', credentials);
    expect(result).toMatchObject({ file: { base64: Buffer.from('encrypted-workbook').toString('base64'), encryption: 'ECMA-376-Agile', sha256: 'a'.repeat(64) } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_smartstore_shipment_export', { p_ids: [ID] });
    expect(mocks.build).toHaveBeenCalledWith({ shipments: [{ id: ID, updatedAt: STAMP }] }, 'xlsx', 'smartstore');
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_mark_shipments_exported', { target_versions: [{ id: ID, updatedAt: STAMP }] });
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
  });
  it('does not record exported_at when file generation fails', async () => {
    mocks.build.mockRejectedValue(new Error('출고지시 양식 또는 상품 정보를 확인해주세요.'));
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials)).toMatchObject({ error: '출고지시 양식 또는 상품 정보를 확인해주세요.' });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_smartstore_shipment_export']);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('explains an incomplete production hold without generating or marking an export', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'production_incomplete' } });
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials)).toEqual({ error: '제작 완료를 확인한 뒤 출고지시·발송·교환 재출고를 진행해주세요.' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_smartstore_shipment_export', { p_ids: [ID] });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('withholds a generated file when a shipment changed before marking', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_smartstore_shipment_export'
      ? { data: { shipments: [{ id: ID, updatedAt: STAMP }] }, error: null }
      : { data: null, error: { message: 'shipment_changed' } });
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials)).toEqual({ error: '배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('names the downloaded file after the built warehouse file and explains a multi-warehouse ZIP', async () => {
    expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toMatchObject({ file: { name: 'ICONS-출고지시-2026-10-12-남양주.xlsx' }, message: '1건의 출고지시를 내려받았습니다.' });
    mocks.build.mockResolvedValue({ bytes: Buffer.from('zip'), mime: 'application/zip', extension: 'zip', name: 'ICONS-출고지시-2026-10-12-출고지별.zip' });
    mocks.rpc.mockImplementation(async (name:string)=>({error:null,data:name==='admin_shipment_export'?{shipments:[{id:ID,updatedAt:STAMP,originId:'first'},{id:SECOND,updatedAt:STAMP,originId:'second'}]}:2}));
    expect((await exportShipmentsAction([ID,SECOND], 'xlsx', 'warehouse')).message).toContain('출고지별 파일을 ZIP으로 묶었습니다.');
  });
  it('exports every not-yet-handed-over shipment of one warehouse and reports what is left beyond 1,000', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_origin_pending_export_ids' ? { ids: [ID], total: 1201 }
      : name === 'admin_shipment_export' ? { shipments: [{ id: ID, updatedAt: STAMP }] } : 1 }));
    const result = await exportPendingOriginShipmentsAction(SECOND, 'xlsx', 'warehouse');
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_origin_pending_export_ids', 'admin_shipment_export', 'admin_mark_shipments_exported']);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_origin_pending_export_ids', { target_origin_id: SECOND });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_export', { p_ids: [ID] });
    expect(result).toMatchObject({ file: { name: 'ICONS-출고지시-2026-10-12-남양주.xlsx' } });
    expect(result.message).toContain('남은 1,200건');
  });
  it('uses encrypted SmartStore by default for a whole origin and checks the password before reading IDs',async()=>{
    expect(await exportPendingOriginShipmentsAction(SECOND,'xlsx')).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation(async (name:string)=>({error:null,data:name==='admin_origin_pending_export_ids'?{ids:[ID],total:1}:name==='admin_smartstore_shipment_export'?{shipments:[{id:ID,updatedAt:STAMP}]}:1}));
    const result=await exportPendingOriginShipmentsAction(SECOND,'xlsx',undefined,credentials);
    expect(result.file?.encryption).toBe('ECMA-376-Agile');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_smartstore_shipment_export',{p_ids:[ID]});
    expect(mocks.build).toHaveBeenCalledWith({shipments:[{id:ID,updatedAt:STAMP}]},'xlsx','smartstore');
  });
  it('does not build a file when a warehouse has nothing new to hand over', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ids: [], total: 0 } });
    expect((await exportPendingOriginShipmentsAction(SECOND, 'xlsx', 'warehouse')).error).toContain('아직 전달하지 않은 발송 대기 배송 건이 없습니다');
    expect(await exportPendingOriginShipmentsAction('not-a-uuid', 'xlsx')).toEqual({ error: '출고지를 선택해주세요.' });
    expect(mocks.build).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    expect(await exportPendingOriginShipmentsAction(SECOND, 'xlsx', 'warehouse')).toEqual({ error: '직원 권한이 필요합니다.' });
  });
  it('keeps successful completions and reports failed shipment IDs', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: ID, ok: true }, { id: SECOND, ok: false, error: 'invalid_shipment_transition' }], error: null });
    expect(await completeShipmentsAction([ID, SECOND])).toEqual({ message: '1건을 배송완료로 변경했습니다.', failed: [{ id: SECOND, reason: '발주확인 또는 현재 배송 상태를 확인해주세요.' }] });
  });
  it('keeps the existing warehouse format available with the current RPC argument', async () => {
    expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toHaveProperty('file');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_export', { p_ids: [ID] });
    expect(mocks.build).toHaveBeenCalledWith({ shipments: [{ id: ID, updatedAt: STAMP }] }, 'xlsx', 'warehouse');
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it('requires a matching password before reading personal data for the default XLSX', async () => {
    expect(await exportShipmentsAction([ID], 'xlsx')).toHaveProperty('error');
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', { ...credentials, passwordConfirmation: 'Mismatch-1234' })).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('erases plaintext and does not mark an export when encryption fails', async () => {
    const plain = Buffer.from('workbook');
    mocks.build.mockResolvedValue({ bytes: plain, mime: 'test/workbook', extension: 'xlsx' });
    mocks.encrypt.mockImplementation(() => { throw new Error('파일을 암호화하지 못했습니다.'); });
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials)).toEqual({ error: '파일을 암호화하지 못했습니다.' });
    expect(plain.every(byte => byte === 0)).toBe(true);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_smartstore_shipment_export']);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('rejects unknown layouts before reading export data', async () => {
    expect(await exportShipmentsAction([ID], 'xlsx', 'unknown' as never)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
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
