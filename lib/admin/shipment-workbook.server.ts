import 'server-only';
import ExcelJS from 'exceljs';
import {parseShipmentExportColumns,shipmentExportCells,shipmentExportCsv} from './shipment-workbook';
import type {ShipmentExportData} from './shipment-dispatch';
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv'){
 const groups=new Map<string,ShipmentExportData['shipments']>();
 for(const shipment of data.shipments){
  if(!parseShipmentExportColumns(shipment.columns)||!shipment.lines.length)throw new Error('출고지시 양식 또는 상품 정보를 확인해주세요.');
  groups.set(shipment.originId,[...(groups.get(shipment.originId)??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 if(format==='csv'){
  if(groups.size!==1)throw new Error('CSV는 출고지를 하나 선택한 뒤 내려받아주세요.');
  const shipments=[...groups.values()][0];return {bytes:Buffer.from(shipmentExportCsv(shipments.flatMap(shipment=>shipment.lines),shipments[0].columns),'utf8'),mime:'text/csv;charset=utf-8',extension:'csv'};
 }
 const workbook=new ExcelJS.Workbook();let count=0;
 for(const shipments of groups.values()){
  const first=shipments[0];const name=`${++count}-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’');
  const sheet=workbook.addWorksheet(name);sheet.addRow(first.columns.map(column=>column.header));
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  sheet.columns=first.columns.map(column=>({width:column.key==='address'?48:column.key.endsWith('Id')?40:22}));
  for(const shipment of shipments)for(const line of shipment.lines)sheet.addRow(shipmentExportCells(line,first.columns));
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:first.columns.length}};
 }
 return {bytes:Buffer.from(await workbook.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
}
