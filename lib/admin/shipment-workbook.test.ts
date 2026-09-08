import { describe,expect,it } from 'vitest';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS,parseShipmentExportColumns,shipmentExportCells,shipmentExportCsv,type ShipmentExportLine } from './shipment-workbook';
const line:ShipmentExportLine={shipmentId:'00000000-0000-4000-8000-000000000001',orderId:'00000000-0000-4000-8000-000000000002',recipient:'=HYPERLINK("https://example.test")',phone:'01012345678',postalCode:'00123',address:'주소, 상세',goodCode:'ITEM-1',variantCode:'000123-RED',goodName:'상품',optionName:'파랑',qty:2,unitPrice:12500,deliveryNote:'문 앞\n부탁합니다',carrier:'한진택배'};
describe('출고지시 양식',()=>{
 it('기본 12열을 유지하고 옵션 물류 품번을 선택 컬럼으로 매핑한다',()=>{
  expect(DEFAULT_SHIPMENT_EXPORT_COLUMNS).toHaveLength(12);
  const columns=[...DEFAULT_SHIPMENT_EXPORT_COLUMNS,{key:'variantCode',header:'창고 SKU'}];
  expect(parseShipmentExportColumns(columns)).toEqual(columns);
  const parsed=parseShipmentExportColumns(columns)!;
  expect(shipmentExportCells({...line,variantCode:'000123-RED'},parsed).at(-1)).toBe('000123-RED');
  expect(parseShipmentExportColumns([...columns,{key:'variantCode',header:'중복 SKU'}])).toBeNull();
  expect(parseShipmentExportColumns(columns.slice(1))).toBeNull();
 });
 it('모든 표준 컬럼의 헤더와 순서를 바꿀 수 있다',()=>{
  const columns=[...DEFAULT_SHIPMENT_EXPORT_COLUMNS].reverse().map(c=>({...c,header:'창고 '+c.header}));
  expect(parseShipmentExportColumns(columns)).toEqual(columns);
  expect(shipmentExportCells(line,columns)).toEqual(['한진택배','문 앞\n부탁합니다',2,'파랑','상품','ITEM-1','주소, 상세','00123','01012345678',line.recipient,line.orderId,line.shipmentId]);
 });
 it('누락·중복·알 수 없는 컬럼과 빈 헤더를 거절한다',()=>{
  expect(parseShipmentExportColumns(DEFAULT_SHIPMENT_EXPORT_COLUMNS.slice(1))).toBeNull();
  expect(parseShipmentExportColumns(DEFAULT_SHIPMENT_EXPORT_COLUMNS.map(()=>DEFAULT_SHIPMENT_EXPORT_COLUMNS[0]))).toBeNull();
  expect(parseShipmentExportColumns(DEFAULT_SHIPMENT_EXPORT_COLUMNS.map((c,i)=>i?c:{...c,key:'rawPayment'}))).toBeNull();
  expect(parseShipmentExportColumns(DEFAULT_SHIPMENT_EXPORT_COLUMNS.map((c,i)=>i?c:{...c,header:' '}))).toBeNull();
 });
 it('CSV는 한글·선행 0을 보존하고 수식과 구분자를 안전하게 내보낸다',()=>{
  const csv=shipmentExportCsv([line],DEFAULT_SHIPMENT_EXPORT_COLUMNS);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"01012345678"');expect(csv).toContain('"00123"');
  expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  expect(csv).toContain('"주소, 상세"');expect(csv).toContain('"문 앞\n부탁합니다"');
 });
});
