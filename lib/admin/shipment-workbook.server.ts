import 'server-only';
import ExcelJS from 'exceljs';
import {parseShipmentExportColumns,shipmentExportCells,shipmentExportRowsCsv} from './shipment-workbook';
import type {ShipmentExportData} from './shipment-dispatch';
import {GIMPO_EXPORT_HEADERS,SEOWON_EXPORT_HEADERS} from './warehouse-templates';
type ExportShipments=ShipmentExportData['shipments'];
function exportTable(shipments:ExportShipments){
 const first=shipments[0];
 if(first.template==='seowon_xlsx')return {
  headers:SEOWON_EXPORT_HEADERS,
  widths:[19,21,19,60,12,8,60],
  rows:shipments.map(shipment=>{
   const line=shipment.lines[0];
   return [line.phone,'',/^\d{5}$/.test(line.postalCode)?line.postalCode:'',line.address,'','',
    shipment.lines.map(item=>`${item.goodName}/${item.optionName}(${item.qty})`).join(', ')];
  }),
 };
 if(first.template==='wms_csv')return {
  headers:GIMPO_EXPORT_HEADERS,
  widths:[48,48,60,28,19,19,35,25,40,22,35,22,22,14,18,8,12,19,22,14,25],
  rows:shipments.flatMap(shipment=>shipment.lines.map((line,index)=>{
   const item=`${line.goodName}/${line.optionName}(${line.qty})`;
   return [item,` ${item}`,line.address,`${line.recipient}/ICONS/`,line.phone,'',line.deliveryNote,'',line.orderId,'',
    line.goodName,line.optionName,line.optionName,'',line.unitPrice,line.qty,'',/^\d{5}$/.test(line.postalCode)?line.postalCode:'',
    line.recipient,index===0?shipment.shippingFee:0,''];
  })),
 };
 return {headers:first.columns.map(column=>column.header),
  widths:first.columns.map(column=>column.key==='address'?48:column.key.endsWith('Id')?40:22),
  rows:shipments.flatMap(shipment=>shipment.lines.map(line=>shipmentExportCells(line,first.columns)))};
}
export async function buildShipmentExport(data:ShipmentExportData,format:'xlsx'|'csv'){
 const groups=new Map<string,ShipmentExportData['shipments']>();
 for(const shipment of data.shipments){
  const group=groups.get(shipment.originId);
  if(!['standard','wms_csv','seowon_xlsx'].includes(shipment.template)
   ||(shipment.template==='standard'&&!parseShipmentExportColumns(shipment.columns))||!shipment.lines.length
   ||(group&&group[0].template!==shipment.template))throw new Error('출고지시 양식 또는 상품 정보를 확인해주세요.');
  if(shipment.template==='wms_csv'&&(!Number.isSafeInteger(shipment.shippingFee)||shipment.shippingFee<0
   ||shipment.lines.some(line=>!Number.isSafeInteger(line.unitPrice)||line.unitPrice<0)))throw new Error('출고지시 금액 정보를 확인해주세요.');
  groups.set(shipment.originId,[...(group??[]),shipment]);
 }
 if(!groups.size)throw new Error('내보낼 배송 건이 없습니다.');
 if(format==='csv'){
  if(groups.size!==1)throw new Error('CSV는 출고지를 하나 선택한 뒤 내려받아주세요.');
  const table=exportTable([...groups.values()][0]);
  return {bytes:Buffer.from(shipmentExportRowsCsv(table.headers,table.rows),'utf8'),mime:'text/csv;charset=utf-8',extension:'csv'};
 }
 const workbook=new ExcelJS.Workbook();let count=0;
 for(const shipments of groups.values()){
  const first=shipments[0];const name=`${++count}-${first.originName}`.replace(/[\\/*?:[\]]/g,' ').slice(0,31).replace(/'$/,'’');
  const table=exportTable(shipments);
  const sheet=workbook.addWorksheet(name);sheet.addRow([...table.headers]);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
  sheet.columns=table.widths.map(width=>({width}));
  for(const row of table.rows)sheet.addRow(row);
  sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:table.headers.length}};
 }
 return {bytes:Buffer.from(await workbook.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
}
