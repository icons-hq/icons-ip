import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDispatchDeliveryAction, completeShipmentsAction, exportPendingOriginShipmentsAction, exportShipmentsAction, originBarcodeGapsAction, readDispatchDeliveryOptionsAction, registerShipmentTrackingAction, saveShipmentExportColumnsAction, shipmentBarcodeGapsAction } from './shipment-actions';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from '@/lib/admin/shipment-workbook';

const ID = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const STAMP = '2026-09-08T00:00:00Z';
const credentials = { password: '1234', passwordConfirmation: '1234' };
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), build: vi.fn(), encrypt: vi.fn(), refresh: vi.fn(), carriers: vi.fn(), enqueue: vi.fn() }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ enqueueOrderShippedEmails: mocks.enqueue }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/shipment-workbook.server', () => ({ buildShipmentExport: mocks.build }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_shipment_export' || name === 'admin_smartstore_shipment_export'
    ? { shipments: [{ id: ID, updatedAt: STAMP }] } : name === 'admin_shipment_barcode_gaps' ? 0 : 1 }));
  mocks.build.mockResolvedValue({ bytes: Buffer.from('workbook'), mime: 'test/workbook', extension: 'xlsx', name: 'icons-출고지시-남양주-20261012-0900.xlsx' });
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-workbook'), sha256: 'a'.repeat(64) });
});

