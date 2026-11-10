/** Warehouse exchange format. References/phone/postal codes stay strings in xlsx. */
export interface ShipmentExportLine {
  shipmentId:string;orderId:string;recipient:string;phone:string;postalCode:string;address:string;
  goodCode:string;variantCode:string;goodName:string;optionName:string;qty:number;unitPrice:number;deliveryNote:string;carrier:string;
  /**
   * 옵션의 바코드·ERP 코드·ERP 품명. 주문 시점 스냅샷이 우선이고, 스냅샷 값이 비어 있으면 지금 등록된 값이다(필드별).
   * 둘 다 없으면 빈 문자열이다. 이 키가 없는 옛 응답·테스트 행은 빈칸으로 내보낸다.
   */
  barcode?:string;erpCode?:string;erpName?:string;
  smartstore?:import('./smartstore-shipment-workbook').SmartStoreShipmentDetail;
}
export type ShipmentExportKey=Exclude<keyof ShipmentExportLine,'unitPrice'|'smartstore'>;
export type ShipmentExportLayout='smartstore'|'warehouse';
export interface ShipmentExportColumn {key:ShipmentExportKey;header:string}
export const DEFAULT_SHIPMENT_EXPORT_COLUMNS:readonly ShipmentExportColumn[]=[
  {key:'shipmentId',header:'배송건번호'},{key:'orderId',header:'주문번호'},{key:'recipient',header:'수취인'},
  {key:'phone',header:'연락처'},{key:'postalCode',header:'우편번호'},{key:'address',header:'주소'},
  {key:'goodCode',header:'상품코드'},{key:'goodName',header:'상품명'},{key:'optionName',header:'옵션'},
  {key:'qty',header:'수량'},{key:'deliveryNote',header:'배송메시지'},{key:'carrier',header:'택배사'},
];
export const OPTIONAL_SHIPMENT_EXPORT_COLUMNS:readonly ShipmentExportColumn[]=[
  {key:'variantCode',header:'옵션코드'},{key:'barcode',header:'바코드'},{key:'erpCode',header:'ERP 코드'},{key:'erpName',header:'ERP 품명'},
];
/** 내보내기 전 경고 문구(10/27 회의 D10). 출고는 막지 않는다. */
export const shipmentBarcodeGapWarning=(missing:number)=>`바코드가 없는 옵션 ${missing.toLocaleString('ko-KR')}개 — 파일의 바코드 칸이 비어 있습니다.`;
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
export const shipmentExportCells=(line:ShipmentExportLine,columns:readonly ShipmentExportColumn[])=>columns.map(column=>line[column.key]??'');
/** Quoting alone does not stop spreadsheet formulas. This export is text, never executable input. */
function csvCell(value:string|number){
  const raw=String(value);const text=/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;
  return `"${text.replaceAll('"','""')}"`;
}
export function shipmentExportCsv(lines:readonly ShipmentExportLine[],columns:readonly ShipmentExportColumn[]):string {
  return shipmentExportRowsCsv(columns.map(column=>column.header),lines.map(line=>shipmentExportCells(line,columns)));
}
export function shipmentExportRowsCsv(headers:readonly string[],rows:readonly (readonly (string|number)[])[]):string {
  return '\uFEFF'+[headers,...rows]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
}
