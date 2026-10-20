import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {shipmentExportRowsCsv,type ShipmentExportLayout} from './shipment-workbook';
import {buildSmartStoreShipmentExport} from './smartstore-shipment-workbook.server';
import type {ShipmentExportData} from './shipment-dispatch';
import {warehouseExportTable,warehouseOperationalTable} from './warehouse-templates.server';
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv',layout:ShipmentExportLayout='warehouse'){
 if(layout==='smartstore')return buildSmartStoreShipmentExport(data,format);
 const groups=new Map<string,ShipmentExportData['shipments']>();
 for(const shipment of data.shipments){
  const group=groups.get(shipment.originId);
  groups.set(shipment.originId,[...(group??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 if(format==='csv'){
  if(groups.size!==1)throw new Error('CSV는 출고지를 하나 선택한 뒤 내려받아주세요.');
  const table=warehouseExportTable([...groups.values()][0]);
  const supplement=warehouseOperationalTable(data.shipments);
  if(supplement){
   const zip=new JSZip();
   zip.file('ICONS-출고지시.csv',shipmentExportRowsCsv(table.headers,table.rows));
   zip.file('ICONS-배송운영안내.csv',shipmentExportRowsCsv(supplement.headers,supplement.rows));
   return {bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),mime:'application/zip',extension:'zip'};
  }
  return {bytes:Buffer.from(shipmentExportRowsCsv(table.headers,table.rows),'utf8'),mime:'text/csv;charset=utf-8',extension:'csv'};
 }
 const workbook=new ExcelJS.Workbook();let count=0;
 for(const shipments of groups.values()){
  const first=shipments[0];const name=`${++count}-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’');
  const table=warehouseExportTable(shipments);
  const sheet=workbook.addWorksheet(name);sheet.addRow([...table.headers]);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  // Empty reply cells also need text formatting before Excel users enter a tracking number.
  sheet.columns=table.widths.map((width,index)=>({width,...(table.textColumns[index]?{style:{numFmt:'@'}}:{})}));
  for(const row of table.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:table.headers.length}};
 }
 const supplement=warehouseOperationalTable(data.shipments);
 if(supplement){
  const sheet=workbook.addWorksheet('배송 운영 안내');sheet.addRow(supplement.headers);sheet.getRow(1).font={bold:true};
  sheet.columns=supplement.widths.map(width=>({width}));sheet.views=[{state:'frozen',ySplit:1}];
  for(const row of supplement.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:supplement.headers.length}};
 }
 return {bytes:Buffer.from(await workbook.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
}