describe('shipment action boundaries', () => {
  it('물류출고관리는 출고지시를 내려받고 배송완료하며, 출고 권한이 없는 매니저는 RPC 전에 막는다 (1014-084)', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture('logistics'), isConfigured: true, user: { id: 'logistics' }, isStaff: true, role: 'staff' });
    expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toMatchObject({ message: '1건의 출고지시를 내려받았습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: ID, ok: true }], error: null });
    expect(await completeShipmentsAction([ID])).toEqual({ message: '1건을 배송완료로 변경했습니다.', failed: [] });
    for (const role of ['deputy', 'influencer', 'agency'] as const) {
      mocks.rpc.mockClear();
      mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture(role), isConfigured: true, user: { id: role }, isStaff: true, role: 'staff' });
      expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toEqual({ error: '직원 권한이 필요합니다.' });
      expect(await completeShipmentsAction([ID])).toEqual({ error: '직원 권한이 필요합니다.' });
      expect(await shipmentBarcodeGapsAction([ID])).toBeNull();
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });
  it('수령인 정보만: 출고 전용 운영자의 표준 양식은 구매자·결제·금액을 모든 줄에서 비우고 금액 배분을 읽지 않는다 (1014-084)', async () => {
    const detail = { itemId: SECOND, buyerName: '구매자', buyerId: ID, paidAt: STAMP, paymentMethod: 'card', productPrice: null, optionPrice: null,
      itemTotal: null, itemDiscount: 300, sellerDiscount: 300, regionalShippingFee: 3000, shippingDiscount: 500, orderNumber: '2026111110000001' };
    const exported = { shipments: [{ id: ID, updatedAt: STAMP, shippingFee: 3000, shippingCollectFee: 4000,
      pack: { id: SECOND, revision: 1, count: 2, shipmentIds: [ID, SECOND], collectFee: 4000, canRelease: true },
      lines: [{ orderId: ID, recipient: '수령인', smartstore: detail }, { orderId: ID, recipient: '수령인', smartstore: { ...detail, itemTotal: 1700 } }] }] };
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_smartstore_shipment_export' ? structuredClone(exported) : 1 }));
    mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture('logistics'), isConfigured: true, user: { id: 'logistics' }, isStaff: true, role: 'staff' });
    expect(await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials)).toMatchObject({ file: { encryption: 'ECMA-376-Agile' } });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('admin_order_item_allocation_inputs');
    const built = mocks.build.mock.calls[0][0] as typeof exported;
    expect(built.shipments[0]).toMatchObject({ id: ID, shippingFee: null, shippingCollectFee: null, pack: { collectFee: null, count: 2 } });
    for (const line of built.shipments[0].lines) {
      expect(line.recipient).toBe('수령인');
      expect(line.smartstore).toMatchObject({ orderNumber: '2026111110000001', buyerName: null, buyerId: null, paidAt: null, paymentMethod: null,
        itemTotal: null, itemDiscount: null, sellerDiscount: null, regionalShippingFee: null, shippingDiscount: null });
    }
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_mark_shipments_exported', { target_versions: [{ id: ID, updatedAt: STAMP }] });
  });
  it('주문 조회 권한이 있는 주매니저의 표준 양식 자료는 지금과 같다 (1014-084)', async () => {
    const exported = { shipments: [{ id: ID, updatedAt: STAMP, shippingFee: 3000, shippingCollectFee: 0,
      lines: [{ orderId: ID, recipient: '수령인', smartstore: { itemId: SECOND, buyerName: '구매자', paymentMethod: 'card', itemTotal: 1700, itemDiscount: 300 } }] }] };
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_smartstore_shipment_export' ? structuredClone(exported) : 1 }));
    mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture('primary'), isConfigured: true, user: { id: 'primary' }, isStaff: true, role: 'staff' });
    await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials);
    expect(mocks.build).toHaveBeenCalledWith(exported, 'xlsx', 'smartstore');
  });
  it('창고 고유 양식은 출고 전용 운영자도 받은 자료 그대로 만든다 (1014-084 범위 밖)', async () => {
    const exported = { shipments: [{ id: ID, updatedAt: STAMP, shippingFee: 3000, lines: [{ orderId: ID, recipient: '수령인', unitPrice: 1000 }] }] };
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_shipment_export' ? structuredClone(exported) : name === 'admin_shipment_barcode_gaps' ? 0 : 1 }));
    mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture('logistics'), isConfigured: true, user: { id: 'logistics' }, isStaff: true, role: 'staff' });
    await exportShipmentsAction([ID], 'xlsx', 'warehouse');
    expect(mocks.build).toHaveBeenCalledWith(exported, 'xlsx', 'warehouse');
  });
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
    expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toMatchObject({ file: { name: 'icons-출고지시-남양주-20261012-0900.xlsx' }, message: '1건의 출고지시를 내려받았습니다.' });
    mocks.build.mockResolvedValue({ bytes: Buffer.from('zip'), mime: 'application/zip', extension: 'zip', name: 'icons-출고지시-출고지별-20261012-0900.zip' });
    mocks.rpc.mockImplementation(async (name:string)=>({error:null,data:name==='admin_shipment_export'?{shipments:[{id:ID,updatedAt:STAMP,originId:'first'},{id:SECOND,updatedAt:STAMP,originId:'second'}]}:2}));
    expect((await exportShipmentsAction([ID,SECOND], 'xlsx', 'warehouse')).message).toContain('출고지별 파일을 ZIP으로 묶었습니다.');
  });
  it('exports every not-yet-handed-over shipment of one warehouse and reports what is left beyond 1,000', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_origin_pending_export_ids' ? { ids: [ID], total: 1201 }
      : name === 'admin_shipment_export' ? { shipments: [{ id: ID, updatedAt: STAMP }] } : 1 }));
    const result = await exportPendingOriginShipmentsAction(SECOND, 'xlsx', 'warehouse');
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['admin_origin_pending_export_ids', 'admin_shipment_export', 'admin_mark_shipments_exported', 'admin_shipment_barcode_gaps']);
    // 바코드 빈칸은 이번에 실제로 내보낸 묶음으로 다시 센다(리뷰 M27-SHIP-1).
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_barcode_gaps', { p_ids: [ID] });
    expect(result.message).toContain('바코드가 없는 옵션 1개 — 파일의 바코드 칸이 비어 있습니다.');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_origin_pending_export_ids', { target_origin_id: SECOND });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_export', { p_ids: [ID] });
    expect(result).toMatchObject({ file: { name: 'icons-출고지시-남양주-20261012-0900.xlsx' } });
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
  it('records the Seowon name suffixes of the exported file in the same call that marks the handover', async () => {
    const line = { shipmentId: ID, orderId: 'o', recipient: '김영생', phone: '01012345678', postalCode: '04524', address: '서울', goodCode: '', variantCode: '', goodName: '키링', optionName: '', qty: 1, unitPrice: 1000, deliveryNote: '', carrier: 'epost' };
    const seowon = (id: string, shipmentNumber: string) => ({ id, shipmentNumber, updatedAt: STAMP, originId: 'namyangju', originName: '남양주', shippingFee: 0, template: 'seowon_xlsx', columns: [], lines: [{ ...line, shipmentId: id }] });
    mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'admin_shipment_export'
      ? { shipments: [seowon(SECOND, '2026102730000002'), seowon(ID, '2026102730000001')] } : 2 }));
    expect(await exportShipmentsAction([ID, SECOND], 'xlsx', 'warehouse')).toHaveProperty('file');
    const call = mocks.rpc.mock.calls.find(([name]) => name === 'admin_mark_seowon_shipments_exported')!;
    expect(call[1]).toMatchObject({ target_versions: [{ id: SECOND, updatedAt: STAMP }, { id: ID, updatedAt: STAMP }],
      target_labels: [{ shipmentId: SECOND, suffix: '02' }, { shipmentId: ID, suffix: '01' }] });
    expect(call[1].target_batch).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_mark_shipments_exported', expect.anything());
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

