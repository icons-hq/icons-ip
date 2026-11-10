const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkRegisterAdminOrderTrackingAction } from './order-actions';
import ExcelJS from 'exceljs';
import {GIMPO_EXPORT_HEADERS,SEOWON_EXPORT_HEADERS} from '@/lib/admin/warehouse-templates';
import {SEOWON_REPLY_REASONS} from '@/lib/admin/seowon-exchange';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), enqueue: vi.fn(), carriers: vi.fn(), refresh: vi.fn(), origins: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: (_column: string, template: string) => ({ eq: async () => mocks.origins(template) }) }) }) }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
vi.mock('@/lib/email/transactional.server',()=>({sendOrderShippedEmail:vi.fn(),sendOrderConfirmationEmail:vi.fn()}));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ enqueueOrderShippedEmails: mocks.enqueue }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
function form(text: string) { const data = new FormData(); data.set('pasted', text); return data; }
const warehouseOrder='00000000-0000-4000-8000-000000000042';
const warehouseOrigin='00000000-0000-4000-8000-000000000099';
async function warehouseForm(origin=warehouseOrigin){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('김포');sheet.addRow([...GIMPO_EXPORT_HEADERS]);
 for(let i=0;i<2;i++){const row=Array(21).fill('');row[8]=warehouseOrder;row[20]='001234567890';sheet.addRow(row);}
 const data=new FormData();data.set('file',new File([await workbook.xlsx.writeBuffer() as ArrayBuffer],'reply.xlsx'));data.set('originId',origin);return data;
}
const seowonOrigin='00000000-0000-4000-8000-000000042202';
const seowonShipment='60000000-0000-4000-8000-0000000000a1',seowonOrder='50000000-0000-4000-8000-0000000000a1';
const seowonLine={recipient:'합성 수취인',phone:'01012345678',postalCode:'04524',address:'서울특별시 중구 세종대로 110 101호',deliveryNote:'',qty:2};
const seowonCandidate=(overrides:Record<string,unknown>={})=>({id:seowonShipment,orderId:seowonOrder,status:'ready',carrier:null,trackingNumber:null,
  lines:[{...seowonLine,goodName:'합성 키링',optionName:'빨강'},{...seowonLine,goodName:'합성 엽서',optionName:'',qty:1}],...overrides});
