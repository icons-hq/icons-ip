import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {shipmentExportRowsCsv} from './shipment-workbook';
import type {ShipmentExportData} from './shipment-dispatch';
import {kstDay} from './kst';
import {warehouseExportTable,writeSeowonSheet} from './warehouse-templates.server';
type Shipments=ShipmentExportData['shipments'];
export interface ShipmentExportFile {bytes:Buffer;mime:string;extension:'xlsx'|'csv'|'zip';name:string}
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileLabel=(value:string)=>value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,40)||'출고지';
/** One warehouse, one file in that warehouse's own template. 서원 파일에는 김포 행이 섞이면 안 된다. */
async function buildOriginExport(shipments:Shipments,format:'xlsx'|'csv',date:string):Promise<ShipmentExportFile>{
 const table=warehouseExportTable(shipments);const first=shipments[0];
 const name=`ICONS-출고지시-${date}-${fileLabel(first.originName)}.${format}`;
 if(format==='csv')return {bytes:Buffer.from(shipmentExportRowsCsv(table.headers,table.rows),'utf8'),mime:'text/csv;charset=utf-8',extension:'csv',name};
 const workbook=new ExcelJS.Workbook();
 if(first.template==='seowon_xlsx')writeSeowonSheet(workbook,table.rows);
 else{
  const sheet=workbook.addWorksheet(`1-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’'));sheet.addRow([...table.headers]);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  sheet.columns=table.widths.map(width=>({width}));
  for(const row of table.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:table.headers.length}};
 }
 return {bytes:Buffer.from(await workbook.xlsx.writeBuffer()),mime:XLSX_MIME,extension:'xlsx',name};
}
/** Several warehouses download together as one ZIP of per-warehouse files, each sendable as-is. */
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv',date=kstDay(new Date())):Promise<ShipmentExportFile>{
 const groups=new Map<string,Shipments>();
 for(const shipment of data.shipments){
  const group=groups.get(shipment.originId);
  groups.set(shipment.originId,[...(group??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 const files:ShipmentExportFile[]=[];
 for(const shipments of groups.values())files.push(await buildOriginExport(shipments,format,date));
 if(files.length===1)return files[0];
 const zip=new JSZip();const names=new Set<string>();
 for(const file of files){
  let name=file.name;for(let copy=2;names.has(name);copy++)name=file.name.replace(/(\.[a-z]+)$/,`-${copy}$1`);
  names.add(name);zip.file(name,file.bytes);
 }
 return {bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),mime:'application/zip',extension:'zip',name:`ICONS-출고지시-${date}-출고지별.zip`};
}
