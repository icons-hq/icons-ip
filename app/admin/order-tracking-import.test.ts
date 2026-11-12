const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkRegisterAdminOrderTrackingAction, previewAdminOrderTrackingImportAction } from './order-actions';
import ExcelJS from 'exceljs';
import {encryptAdminWorkbook} from '@/lib/admin/encrypted-workbook.server';
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
/** 내려받은 송장양식(7열+덧붙인 7열) 오른쪽에 송장번호 열을 채운 서원 회신. */
async function seowonForm(rows:(string|number)[][],origin=''){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('송장양식');sheet.addRow([...SEOWON_EXPORT_HEADERS,'송장번호']);
 for(const row of rows)sheet.addRow(row);
 for(let i=0;i<5;i++)workbook.addWorksheet(`Sheet${i+1}`);
 const data=new FormData();data.set('file',new File([await workbook.xlsx.writeBuffer() as ArrayBuffer],'seowon-reply.xlsx'));data.set('originId',origin);return data;
}
const seowonRow=(items:string,quantity:number,tracking:string|number,phone='010-1234-5678',shipmentNumber='')=>[phone,'','04524','서울특별시 중구 세종대로 110 101호','',quantity,items,'합성 수취인','',shipmentNumber,'','','','',tracking];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.origins.mockImplementation(async (template: string) => ({ error: null, data: template === 'wms_csv' ? [{ id: warehouseOrigin, name: '김포' }] : [{ id: seowonOrigin, name: '남양주' }] }));
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() });
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }]);
  mocks.enqueue.mockResolvedValue({ queued: 1 });
  mocks.rpc.mockImplementation(async (_name: string, { target_rows }: { target_rows: { line: number; reference: string }[] }) => ({ error: null,
    data: target_rows.map((row) => ({ ...row, ok: true, dispatched: true, orderId: `00000000-0000-4000-8000-${String(row.line).padStart(12, '0')}`, shipmentId: `10000000-0000-4000-8000-${String(row.line).padStart(12, '0')}` })) }));
});
/* QA 라운드 1 m8: 김포 회신에서 운송장 칸을 비운 주문은 실패가 아니라 건너뛴 줄로 따로 센다. */
async function gimpoReplyForm(rows:[string,string][]){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('김포');sheet.addRow([...GIMPO_EXPORT_HEADERS]);
 for(const [reference,tracking] of rows){const row=Array(21).fill('');row[8]=reference;row[20]=tracking;sheet.addRow(row);}
 const data=new FormData();data.set('file',new File([await workbook.xlsx.writeBuffer() as ArrayBuffer],'gimpo-reply.xlsx'));data.set('originId',warehouseOrigin);return data;
}
describe('김포 회신의 빈 운송장 칸 (QA 라운드 1 m8)', () => {
  it('운송장 칸을 비운 주문은 형식 오류 대신 건너뛴 줄로 알리고 DB에 보내지 않는다',async()=>{
    const shipped='00000000-0000-4000-8000-000000000043';
    const result=await bulkRegisterAdminOrderTrackingAction({},await gimpoReplyForm([[warehouseOrder,''],[shipped,'001234567890']]));
    expect(result.report).toMatchObject({failed:[],skipped:1});expect(result.report?.succeeded).toHaveLength(1);
    expect(result.message).toContain('운송장 칸을 비운 1줄은 아직 출고하지 않은 것으로 보고 건너뛰었습니다.');
    expect(result.message).not.toContain('8~30자리');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_warehouse_tracking_batch',{target_origin_id:warehouseOrigin,target_rows:[{line:3,reference:shipped,trackingNumber:'001234567890'}]});
  });
  it('모든 줄이 비어 있으면 등록하지 않고 건너뛴 줄 수를 알린다',async()=>{
    const result=await bulkRegisterAdminOrderTrackingAction({},await gimpoReplyForm([[warehouseOrder,''],[warehouseOrder,'']]));
    expect(result.errors?.form).toBe('운송장번호를 채운 줄이 없습니다. 운송장 칸을 비운 2줄은 아직 출고하지 않은 것으로 보고 건너뛰었습니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/* QA 라운드 1 m2: 잘못 고른 파일이 바로 등록되지 않도록 읽기만 하는 등록 전 확인을 둔다. */
describe('운송장 회신 등록 전 확인', () => {
  it('양식·등록할 줄·건너뛸 줄·읽기 오류를 돌려주고 DB를 읽지도 바꾸지도 않는다',async()=>{
    const result=await previewAdminOrderTrackingImportAction(await gimpoReplyForm([[warehouseOrder,''],['00000000-0000-4000-8000-000000000043','001234567890'],['00000042','001234567891']]));
    expect(result.preview).toMatchObject({format:'김포 WMS 21열',ready:1,skipped:1,issueCount:1,
      sample:[{line:3,reference:'00000000-0000-4000-8000-000000000043',trackingNumber:'001234567890'}]});
    expect(result.preview?.issues[0]).toMatchObject({line:4});
    const pasted=await previewAdminOrderTrackingImportAction(form('00000001,hanjin,12345678'));
    expect(pasted.preview).toMatchObject({format:'배송건번호 · 택배사코드 · 운송장번호',ready:1,skipped:0,issueCount:0});
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('비어 있는 입력과 출고 권한이 없는 계정은 확인하지 않는다',async()=>{
    expect(await previewAdminOrderTrackingImportAction(form(''))).toEqual({error:'등록할 운송장을 붙여넣거나 파일을 선택해주세요.'});
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') });
    expect(await previewAdminOrderTrackingImportAction(form('00000001,hanjin,12345678'))).toEqual({error:'관리자 권한이 필요합니다.'});
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect((await previewAdminOrderTrackingImportAction(form('00000001,hanjin,12345678'))).preview?.ready).toBe(1);
  });
});

describe('bulk tracking action', () => {
  it('물류출고관리는 운송장 회신을 등록하고, 출고 권한이 없는 매니저는 RPC 전에 막는다 (1014-084)',async()=>{
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect((await bulkRegisterAdminOrderTrackingAction({},form('00000001,hanjin,12345678'))).report?.succeeded).toEqual(['00000001']);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_shipment_tracking_batch',expect.anything());
    mocks.rpc.mockClear();
    for(const role of ['deputy','influencer','agency'] as const){
      mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: role }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture(role) });
      expect((await bulkRegisterAdminOrderTrackingAction({},form('00000001,hanjin,12345678'))).errors?.form).toBe('관리자 권한이 필요합니다.');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
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
    const book=new ExcelJS.Workbook();book.addWorksheet('발주(주문)확인 발송관리').addRows([
      ['상품주문번호','택배사','운송장번호'],[firstItem,'한진택배','001234567890'],[secondItem,'한진택배','001234567890'],
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
  describe('ICONS 표준 양식 CSV 회신', () => {
    const item='2026102120000001',second='2026102120000002';
    const csvForm=(text:string|Uint8Array,name='출고지시.csv')=>{const data=new FormData();data.set('file',new File([text as BlobPart],name));return data;};
    const header='상품주문번호,배송메시지,택배사,운송장번호';
    beforeEach(()=>mocks.rpc.mockResolvedValue({error:null,data:[{line:2,reference:item,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:true,duplicate:false}]}));
    it('12자리 운송장번호를 채운 CSV를 품목 RPC로 보낸다',async()=>{
      const result=await bulkRegisterAdminOrderTrackingAction({},csvForm(`\uFEFF${header}\r\n"${item}","문 앞, 부탁합니다","한진택배","123456789012"\r\n`));
      expect(mocks.rpc).toHaveBeenCalledWith('admin_import_item_tracking_batch',{target_rows:[{line:2,reference:item,carrier:'hanjin',trackingNumber:'123456789012'}]});
      expect(result.errors).toBeUndefined();expect(result.report?.succeeded).toEqual([item]);
    });
    it('엑셀이 저장한 CP949 CSV의 머리글도 읽는다',async()=>{
      const bytes=Uint8Array.from(Buffer.from('bbf3c7b0c1d6b9aeb9f8c8a32cc5c3b9e8bbe72cbfeebcdbc0e5b9f8c8a30d0a','hex'));
      const line=Buffer.from(`${item},hanjin,123456789012\r\n`);
      await bulkRegisterAdminOrderTrackingAction({},csvForm(new Uint8Array([...bytes,...line])));
      expect(mocks.rpc).toHaveBeenCalledWith('admin_import_item_tracking_batch',{target_rows:[{line:2,reference:item,carrier:'hanjin',trackingNumber:'123456789012'}]});
    });
    it('붙여넣은 표준 양식 표도 같은 규칙으로 읽는다',async()=>{
      await bulkRegisterAdminOrderTrackingAction({},form(`상품주문번호\t택배사\t운송장번호\n${item}\t한진택배\t123456789012`));
      expect(mocks.rpc).toHaveBeenCalledWith('admin_import_item_tracking_batch',{target_rows:[{line:2,reference:item,carrier:'hanjin',trackingNumber:'123456789012'}]});
    });
    it('안전 검사에 걸린 줄은 등록하지 않고 사유를 남긴다',async()=>{
      const result=await bulkRegisterAdminOrderTrackingAction({},csvForm(`${header}\r\n${item},,한진택배,=1+1\r\n${second},,한진택배,\r\n`));
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(result.report?.failed.map(row=>[row.line,row.reason])).toEqual([[2,'수식은 사용할 수 없습니다.']]);
      // 운송장 칸만 비운 줄은 실패가 아니라 건너뛴 줄이다(QA 라운드 1b, 김포 회신과 같은 기준).
      expect(result.report?.skipped).toBe(1);
    });
    it('운송장 칸만 비운 줄은 DB에 빈 값으로 보내 배송 건 가드를 받되 그 줄의 거절은 실패로 세지 않는다',async()=>{
      mocks.rpc.mockResolvedValue({error:null,data:[
        {line:2,reference:item,ok:true,dispatched:true,shipmentId:'s1',orderId:'o1'},
        {line:3,reference:second,ok:false,error:'invalid_tracking_number'},
      ]});
      const result=await bulkRegisterAdminOrderTrackingAction({},csvForm(`${header}\r\n${item},,한진택배,123456789012\r\n${second},,한진택배,\r\n`));
      expect(mocks.rpc).toHaveBeenCalledWith('admin_import_item_tracking_batch',{target_rows:[
        {line:2,reference:item,carrier:'hanjin',trackingNumber:'123456789012'},
        {line:3,reference:second,carrier:'',trackingNumber:''},
      ]});
      expect(result.report?.failed).toEqual([]);
      expect(result.report?.skipped).toBe(1);
    });
    it('표준 양식 CSV는 256KB를 넘어도 받고, 일반 세 칸 CSV는 종전 한도를 유지하며 그대로 처리한다',async()=>{
      const padding='합성 메시지 '.repeat(50);
      const rows=Array.from({length:300},(_,index)=>`${String(2026102120000000+index+1)},"${padding}",한진택배,123456789012`).join('\r\n');
      mocks.rpc.mockResolvedValue({error:null,data:[]});
      const big=csvForm(`${header}\r\n${rows}`);
      expect((big.get('file') as File).size).toBeGreaterThan(256*1024);
      await bulkRegisterAdminOrderTrackingAction({},big);
      expect(mocks.rpc.mock.calls[0][0]).toBe('admin_import_item_tracking_batch');
      mocks.rpc.mockClear();
      const plain=await bulkRegisterAdminOrderTrackingAction({},csvForm(`배송건번호,택배사코드,운송장번호\r\n${'0'.repeat(8)},hanjin,12345678\r\n#${'x'.repeat(256*1024)}`));
      expect(plain.errors?.form).toContain('256KB');expect(mocks.rpc).not.toHaveBeenCalled();
      mocks.rpc.mockResolvedValue({error:null,data:[{line:2,reference:'00000000',ok:true,shipmentId:'s',orderId:'o',dispatched:true}]});
      await bulkRegisterAdminOrderTrackingAction({},csvForm(`배송건번호,택배사코드,운송장번호\r\n${'0'.repeat(8)},hanjin,12345678\r\n`));
      expect(mocks.rpc.mock.calls[0][0]).toBe('admin_import_shipment_tracking_batch');
    });
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
  it('서원 회신의 같은 배송 건 다른 송장번호는 거절하지 않고 대표 + 추가 운송장으로 보낸다(QNA-019)', async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { target_rows?: { line: number; reference: string; extraTrackingNumbers?: string[] }[] }) => name === 'admin_origin_tracking_candidates'
      ? { error: null, data: { defaultCarrier: 'epost', truncated: false, shipments: [seowonCandidate()], usedTracking: [] } }
      : { error: null, data: args.target_rows!.map(row => ({ ...row, ok: true, dispatched: true, orderId: seowonOrder, shipmentId: seowonShipment, extraTrackingsAdded: row.extraTrackingNumbers?.length ?? 0 })) });
    const result = await bulkRegisterAdminOrderTrackingAction({}, await seowonForm([
      seowonRow('합성 키링_빨강', 2, '6012345678901'), seowonRow('합성 엽서_', 1, '6012345678902'),
    ]));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_import_seowon_tracking_batch', { target_origin_id: seowonOrigin, target_rows: [
      { line: 2, reference: seowonShipment, carrier: 'epost', trackingNumber: '6012345678901', extraTrackingNumbers: ['6012345678902'] },
    ] });
    expect(result.report).toEqual({ succeeded: ['000000A1'], failed: [], extraTrackings: 1 });
    expect(result.message).toBe('1건의 운송장을 등록했습니다. 분리배송 추가 운송장 1개를 함께 저장했습니다.');
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

// 실제 Agile 암호화·복호화는 키마다 SHA-512를 100,000번 돌려 CI 러너에서 테스트 하나가 2~5초 걸린다.
describe('비밀번호를 건 회신 파일 등록',{timeout:20_000},()=>{
 const password='Sample-1234';
 const item='60000000-0000-4000-8000-000000000001';
 async function smartStoreReply(carrier='한진택배'){
  const book=new ExcelJS.Workbook();book.addWorksheet('발송처리').addRows([['상품주문번호','배송방법','택배사','송장번호'],[item,'택배,등기,소포',carrier,'001234567890']]);
  return Buffer.from(await book.xlsx.writeBuffer());
 }
 function upload(plain:Buffer,filePassword?:string|File){
  const data=new FormData();data.set('file',new File([new Uint8Array(encryptAdminWorkbook(plain,password).bytes)],'reply.xlsx'));
  if(filePassword!==undefined)data.set('filePassword',filePassword);
  return data;
 }
 async function sealedForm(source:FormData){
  const plain=Buffer.from(await (source.get('file') as File).arrayBuffer());const data=upload(plain,password);
  data.set('originId',String(source.get('originId')??''));return data;
 }
 const logged=vi.fn();
 const consoleMethods=['log','info','warn','error','debug'] as const;
 beforeEach(()=>{logged.mockClear();for(const method of consoleMethods)vi.spyOn(console,method).mockImplementation(logged);});
 afterEach(()=>{vi.restoreAllMocks();});
 const expectNoSecret=(result:unknown)=>{
  for(const seen of [result,mocks.rpc.mock.calls,mocks.enqueue.mock.calls,logged.mock.calls])expect(JSON.stringify(seen)??'').not.toContain(password);
 };
 it('내려받은 비밀번호 파일을 해제 없이 올리면 배송 건을 등록하고 비밀번호는 어디에도 남기지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({error:null,data:[{line:2,reference:item,ok:true,shipmentId:'shipment-one',orderId:warehouseOrder,dispatched:true,duplicate:false}]});
  const result=await bulkRegisterAdminOrderTrackingAction({},upload(await smartStoreReply(),password));
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_import_item_tracking_batch',{target_rows:[{line:2,reference:item,carrier:'hanjin',trackingNumber:'001234567890'}]});
  expect(result.report?.succeeded).toEqual([item]);expect(result.errors).toBeUndefined();
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith([{orderId:warehouseOrder,shipmentId:'shipment-one'}]);
  expectNoSecret(result);
 });
 it('비밀번호가 없으면 물어보고 등록하지 않는다',async()=>{
  const result=await bulkRegisterAdminOrderTrackingAction({},upload(await smartStoreReply()));
  expect(result.errors?.form).toContain('파일 비밀번호를 입력');expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();
 });
 it('문자열이 아닌 비밀번호 값은 비밀번호 없음으로 처리한다',async()=>{
  const result=await bulkRegisterAdminOrderTrackingAction({},upload(await smartStoreReply(),new File([password],'password.txt')));
  expect(result.errors?.form).toContain('파일 비밀번호를 입력');expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('틀린 비밀번호는 분명한 문구로 거절하고 입력값을 응답·로그·DB 호출에 남기지 않는다',async()=>{
  const wrong='Wrong-Secret-9';
  const result=await bulkRegisterAdminOrderTrackingAction({},upload(await smartStoreReply(),wrong));
  expect(result.errors?.form).toContain('파일 비밀번호가 맞지 않습니다');expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();
  for(const seen of [result,logged.mock.calls])expect(JSON.stringify(seen)).not.toContain(wrong);
 });
 it('비활성 택배사 행은 복호화한 내용에서도 등록하지 않고 줄 오류로 알린다',async()=>{
  mocks.carriers.mockResolvedValue([{code:'hanjin',label:'한진택배',active:false,trackingUrlTemplate:'https://example.test/{trackingNumber}'}]);
  const result=await bulkRegisterAdminOrderTrackingAction({},upload(await smartStoreReply(),password));
  expect(result.report?.failed[0]).toMatchObject({line:2,reference:item});expect(result.report?.failed[0].reason).toContain('사용하지 않는 택배사');
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();
 });
 it('김포 회신을 비밀번호 파일로 올려도 같은 출고지 문맥으로 등록한다',async()=>{
  await bulkRegisterAdminOrderTrackingAction({},await sealedForm(await warehouseForm('')));
  expect(mocks.origins).toHaveBeenCalledWith('wms_csv');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_import_warehouse_tracking_batch',expect.objectContaining({target_origin_id:warehouseOrigin}));
 });
 it('서원 회신을 비밀번호 파일로 올려도 같은 대조 경로로 등록한다',async()=>{
  mocks.rpc.mockImplementation(async(name:string,args:{target_rows?:{line:number;reference:string}[]})=>name==='admin_origin_tracking_candidates'
   ?{error:null,data:{defaultCarrier:'epost',truncated:false,shipments:[seowonCandidate()],usedTracking:[]}}
   :{error:null,data:args.target_rows!.map(row=>({...row,ok:true,dispatched:true,orderId:seowonOrder,shipmentId:seowonShipment}))});
  const result=await bulkRegisterAdminOrderTrackingAction({},await sealedForm(await seowonForm([seowonRow('합성 키링_빨강',2,'6012345678901'),seowonRow('합성 엽서_',1,'6012345678901')])));
  expect(mocks.rpc).toHaveBeenNthCalledWith(2,'admin_import_seowon_tracking_batch',{target_origin_id:seowonOrigin,target_rows:[{line:2,reference:seowonShipment,carrier:'epost',trackingNumber:'6012345678901'}]});
  expect(result.report?.succeeded).toEqual(['000000A1']);
 });
 it('암호 없는 XLSX는 비밀번호 칸이 있어도 지금처럼 등록한다',async()=>{
  const form=await warehouseForm();form.set('filePassword','');
  await bulkRegisterAdminOrderTrackingAction({},form);
  expect(mocks.rpc).toHaveBeenCalledWith('admin_import_warehouse_tracking_batch',expect.objectContaining({target_origin_id:warehouseOrigin}));
 });
});
