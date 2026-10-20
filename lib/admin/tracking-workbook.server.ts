import 'server-only';
import { WAREHOUSE_OPERATION_HEADERS } from './warehouse-templates';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import {loadSafeWorkbook,readSafeWorkbookCell} from './workbook-safety';
import {parseTrackingImport,TRACKING_IMPORT_ROW_LIMIT,type TrackingImportParseResult} from './tracking-import';
import {parseWarehouseReply,type TrackingWorkbookParseResult} from './warehouse-templates.server';
import {parseSmartStoreReply} from './smartstore-tracking-workbook.server';
export type {TrackingWorkbookParseResult} from './warehouse-templates.server';
// A 74-column, 1,000-item reply with distinct UUIDs exceeds the legacy 256 KiB cap.
export const TRACKING_IMPORT_FILE_LIMIT_BYTES=1024*1024;
export const TRACKING_IMPORT_TEXT_LIMIT_BYTES=256*1024;
export async function parseTrackingWorkbook(bytes:Buffer,carriers:ShippingCarrierRegistry):Promise<TrackingWorkbookParseResult>{
 if(bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new Error('암호화된 파일 또는 구형 Excel 형식입니다. Excel에서 암호를 해제하고 XLSX로 저장해주세요.');
 const workbook=await loadSafeWorkbook(bytes,{fileBytes:TRACKING_IMPORT_FILE_LIMIT_BYTES,totalBytes:8*1024*1024,entryBytes:4*1024*1024});
 const sheets=workbook.worksheets.filter(sheet=>sheet.name!=='배송 운영 안내');
 const supplement=workbook.getWorksheet('배송 운영 안내');
 if(sheets.length!==1||workbook.worksheets.length>2)throw new Error('운송장 양식은 시트 하나로 올려주세요.');
 if(supplement){
  if(supplement.columnCount!==WAREHOUSE_OPERATION_HEADERS.length||supplement.rowCount>TRACKING_IMPORT_ROW_LIMIT+1
   ||!WAREHOUSE_OPERATION_HEADERS.every((header,index)=>{const cell=readSafeWorkbookCell(supplement.getCell(1,index+1));return !cell.error&&cell.value===header;}))
   throw new Error('배송 운영 안내 시트의 형식을 확인해주세요.');
  supplement.eachRow(row=>row.eachCell(cell=>{if(readSafeWorkbookCell(cell).error)throw new Error('배송 운영 안내 시트에 허용되지 않는 셀이 있습니다.');}));
 }
 const sheet=sheets[0];
 if(sheet.rowCount>TRACKING_IMPORT_ROW_LIMIT+1)throw new Error('운송장은 한 번에 1,000줄까지 등록할 수 있습니다.');
 const smartStoreReply=parseSmartStoreReply(sheet,carriers);
 if(smartStoreReply)return smartStoreReply;
 const nativeReply=parseWarehouseReply(sheet);
 if(nativeReply)return nativeReply;
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
