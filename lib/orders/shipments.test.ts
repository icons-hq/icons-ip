import { describe, expect, it } from 'vitest';
import { shipmentRecord, shipmentStatusLabel, type ShipmentRow } from './shipments';
const row: ShipmentRow = { id: 'shipment', order_id: 'order', origin_id: 'origin', origin_name_snapshot: '주문 당시 김포', shipping_fee: 3000, status: 'shipping', carrier: 'hanjin', tracking_number: '1234567890', shipped_at: '2026-09-08T00:00:00Z', delivered_at: null, exported_at: null, order_shipment_items: [{order_item_id:'item'}] };
const carriers = [{code:'hanjin',label:'한진택배',active:false,trackingUrlTemplate:'https://example.test/{trackingNumber}'}];
it('배송 건 스냅샷·품목 연결과 비활성 택배사의 과거 조회 링크를 보존한다', () => {
 expect(shipmentRecord(row, carriers)).toEqual({ id:'shipment',orderId:'order',originId:'origin',originName:'주문 당시 김포',shippingFee:3000,status:'shipping',carrier:'hanjin',carrierLabel:'한진택배',trackingNumber:'1234567890',trackingUrl:'https://example.test/1234567890',shippedAt:row.shipped_at,deliveredAt:null,exportedAt:null,orderItemIds:['item'] });
});
describe('배송 준비', () => {
 it('운송장이 없어도 배송 건·출고지·상태를 표시한다', () => {
  expect(shipmentRecord({...row,status:'ready',carrier:null,tracking_number:null},carriers)).toMatchObject({status:'ready',carrier:null,trackingNumber:null,trackingUrl:null});
  expect(shipmentStatusLabel('ready')).toBe('배송 준비');
 });
});
