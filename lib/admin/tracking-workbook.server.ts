import 'server-only';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import {loadSafeWorkbook,readSafeWorkbookCell} from './workbook-safety';
import {parseTrackingImport,TRACKING_IMPORT_ROW_LIMIT,type TrackingImportParseResult} from './tracking-import';
export const TRACKING_IMPORT_FILE_LIMIT_BYTES=256*1024;
export async function parseTrackingWorkbook(bytes:Buffer,carriers:ShippingCarrierRegistry):Promise<TrackingImportParseResult>{
 const workbook=await loadSafeWorkbook(bytes,{fileBytes:TRACKING_IMPORT_FILE_LIMIT_BYTES,totalBytes:8*1024*1024,entryBytes:4*1024*1024});
 if(workbook.worksheets.length!==1)throw new Error('운송장 양식은 시트 하나로 올려주세요.');
 const sheet=workbook.worksheets[0];
 if(sheet.rowCount>TRACKING_IMPORT_ROW_LIMIT+1)throw new Error('운송장은 한 번에 1,000줄까지 등록할 수 있습니다.');
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
