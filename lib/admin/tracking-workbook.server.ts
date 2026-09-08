import 'server-only';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import {loadSafeWorkbook,readSafeWorkbookCell} from './workbook-safety';
import {parseTrackingImport,TRACKING_IMPORT_ROW_LIMIT,type TrackingImportParseResult} from './tracking-import';
import {GIMPO_EXPORT_HEADERS} from './warehouse-templates';
import {isTrackingNumber,normalizeTrackingNumber} from '@/lib/orders/shipment';
import type ExcelJS from 'exceljs';
export const TRACKING_IMPORT_FILE_LIMIT_BYTES=256*1024;
export interface WarehouseTrackingParseResult {
 kind:'gimpo';rows:{line:number;reference:string;trackingNumber:string}[];issues:TrackingImportParseResult['issues'];
}
export type TrackingWorkbookParseResult=TrackingImportParseResult|WarehouseTrackingParseResult;
const ORDER_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseWarehouseReply(sheet:ExcelJS.Worksheet):WarehouseTrackingParseResult{
 const rows:WarehouseTrackingParseResult['rows']=[],issues:WarehouseTrackingParseResult['issues']=[];
 const blocked=new Set<string>();
 for(let line=2;line<=sheet.rowCount;line++){
  const source=sheet.getRow(line);
  const cells=GIMPO_EXPORT_HEADERS.map((_,index)=>readSafeWorkbookCell(source.getCell(index+1),index===8||index===20));
  if(cells.every(cell=>!cell.value&&!cell.error))continue;
  const reference=cells[8].value.trim().toLowerCase(),trackingNumber=normalizeTrackingNumber(cells[20].value.trim());
  const reason=cells.find(cell=>cell.error)?.error
   ??(!ORDER_UUID.test(reference)?'주문번호(쇼핑몰)에 ICONS 출고 파일의 전체 주문번호를 그대로 유지해주세요.':undefined)
   ??(!isTrackingNumber(trackingNumber)||/[\r\n\t]/.test(cells[20].value)?'운송장번호는 텍스트 형식의 8~30자리 영숫자여야 합니다.':undefined);
  if(reason){issues.push({line,reference,reason});if(ORDER_UUID.test(reference))blocked.add(reference);}
  else rows.push({line,reference,trackingNumber});
 }
 // A malformed line must not permit another line of the same shipment to be dispatched.
 const valid=rows.filter(row=>{
  if(!blocked.has(row.reference))return true;
  issues.push({line:row.line,reference:row.reference,reason:'같은 주문의 다른 행에 오류가 있습니다. 해당 주문의 모든 행을 함께 고쳐주세요.'});return false;
 });
 return {kind:'gimpo',rows:valid,issues:issues.sort((a,b)=>a.line-b.line)};
}
export async function parseTrackingWorkbook(bytes:Buffer,carriers:ShippingCarrierRegistry):Promise<TrackingWorkbookParseResult>{
 const workbook=await loadSafeWorkbook(bytes,{fileBytes:TRACKING_IMPORT_FILE_LIMIT_BYTES,totalBytes:8*1024*1024,entryBytes:4*1024*1024});
 if(workbook.worksheets.length!==1)throw new Error('운송장 양식은 시트 하나로 올려주세요.');
 const sheet=workbook.worksheets[0];
 if(sheet.rowCount>TRACKING_IMPORT_ROW_LIMIT+1)throw new Error('운송장은 한 번에 1,000줄까지 등록할 수 있습니다.');
 if(sheet.columnCount===GIMPO_EXPORT_HEADERS.length&&GIMPO_EXPORT_HEADERS.every((header,index)=>{
  const cell=readSafeWorkbookCell(sheet.getRow(1).getCell(index+1));return !cell.error&&cell.value===header;
 }))return parseWarehouseReply(sheet);
 if(sheet.columnCount>3)throw new Error('배송건번호·택배사·운송장번호 세 컬럼만 올려주세요.');
 const issues:TrackingImportParseResult['issues']=[];const lines:string[]=[];
 for(let index=1;index<=sheet.rowCount;index++){
  const row=sheet.getRow(index);const cells=[1,2,3].map(column=>readSafeWorkbookCell(row.getCell(column),column!==2));
  const error=cells.find(cell=>cell.error)?.error;
  if(error){issues.push({line:index,reference:cells[0].value,reason:error});lines.push('');continue;}
  if(cells.some(cell=>/[\r\n\t]/.test(cell.value))){issues.push({line:index,reference:cells[0].value,reason:'운송장 셀에 줄바꿈·탭을 넣을 수 없습니다.'});lines.push('');continue;}
  lines.push(cells.map(cell=>cell.value).join('\t'));
 }
 const parsed=parseTrackingImport(lines.join('\n'),carriers);
 return {rows:parsed.rows,issues:[...issues,...parsed.issues].sort((a,b)=>a.line-b.line)};
}