/** 내려받은 송장양식(7열+덧붙인 6열) 오른쪽에 송장번호 열을 채운 서원 회신. */
async function seowonForm(rows:(string|number)[][],origin=''){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('송장양식');sheet.addRow([...SEOWON_EXPORT_HEADERS,'송장번호']);
 for(const row of rows)sheet.addRow(row);
 for(let i=0;i<5;i++)workbook.addWorksheet(`Sheet${i+1}`);
 const data=new FormData();data.set('file',new File([await workbook.xlsx.writeBuffer() as ArrayBuffer],'seowon-reply.xlsx'));data.set('originId',origin);return data;
}
const seowonRow=(items:string,quantity:number,tracking:string|number,phone='010-1234-5678',shipmentNumber='')=>[phone,'','04524','서울특별시 중구 세종대로 110 101호','',quantity,items,'합성 수취인','',shipmentNumber,'','','',tracking];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origins.mockImplementation(async (template: string) => ({ error: null, data: template === 'wms_csv' ? [{ id: warehouseOrigin, name: '김포' }] : [{ id: seowonOrigin, name: '남양주' }] }));
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() });
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }]);
  mocks.enqueue.mockResolvedValue({ queued: 1 });
  mocks.rpc.mockImplementation(async (_name: string, { target_rows }: { target_rows: { line: number; reference: string }[] }) => ({ error: null,
    data: target_rows.map((row) => ({ ...row, ok: true, dispatched: true, orderId: `00000000-0000-4000-8000-${String(row.line).padStart(12, '0')}`, shipmentId: `10000000-0000-4000-8000-${String(row.line).padStart(12, '0')}` })) }));
});
describe('bulk tracking action', () => {
  it('queues every original order in an imported package once and retains parser failures for the DB preflight',async()=>{
    const members=[{orderId:'order-one',shipmentId:'shipment-one'},{orderId:'order-two',shipmentId:'shipment-two'}];
    mocks.rpc.mockResolvedValue({error:null,data:[{line:1,reference:'00000001',ok:true,orderId:'order-one',shipmentId:'shipment-one',packedShipments:members},{line:2,reference:'00000002',ok:false,error:'invalid_tracking_input'}]});
    const result=await bulkRegisterAdminOrderTrackingAction({},form('00000001,hanjin,12345678\n00000002,hanjin,bad'));
    expect(mocks.rpc.mock.calls[0][1].target_rows).toHaveLength(2);expect(mocks.enqueue).toHaveBeenCalledWith(members);
    expect(result.report?.succeeded).toEqual(['00000001']);expect(result.report?.failed).toHaveLength(1);
  });
  it('shows packing conflicts without claiming a successful shipment or notification',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'shipment_pack_tracking_conflict'},data:null});
    const result=await bulkRegisterAdminOrderTrackingAction({},form('00000001,hanjin,12345678'));
    expect(result.errors?.form).toContain('같은 합포장');expect(result.report).toBeUndefined();expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('김포 회신은 출고지를 고르지 않아도 김포 양식의 사용 중 출고지가 하나면 그 출고지로 등록한다',async()=>{
    await bulkRegisterAdminOrderTrackingAction({},await warehouseForm(''));
    expect(mocks.origins).toHaveBeenCalledWith('wms_csv');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_warehouse_tracking_batch',expect.objectContaining({target_origin_id:warehouseOrigin}));
  });
  it('같은 양식의 출고지가 여러 곳이거나 없으면 출고지를 넘겨짚지 않고 DB 변경을 하지 않는다',async()=>{
    mocks.origins.mockResolvedValue({error:null,data:[{id:warehouseOrigin,name:'김포'},{id:seowonOrigin,name:'김포2'}]});
    expect((await bulkRegisterAdminOrderTrackingAction({},await warehouseForm(''))).errors?.form).toContain('여러 곳');
    mocks.origins.mockResolvedValue({error:null,data:[]});
    expect((await bulkRegisterAdminOrderTrackingAction({},await warehouseForm(''))).errors?.form).toContain('사용 중인 출고지가 없습니다');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('김포 회신은 서버 출고지 문맥으로 등록하고 중복 상품행을 한 건으로 센다',async()=>{
    mocks.rpc.mockResolvedValue({error:null,data:[
      {line:2,reference:warehouseOrder,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:true},
      {line:3,reference:warehouseOrder,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:false,duplicate:true},
    ]});
    const result=await bulkRegisterAdminOrderTrackingAction({},await warehouseForm());
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_warehouse_tracking_batch',{target_origin_id:warehouseOrigin,target_rows:[
      {line:2,reference:warehouseOrder,trackingNumber:'001234567890'},
      {line:3,reference:warehouseOrder,trackingNumber:'001234567890'},
    ]});
    expect(result.report?.succeeded).toEqual([warehouseOrder]);expect(mocks.enqueue).toHaveBeenCalledWith([{orderId:warehouseOrder,shipmentId:'shipment-one'}]);
  });
  it('상품주문번호 회신은 실제 item RPC로 보내고 같은 배송의 상품행을 중복 발송·메일 처리하지 않는다',async()=>{
    const firstItem='60000000-0000-4000-8000-000000000001',secondItem='60000000-0000-4000-8000-000000000002';
    const book=new ExcelJS.Workbook();book.addWorksheet('발송처리').addRows([
      ['상품주문번호','배송방법','택배사','송장번호'],[firstItem,'택배,등기,소포','한진택배','001234567890'],[secondItem,'택배,등기,소포','한진택배','001234567890'],
    ]);
    const input=new FormData();input.set('file',new File([await book.xlsx.writeBuffer() as ArrayBuffer],'smartstore-reply.xlsx'));
    mocks.rpc.mockResolvedValue({error:null,data:[
      {line:2,reference:firstItem,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:true,duplicate:false},
      {line:3,reference:secondItem,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:false,duplicate:true},
    ]});
    const result=await bulkRegisterAdminOrderTrackingAction({},input);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_item_tracking_batch',{target_rows:[
      {line:2,reference:firstItem,carrier:'hanjin',trackingNumber:'001234567890'},
      {line:3,reference:secondItem,carrier:'hanjin',trackingNumber:'001234567890'},
    ]});
    expect(result.report?.succeeded).toEqual([firstItem]);
    expect(mocks.origins).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith([{orderId:warehouseOrder,shipmentId:'shipment-one'}]);
  });
  it('출고지 양식과 기본 택배사 오류를 설명하고 메일을 만들지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'warehouse_template_required'},data:null});
    const result=await bulkRegisterAdminOrderTrackingAction({},await warehouseForm());
    expect(result.errors?.form).toContain('김포');expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('requires staff before parsing or writing a shipment', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, role: 'user', isStaff: false });
    expect(await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'))).toHaveProperty('errors.form');
    expect(mocks.carriers).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('accepts exactly 1000 rows and queues them without synchronous delivery', async () => {
    const text = Array.from({ length: 1000 }, (_, i) => `${i.toString(16).padStart(8, '0')},hanjin,${String(10000000 + i)}`).join('\n');
    const result = await bulkRegisterAdminOrderTrackingAction({}, form(text));
    expect(result.report?.succeeded).toHaveLength(1000); expect(result.report?.failed).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.rpc.mock.calls[0][0]).toBe('admin_import_shipment_tracking_batch');
    expect(mocks.enqueue.mock.calls[0][0]).toHaveLength(1000);
  });
  it('rejects 1001 rows, text files over 256KB and XLSX files over 1MB before shipment writes', async () => {
    const text = Array.from({ length: 1001 }, (_, i) => `${i.toString(16).padStart(8, '0')},hanjin,${String(10000000 + i)}`).join('\n');
    expect(await bulkRegisterAdminOrderTrackingAction({}, form(text))).toHaveProperty('errors.form');
    const data = form('00000001,hanjin,12345678'); data.set('file', new File(['x'.repeat(256 * 1024 + 1)], 'tracking.csv'));
    expect(await bulkRegisterAdminOrderTrackingAction({}, data)).toHaveProperty('errors.form');
    const workbook = form(''); workbook.set('file', new File(['x'.repeat(1024 * 1024 + 1)], 'tracking.xlsx'));
    expect(await bulkRegisterAdminOrderTrackingAction({}, workbook)).toHaveProperty('errors.form');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('merges parser and database failures by original line while keeping successful IDs', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [
      { line: 1, reference: '00000001', ok: true, orderId: 'order-one', shipmentId: 'shipment-one', dispatched: true },
      { line: 3, reference: '00000003', ok: false, error: 'shipment_not_found' },
      { line: 2, reference: 'invalid', ok: false, error: 'invalid_shipment_reference' },
    ] });
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678\ninvalid,hanjin,12345679\n00000003,hanjin,12345680'));
    expect(result.report?.succeeded).toEqual(['00000001']);
    expect(result.report?.failed.map((failure) => failure.line)).toEqual([2, 3]);
    expect(result.report?.failed[1].reason).toBe('배송 건을 찾을 수 없습니다.');
    expect(mocks.enqueue).toHaveBeenCalledWith([{ orderId: 'order-one', shipmentId: 'shipment-one' }]);
  });
  it('keeps committed shipment success and visibly warns when queue confirmation fails', async () => {
    mocks.enqueue.mockRejectedValue(new Error('queue unavailable'));
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'));
    expect(result.report?.succeeded).toEqual(['00000001']); expect(result.errors).toBeUndefined();
    expect(result.message).toContain('배송 메일 대기열 확인이 필요합니다.');
    expect(result.queueWarning).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledWith('/admin/sales/dispatch');
  });
  it('같은 운송장으로 이미 발송된 행은 등록으로 세지 않고 메일도 다시 만들지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [
      { line: 1, reference: '00000001', ok: true, orderId: 'order-one', shipmentId: 'shipment-one', dispatched: false, unchanged: true },
    ] });
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'));
    expect(result.errors).toBeUndefined(); expect(result.message).toContain('이미 발송된 1건은 그대로');
    expect(result.report).toEqual({ succeeded: [], failed: [], unchanged: 1 }); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('서원 회신은 출고지 후보를 읽어 줄 내용으로 배송 건을 찾고 배송 건마다 한 번 등록한다', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { target_rows?: { line: number; reference: string }[] }) => name === 'admin_origin_tracking_candidates'
      ? { error: null, data: { defaultCarrier: 'epost', truncated: false, shipments: [seowonCandidate()], usedTracking: [] } }
      : { error: null, data: args.target_rows!.map(row => ({ ...row, ok: true, dispatched: true, orderId: seowonOrder, shipmentId: seowonShipment })) });
    const result = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([
      seowonRow('합성 키링_빨강', 2, '6012345678901'), seowonRow('합성 엽서_', 1, 6012345678901), seowonRow('없는 상품', 1, '6012345678999'),
    ]));
    expect(mocks.origins).toHaveBeenCalledWith('seowon_xlsx');
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_origin_tracking_candidates', { target_origin_id: seowonOrigin, target_tracking_numbers: ['6012345678901', '6012345678999'], target_phones: ['01012345678'] });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_import_seowon_tracking_batch', { target_origin_id: seowonOrigin, target_rows: [
      { line: 2, reference: seowonShipment, carrier: 'epost', trackingNumber: '6012345678901' },
    ] });
    expect(result.report?.succeeded).toEqual(['000000A1']);
    expect(result.report?.failed).toEqual([{ line: 4, reference: '전화 끝 5678 · 없는 상품', reason: SEOWON_REPLY_REASONS.notFound }]);
    expect(mocks.enqueue).toHaveBeenCalledWith([{ orderId: seowonOrder, shipmentId: seowonShipment }]);
  });
  it('서원 회신에 남은 배송건번호로 배송 건을 정확히 찾고 결과를 배송건번호로 적는다', async () => {
    const candidate = seowonCandidate({ shipmentNumber: '2026102730000021' });
    mocks.rpc.mockImplementation(async (name: string, args: { target_rows?: { line: number; reference: string }[] }) => name === 'admin_origin_tracking_candidates'
      ? { error: null, data: { defaultCarrier: 'epost', truncated: false, shipments: [candidate, seowonCandidate({ id: '60000000-0000-4000-8000-0000000000b1', shipmentNumber: '2026102730000022' })], usedTracking: [] } }
      : { error: null, data: args.target_rows!.map(row => ({ ...row, ok: true, dispatched: true, orderId: seowonOrder, shipmentId: seowonShipment })) });
    const result = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([
      seowonRow('합성 키링_빨강', 2, '6012345678901', '010-1234-5678', '2026102730000021'), seowonRow('합성 엽서_', 1, '6012345678901', '010-1234-5678', '2026102730000021'),
    ]));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_import_seowon_tracking_batch', { target_origin_id: seowonOrigin, target_rows: [
      { line: 2, reference: seowonShipment, carrier: 'epost', trackingNumber: '6012345678901' },
    ] });
    expect(result.report?.succeeded).toEqual(['2026102730000021']);
  });
  it('routes Seowon through the whole-pack preflight and sends no email when a member is missing',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>name==='admin_origin_tracking_candidates'
      ?{error:null,data:{defaultCarrier:'epost',truncated:false,shipments:[seowonCandidate()],usedTracking:[]}}
      :{error:{message:'shipment_pack_selection_required'},data:null});
    const result=await bulkRegisterAdminOrderTrackingAction({},await seowonForm([seowonRow('합성 키링_빨강',2,'6012345678901'),seowonRow('합성 엽서_',1,'6012345678901')]));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_import_seowon_tracking_batch',{target_origin_id:seowonOrigin,target_rows:[{line:2,reference:seowonShipment,carrier:'epost',trackingNumber:'6012345678901'}]});
    expect(result.errors?.form).toContain('모든 배송 건');expect(result.report).toBeUndefined();expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('queues each original packed shipment from a Seowon result once',async()=>{
    const secondShipment='60000000-0000-4000-8000-0000000000a2',secondOrder='50000000-0000-4000-8000-0000000000a2';
    const members=[{orderId:seowonOrder,shipmentId:seowonShipment},{orderId:secondOrder,shipmentId:secondShipment}];
    mocks.rpc.mockImplementation(async(name:string,args:{target_rows?:{line:number;reference:string}[]})=>name==='admin_origin_tracking_candidates'
      ?{error:null,data:{defaultCarrier:'epost',truncated:false,shipments:[seowonCandidate()],usedTracking:[]}}
      :{error:null,data:args.target_rows!.map(row=>({...row,ok:true,dispatched:true,orderId:seowonOrder,shipmentId:seowonShipment,packedShipments:[...members,...members]}))});
    await bulkRegisterAdminOrderTrackingAction({},await seowonForm([seowonRow('합성 키링_빨강',2,'6012345678901'),seowonRow('합성 엽서_',1,'6012345678901')]));
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(members);
  });
  it('서원 회신을 다시 올리면 이미 같은 송장으로 발송된 배송 건은 그대로 두고 다른 송장은 덮어쓰지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { defaultCarrier: 'epost', truncated: false, usedTracking: [],
      shipments: [seowonCandidate({ status: 'shipping', carrier: 'epost', trackingNumber: '6012345678901' })] } });
    const same = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([seowonRow('합성 키링_빨강', 2, '6012345678901'), seowonRow('합성 엽서_', 1, '6012345678901')]));
    expect(same.message).toContain('새로 등록할 운송장이 없습니다'); expect(same.report?.unchanged).toBe(1);
    const other = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([seowonRow('합성 키링_빨강', 2, '6012345678902')]));
    expect(other.report?.failed).toEqual([{ line: 2, reference: '전화 끝 5678 · 합성 키링_빨강', reason: SEOWON_REPLY_REASONS.alreadyShipped }]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.rpc).not.toHaveBeenCalledWith('admin_import_seowon_tracking_batch', expect.anything());
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('서원 대조 후보가 잘렸으면 아무것도 등록하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { defaultCarrier: 'epost', truncated: true, usedTracking: [], shipments: [seowonCandidate()] } });
    const result = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([seowonRow('합성 키링_빨강', 2, '6012345678901'), seowonRow('합성 엽서_', 1, '6012345678901')]));
    expect(result.errors?.form).toContain('대조할 배송 건이 너무 많아');
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('다른 운영자가 같은 서원 회신을 먼저 등록했으면 그대로 둔 건으로 센다', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { target_rows?: { line: number; reference: string }[] }) => name === 'admin_origin_tracking_candidates'
      ? { error: null, data: { defaultCarrier: 'epost', truncated: false, shipments: [seowonCandidate()], usedTracking: [] } }
      : { error: null, data: args.target_rows!.map(row => ({ ...row, ok: true, dispatched: false, unchanged: true, orderId: seowonOrder, shipmentId: seowonShipment })) });
    const result = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([seowonRow('합성 키링_빨강', 2, '6012345678901'), seowonRow('합성 엽서_', 1, '6012345678901')]));
    expect(result.errors).toBeUndefined(); expect(result.message).toContain('새로 등록할 운송장이 없습니다');
    expect(result.report?.unchanged).toBe(1); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('서원 회신에 송장번호 열이 없으면 파일 단계에서 멈춘다', async () => {
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('송장양식');sheet.addRow([...SEOWON_EXPORT_HEADERS]);sheet.addRow(seowonRow('합성 엽서_',1,'').slice(0,9));
    const data=new FormData();data.set('file',new File([await workbook.xlsx.writeBuffer() as ArrayBuffer],'seowon.xlsx'));
    expect((await bulkRegisterAdminOrderTrackingAction({}, data)).errors?.form).toContain('송장번호 열');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports an indeterminate batch response without claiming any rows succeeded', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [] });
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'));
    expect(result.errors?.form).toContain('등록 결과를 확인하지 못했습니다.');
    expect(result.report).toBeUndefined(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