describe('내보내기 전 바코드 경고 조회', () => {
  it('선택한 배송 건의 바코드가 비는 옵션 수를 읽는다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: 3 });
    expect(await shipmentBarcodeGapsAction([ID, ID.toUpperCase(), SECOND])).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_shipment_barcode_gaps', { p_ids: [ID, SECOND] });
  });
  it('경고는 출고를 막지 않으므로 권한·입력·조회 실패는 숫자 대신 null이다', async () => {
    expect(await shipmentBarcodeGapsAction([])).toBeNull();
    expect(await shipmentBarcodeGapsAction(['not-a-uuid'])).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ error: { message: 'operator_capability_required' }, data: null });
    expect(await shipmentBarcodeGapsAction([ID])).toBeNull();
    mocks.rpc.mockResolvedValue({ error: null, data: -1 });
    expect(await shipmentBarcodeGapsAction([ID])).toBeNull();
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    mocks.rpc.mockClear();
    expect(await shipmentBarcodeGapsAction([ID])).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('기존 창고 양식 내보내기는 누른 시점에 실제로 내보낸 배송 건으로 다시 세어 상태 문구에 싣는다', async () => {
    // 리뷰 M27-SHIP-1: 화면의 경고는 선택이 바뀔 때만 다시 읽어, 그 사이 바코드를 고치거나 지우면 옛 개수가 남는다.
    let missing: number | null = 2;
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_shipment_barcode_gaps'
      ? (missing === null ? { error: { message: 'boom' }, data: null } : { error: null, data: missing })
      : { error: null, data: name === 'admin_shipment_export' ? { shipments: [{ id: ID, updatedAt: STAMP }, { id: SECOND, updatedAt: STAMP }] } : 2 });
    const result = await exportShipmentsAction([ID, SECOND], 'xlsx', 'warehouse');
    expect(result.file).toBeDefined();
    expect(result.message).toBe('2건의 출고지시를 내려받았습니다. 바코드가 없는 옵션 2개 — 파일의 바코드 칸이 비어 있습니다.');
    const names = mocks.rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual(['admin_shipment_export', 'admin_mark_shipments_exported', 'admin_shipment_barcode_gaps']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_shipment_barcode_gaps', { p_ids: [ID, SECOND] });
    // 바코드를 다 채웠으면 경고를 싣지 않는다. 경고 조회가 실패해도 내려받기는 그대로 성공한다.
    missing = 0;
    expect((await exportShipmentsAction([ID, SECOND], 'xlsx', 'warehouse')).message).toBe('2건의 출고지시를 내려받았습니다.');
    missing = null;
    const failedLookup = await exportShipmentsAction([ID, SECOND], 'xlsx', 'warehouse');
    expect(failedLookup.file).toBeDefined();
    expect(failedLookup.message).toBe('2건의 출고지시를 내려받았습니다.');
  });
  it('ICONS 표준 양식과 실패한 내보내기는 바코드 빈칸을 세지 않는다', async () => {
    await exportShipmentsAction([ID], 'xlsx', 'smartstore', credentials);
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_shipment_barcode_gaps', expect.anything());
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_shipment_export'
      ? { error: null, data: { shipments: [{ id: ID, updatedAt: STAMP }] } }
      : { error: { message: 'shipment_changed' }, data: null });
    expect(await exportShipmentsAction([ID], 'xlsx', 'warehouse')).toEqual({ error: '배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.' });
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_shipment_barcode_gaps', expect.anything());
  });
  it('출고지 경고는 무거운 미전달 목록 RPC 없이 출고지 단위로 한 번에 센다', async () => {
    // 리뷰 M27-SHIP-2: 탭을 열 때마다 admin_origin_pending_export_ids(대기 3,000건에서 약 0.3~0.4초)를 부르던 경로.
    mocks.rpc.mockResolvedValue({ error: null, data: 2 });
    expect(await originBarcodeGapsAction(ID.toUpperCase())).toBe(2);
    expect(mocks.rpc.mock.calls).toEqual([['admin_shipment_barcode_gaps', { p_origin_id: ID }]]);
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_origin_pending_export_ids', expect.anything());
    mocks.rpc.mockResolvedValue({ error: { message: 'operator_capability_required' }, data: null });
    expect(await originBarcodeGapsAction(ID)).toBeNull();
    mocks.rpc.mockClear();
    expect(await originBarcodeGapsAction('gimpo')).toBeNull();
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    expect(await originBarcodeGapsAction(ID)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('발송 대기 행 운송장·배송 방법 액션 (S36-072·S36-X04)', () => {
  const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
    { code: 'retired', label: '종료 택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];
  const ORDER = '00000000-0000-4000-8000-0000000000aa';
  const OPERATION = '00000000-0000-4000-8000-0000000000ff';
  beforeEach(() => { mocks.carriers.mockResolvedValue(carriers); mocks.enqueue.mockResolvedValue({ queued: 1 }); });

  it('행 운송장은 직원만, 사용 중 택배사·형식을 확인한 뒤 파일 회신과 같은 일괄 등록 RPC로 보낸다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'hanjin', trackingNumber: '123456789012' }])).toEqual({ ok: false, error: '직원 권한이 필요합니다.' });
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'retired', trackingNumber: '123456789012' }])).toMatchObject({ ok: false, error: expect.stringContaining('택배사') });
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'hanjin', trackingNumber: '12-34' }])).toMatchObject({ ok: false, error: expect.stringContaining('8~30자리') });
    expect(await registerShipmentTrackingAction([{ shipmentId: 'not-a-shipment', carrier: 'hanjin', trackingNumber: '123456789012' }])).toMatchObject({ ok: false });
    expect(await registerShipmentTrackingAction([])).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: [{ line: 1, reference: ID, ok: true, shipmentId: ID, orderId: ORDER, dispatched: true, packedShipments: [{ orderId: ORDER, shipmentId: ID }] }], error: null });
    const result = await registerShipmentTrackingAction([{ shipmentId: ID.toUpperCase(), carrier: 'hanjin', trackingNumber: '1234-5678-9012' }]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_shipment_tracking_batch', { target_rows: [{ line: 1, reference: ID, carrier: 'hanjin', trackingNumber: '123456789012' }] });
    expect(mocks.enqueue).toHaveBeenCalledWith([{ orderId: ORDER, shipmentId: ID }]);
    expect(result).toMatchObject({ ok: true, registered: [ID], unchanged: [], failed: [], queueWarning: false });
    expect(mocks.refresh).toHaveBeenCalledWith('/admin/sales/dispatch');
    expect(mocks.refresh).toHaveBeenCalledWith('/admin/sales/orders/[orderId]', 'page');
  });

  it('이미 다른 운송장으로 발송된 건은 덮어쓰지 않고 행 사유로 돌려주며, 메일 대기열 실패는 경고로 남긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ line: 1, reference: ID, ok: false, error: 'shipment_tracking_conflict' }], error: null });
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'hanjin', trackingNumber: '123456789012' }]))
      .toMatchObject({ ok: true, registered: [], failed: [{ shipmentId: ID, reason: expect.stringContaining('덮어쓰지 않습니다') }] });
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: [{ line: 1, reference: ID, ok: true, shipmentId: ID, orderId: ORDER, dispatched: true }], error: null });
    mocks.enqueue.mockRejectedValue(new Error('queue'));
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'hanjin', trackingNumber: '123456789012' }])).toMatchObject({ ok: true, queueWarning: true });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipment_pack_incomplete' } });
    expect(await registerShipmentTrackingAction([{ shipmentId: ID, carrier: 'hanjin', trackingNumber: '123456789012' }])).toMatchObject({ ok: false });
  });

  it('배송 방법 팝업 정보는 1~100건만 읽고 응답 형식이 어긋나면 열지 않는다', async () => {
    expect(await readDispatchDeliveryOptionsAction([])).toMatchObject({ ok: false });
    expect(await readDispatchDeliveryOptionsAction(Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`))).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: { shipments: [], policies: [] }, error: null });
    expect(await readDispatchDeliveryOptionsAction([ID, ID])).toEqual({ ok: true, options: { shipments: [], policies: [] } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_dispatch_delivery_options', { p_shipment_ids: [ID] });
    mocks.rpc.mockResolvedValue({ data: { shipments: [{ id: ID }], policies: [] }, error: null });
    expect(await readDispatchDeliveryOptionsAction([ID])).toMatchObject({ ok: false });
  });

  it('방법 적용·인계는 형식을 확인해 같은 요청 번호로 DB에 맡기고, 다른 요청의 응답은 받지 않는다', async () => {
    const handoff = { operatorName: '출고 담당', providerName: '퀵 업체', providerPhone: '02-1234-5678', handoffReference: '인계 메모', occurredAt: '2026-11-11T01:00:00.000Z' };
    const input = { targets: [{ shipmentId: ID, updatedAt: '2026-11-11T00:00:00.123456+00:00' }], method: 'quick', reason: ' 고객 요청 ', handoff, operationId: OPERATION };
    expect(await applyDispatchDeliveryAction({ ...input, method: 'none' })).toMatchObject({ ok: false });
    expect(await applyDispatchDeliveryAction({ ...input, method: 'pickup' })).toMatchObject({ ok: false });
    expect(await applyDispatchDeliveryAction({ ...input, handoff: { ...handoff, extra: 'x' } })).toMatchObject({ ok: false });
    expect(await applyDispatchDeliveryAction({ ...input, targets: [{ shipmentId: ID, updatedAt: 'yesterday' }] })).toMatchObject({ ok: false });
    expect(await applyDispatchDeliveryAction({ ...input, reason: '가'.repeat(1001) })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const receipt = { operationId: OPERATION, method: 'quick', results: [{ shipmentId: ID, ok: true, methodChanged: true, handedOff: true }], changed: 1, handedOff: 1, failed: 0, replayed: false };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await applyDispatchDeliveryAction(input)).toEqual({ ok: true, receipt });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_dispatch_apply_delivery', { p_targets: input.targets, p_method: 'quick', p_reason: '고객 요청', p_handoff: handoff, p_operation_id: OPERATION });
    expect(mocks.refresh).toHaveBeenCalledWith('/orders/[orderId]', 'page');
    mocks.rpc.mockResolvedValue({ data: { ...receipt, operationId: SECOND }, error: null });
    expect(await applyDispatchDeliveryAction(input)).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operation_conflict' } });
    expect(await applyDispatchDeliveryAction(input)).toEqual({ ok: false, error: expect.stringContaining('같은 요청 번호') });
    mocks.rpc.mockClear();
    await applyDispatchDeliveryAction({ ...input, method: 'parcel', handoff: null, reason: '' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_dispatch_apply_delivery', expect.objectContaining({ p_method: 'parcel', p_reason: null, p_handoff: null }));
  });
});
