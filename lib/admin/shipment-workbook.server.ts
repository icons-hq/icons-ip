import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {shipmentExportRowsCsv,type ShipmentExportLayout} from './shipment-workbook';
import {buildSmartStoreShipmentExport} from './smartstore-shipment-workbook.server';
import type {ShipmentExportData} from './shipment-dispatch';
import {kstDay} from './kst';
import {TRACKING_IMPORT_ROW_LIMIT} from './tracking-import';
import {warehouseExportTable,warehouseOperationalTable,writeSeowonSheet} from './warehouse-templates.server';
type Shipments=ShipmentExportData['shipments'];
export interface ShipmentExportFile {bytes:Buffer;mime:string;extension:'xlsx'|'csv'|'zip';name:string}
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileLabel=(value:string)=>value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,40)||'출고지';
/** Leave room for a warehouse to add tracking numbers within the 1 MiB XLSX reply limit. */
export const NATIVE_EXPORT_FILE_LIMIT_BYTES=512*1024;
function writeSupplement(workbook:ExcelJS.Workbook,supplement:NonNullable<ReturnType<typeof warehouseOperationalTable>>){
 const sheet=workbook.addWorksheet('배송 운영 안내');sheet.addRow(supplement.headers);sheet.getRow(1).font={bold:true};
 sheet.columns=supplement.widths.map(width=>({width}));sheet.views=[{state:'frozen',ySplit:1}];
 for(const row of supplement.rows)sheet.addRow(row);
 sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:supplement.headers.length}};
}
/** One warehouse, one sendable file. Seowon's original sheet is always XLSX. */
async function buildOriginExport(shipments:Shipments,requested:'xlsx'|'csv',date:string):Promise<ShipmentExportFile>{
 const table=warehouseExportTable(shipments),first=shipments[0];
 const format=first.template==='seowon_xlsx'?'xlsx':requested;
 const stem=`ICONS-출고지시-${date}-${fileLabel(first.originName)}`;
 const supplement=warehouseOperationalTable(shipments);
 if(format==='csv'){
  const csv=shipmentExportRowsCsv(table.headers,table.rows);
  if(supplement){
   const zip=new JSZip();
   zip.file('ICONS-출고지시.csv',csv);
   zip.file('ICONS-배송운영안내.csv',shipmentExportRowsCsv(supplement.headers,supplement.rows));
   return {bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),mime:'application/zip',extension:'zip',name:`${stem}.zip`};
  }
  return {bytes:Buffer.from(csv,'utf8'),mime:'text/csv;charset=utf-8',extension:'csv',name:`${stem}.csv`};
 }
 const workbook=new ExcelJS.Workbook();
 if(first.template==='seowon_xlsx')writeSeowonSheet(workbook,table.rows);
 else{
  const sheet=workbook.addWorksheet(`1-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’'));
  sheet.addRow([...table.headers]);sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  // Empty reply cells need text formatting before an operator enters a leading-zero waybill.
  sheet.columns=table.widths.map((width,index)=>({width,...(table.textColumns[index]?{style:{numFmt:'@'}}:{})}));
  for(const row of table.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:table.headers.length}};
 }
 if(supplement)writeSupplement(workbook,supplement);
 const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
 if(first.template!=='standard'&&bytes.length>NATIVE_EXPORT_FILE_LIMIT_BYTES)throw new Error(`${first.originName} 출고지시 파일이 회신 업로드 한도를 넘습니다. 배송 건을 나눠서 내보내주세요.`);
 return {bytes,mime:XLSX_MIME,extension:'xlsx',name:`${stem}.xlsx`};
}
/** The layout and date have distinct arguments; an ISO date cannot select a layout. */
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv',layout:ShipmentExportLayout='warehouse',date=kstDay(new Date())):Promise<ShipmentExportFile>{
 if(layout==='smartstore'){
  if(data.shipments.reduce((count,shipment)=>count+shipment.lines.length,0)>TRACKING_IMPORT_ROW_LIMIT)throw new Error('스마트스토어 양식은 품목 1,000줄까지 만들 수 있습니다. 배송 건을 나눠서 내보내주세요.');
  const file=await buildSmartStoreShipmentExport(data,format);
  return {...file,extension:file.extension as ShipmentExportFile['extension'],name:`ICONS-발주발송관리-${date}.${file.extension}`};
 }
 const groups=new Map<string,Shipments>();
 for(const shipment of data.shipments){
  const group=groups.get(shipment.originId);
  groups.set(shipment.originId,[...(group??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 const files:ShipmentExportFile[]=[];
 for(const shipments of groups.values())files.push(await buildOriginExport(shipments,format,date));
 if(files.length===1)return files[0];
 const zip=new JSZip(),names=new Set<string>();
 for(const file of files){
  let name=file.name;for(let copy=2;names.has(name);copy++)name=file.name.replace(/(\.[a-z]+)$/,`-${copy}$1`);
  names.add(name);zip.file(name,file.bytes);
 }
 return {bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),mime:'application/zip',extension:'zip',name:`ICONS-출고지시-${date}-출고지별.zip`};
}
