import 'server-only';
import ExcelJS from 'exceljs';
import {shipmentExportRowsCsv} from './shipment-workbook';
import type {ShipmentExportData} from './shipment-dispatch';
import {warehouseExportTable} from './warehouse-templates.server';
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv'){
 const groups=new Map<string,ShipmentExportData['shipments']>();
 for(const shipment of data.shipments){
  const group=groups.get(shipment.originId);
  groups.set(shipment.originId,[...(group??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 if(format==='csv'){
  if(groups.size!==1)throw new Error('CSV는 출고지를 하나 선택한 뒤 내려받아주세요.');
  const table=warehouseExportTable([...groups.values()][0]);
  return {bytes:Buffer.from(shipmentExportRowsCsv(table.headers,table.rows),'utf8'),mime:'text/csv;charset=utf-8',extension:'csv'};
 }
 const workbook=new ExcelJS.Workbook();let count=0;
 for(const shipments of groups.values()){
  const first=shipments[0];const name=`${++count}-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’');
  const table=warehouseExportTable(shipments);
  const sheet=workbook.addWorksheet(name);sheet.addRow([...table.headers]);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  sheet.columns=table.widths.map(width=>({width}));
  for(const row of table.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:table.headers.length}};
 }
 return {bytes:Buffer.from(await workbook.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
}
