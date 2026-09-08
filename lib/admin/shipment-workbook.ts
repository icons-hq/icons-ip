/** Warehouse exchange format. References/phone/postal codes stay strings in xlsx. */
export interface ShipmentExportLine {
  shipmentId:string;orderId:string;recipient:string;phone:string;postalCode:string;address:string;
  goodCode:string;variantCode:string;goodName:string;optionName:string;qty:number;deliveryNote:string;carrier:string;
}
export type ShipmentExportKey=keyof ShipmentExportLine;
export interface ShipmentExportColumn {key:ShipmentExportKey;header:string}
export const DEFAULT_SHIPMENT_EXPORT_COLUMNS:readonly ShipmentExportColumn[]=[
  {key:'shipmentId',header:'배송건번호'},{key:'orderId',header:'주문번호'},{key:'recipient',header:'수취인'},
  {key:'phone',header:'연락처'},{key:'postalCode',header:'우편번호'},{key:'address',header:'주소'},
  {key:'goodCode',header:'상품코드'},{key:'goodName',header:'상품명'},{key:'optionName',header:'옵션'},
  {key:'qty',header:'수량'},{key:'deliveryNote',header:'배송메시지'},{key:'carrier',header:'택배사'},
];
export const OPTIONAL_SHIPMENT_EXPORT_COLUMNS:readonly ShipmentExportColumn[]=[{key:'variantCode',header:'옵션코드'}];
export function parseShipmentExportColumns(value:unknown):ShipmentExportColumn[]|null {
  if(!Array.isArray(value)||value.length<DEFAULT_SHIPMENT_EXPORT_COLUMNS.length||value.length>DEFAULT_SHIPMENT_EXPORT_COLUMNS.length+OPTIONAL_SHIPMENT_EXPORT_COLUMNS.length)return null;
  const keys=new Set([...DEFAULT_SHIPMENT_EXPORT_COLUMNS,...OPTIONAL_SHIPMENT_EXPORT_COLUMNS].map(column=>column.key));
  const required=new Set(DEFAULT_SHIPMENT_EXPORT_COLUMNS.map(column=>column.key));
  const headers=new Set<string>();const columns:ShipmentExportColumn[]=[];
  for(const raw of value){
    if(!raw||typeof raw!=='object'||!keys.has(raw.key)||typeof raw.header!=='string')return null;
    const header=raw.header.trim();
    if(!header||header.length>80||/[\r\n\u0000-\u001f]/.test(header)||headers.has(header))return null;
    keys.delete(raw.key);required.delete(raw.key);headers.add(header);columns.push({key:raw.key,header});
  }
  return required.size?null:columns;
}
export const shipmentExportCells=(line:ShipmentExportLine,columns:readonly ShipmentExportColumn[])=>columns.map(column=>line[column.key]);
/** Quoting alone does not stop spreadsheet formulas. This export is text, never executable input. */
function csvCell(value:string|number){
  const raw=String(value);const text=/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;
  return `"${text.replaceAll('"','""')}"`;
}
export function shipmentExportCsv(lines:readonly ShipmentExportLine[],columns:readonly ShipmentExportColumn[]):string {
  return '\uFEFF'+[columns.map(column=>column.header),...lines.map(line=>shipmentExportCells(line,columns))]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
}
