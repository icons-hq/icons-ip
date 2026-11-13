import { describe, expect, it } from 'vitest';
import { SHIPMENT_SELECT, shipmentRecord, shipmentStatusLabel, type ShipmentRow } from './shipments';
import { chargePublicFixtures } from '@/test/fixtures/shipping-charge-groups';
const row: ShipmentRow = { id: 'shipment', order_id: 'order', origin_id: 'origin', origin_name_snapshot: '주문 당시 김포', shipping_fee: 3000, status: 'shipping', carrier: 'hanjin', tracking_number: '1234567890', shipped_at: '2026-09-08T00:00:00Z', delivered_at: null, exported_at: null, order_shipment_items: [{order_item_id:'item'}] };
const carriers = [{code:'hanjin',label:'한진택배',active:false,trackingUrlTemplate:'https://example.test/{trackingNumber}'}];
it('배송 건 스냅샷·품목 연결과 비활성 택배사의 과거 조회 링크를 보존한다', () => {
 expect(shipmentRecord(row, carriers)).toEqual({ id:'shipment',orderId:'order',originId:'origin',originName:'주문 당시 김포',shippingFee:3000,status:'shipping',carrier:'hanjin',carrierLabel:'한진택배',trackingNumber:'1234567890',trackingUrl:'https://example.test/1234567890',shippedAt:row.shipped_at,deliveredAt:null,exportedAt:null,orderItemIds:['item'],originalExpectedShipDate:null,expectedShipDate:null,preorderReady:true,regionalShipping:null });
});
it('주문 원 예정일과 변경 약속을 서로 덮어쓰지 않는다', () => {
 expect(shipmentRecord({ ...row, original_expected_ship_date:'2026-09-20', expected_ship_date:'2026-09-25', preorder_ready:false },carriers))
  .toMatchObject({ originalExpectedShipDate:'2026-09-20', expectedShipDate:'2026-09-25', preorderReady:false });
});
describe('배송 준비', () => {
 it('운송장이 없어도 배송 건·출고지·상태를 표시한다', () => {
  expect(shipmentRecord({...row,status:'ready',carrier:null,tracking_number:null},carriers)).toMatchObject({status:'ready',carrier:null,trackingNumber:null,trackingUrl:null});
  expect(shipmentStatusLabel('ready')).toBe('배송 준비');
 });
});
describe('신규 배송비 묶음그룹 스냅샷', () => {
 it('기존 레코드 형태를 유지하고 새 지역 source를 별도 필드로 읽는다', () => {
  const { snapshot } = chargePublicFixtures();
  const result = shipmentRecord({ ...row, origin_id: snapshot.originId, origin_name_snapshot: snapshot.originName,
    shipping_fee: snapshot.totalFee, shipping_fee_snapshot: snapshot }, carriers);
  expect(result.regionalShipping).toBeNull(); expect(result.chargeDetails).toEqual(snapshot.chargeDetails);
  expect(result.chargeRegional).toMatchObject({ version:1, regionalFee:5000 });
 });
 it('새 marker 오류·origin·이름·선결제액 불일치는 지역정보 없음으로 숨기지 않는다', () => {
  const { snapshot } = chargePublicFixtures(), valid = { ...row, origin_id:snapshot.originId, origin_name_snapshot:snapshot.originName,
    shipping_fee:snapshot.totalFee, shipping_fee_snapshot:snapshot };
  for (const patch of [{ origin_id:'other' }, { origin_name_snapshot:'다른 출고지' }, { shipping_fee:snapshot.totalFee+1 },
    { shipping_fee_snapshot:{ ...snapshot, chargeDetails:null } }, { shipping_fee_snapshot:{ ...snapshot, sourceEvidence:'PRIVATE' } }]) {
    expect(() => shipmentRecord({ ...valid, ...patch },carriers)).toThrow('shipment_shipping_charge_snapshot_invalid');
  }
  expect(shipmentRecord({ ...row, shipping_fee_snapshot:{} },carriers).regionalShipping).toBeNull();
 });
});
describe('배송 건 추가(연결) 운송장 (QNA-019)', () => {
 it('추가 운송장을 등록 순으로 조회 링크와 함께 싣고, 대표와 같은 번호·모르는 택배사·형식 오류는 뺀다', () => {
  const extra = (id: string, tracking_number: string, created_at: string, carrier = 'hanjin') => ({ id, carrier, tracking_number, created_at });
  const result = shipmentRecord({ ...row, extra_trackings: [extra('b', '2234567890', '2026-11-12T02:00:00Z'), extra('a', '3234567890', '2026-11-12T01:00:00Z'),
    extra('c', '1234567890', '2026-11-12T03:00:00Z'), extra('d', '4234567890', '2026-11-12T04:00:00Z', 'unknown'), extra('e', 'bad', '2026-11-12T05:00:00Z')] }, carriers);
  expect(result.extraTrackings).toEqual([
   { id: 'a', carrier: 'hanjin', carrierLabel: '한진택배', trackingNumber: '3234567890', trackingUrl: 'https://example.test/3234567890' },
   { id: 'b', carrier: 'hanjin', carrierLabel: '한진택배', trackingNumber: '2234567890', trackingUrl: 'https://example.test/2234567890' },
  ]);
 });
 it('추가 운송장이 없으면 키를 싣지 않아 기존 레코드 모양 그대로다', () => {
  expect(shipmentRecord({ ...row, extra_trackings: [] }, carriers)).not.toHaveProperty('extraTrackings');
  expect(shipmentRecord(row, carriers)).not.toHaveProperty('extraTrackings');
 });
 it('배송 건 조회가 추가 운송장을 함께 읽는다(RLS: 주문 본인·주문 조회 운영자)', () => {
  expect(SHIPMENT_SELECT).toContain('extra_trackings:order_shipment_extra_trackings(id,carrier,tracking_number,created_at)');
 });
});
