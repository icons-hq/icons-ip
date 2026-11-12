import { describe, expect, it } from 'vitest';
import type { ShipmentExportData } from './shipment-dispatch';
import type { SmartStoreShipmentDetail } from './smartstore-shipment-workbook';
import { RECIPIENT_ONLY_DETAIL_FIELDS, recipientOnlyShipmentExport } from './shipment-export-recipient-only';

const detail = (n: number): SmartStoreShipmentDetail => ({
  orderNumber: `2026111110000${n}00`, productOrderNumber: `2026111120000${n}00`, shipmentNumber: `2026111130000${n}00`,
  itemId: `00000000-0000-4000-8000-00000000000${n}`, goodId: 'good', buyerName: '구매자', buyerId: '00000000-0000-4000-8000-0000000000aa',
  buyerPhone: '', address1: '주소', address2: `${n}층`, orderedAt: '2026-11-11T00:00:00Z', paidAt: '2026-11-11T00:01:00Z',
  confirmedAt: '2026-11-11T01:00:00Z', expectedShipDate: null, shippedAt: null, exportedAt: null, goodType: '문구', paymentMethod: 'card',
  productPrice: null, optionPrice: null, itemDiscount: 300, sellerDiscount: 300, itemTotal: 1700, regionalShippingFee: 3000, shippingDiscount: 500,
});
const line = (n: number) => ({ shipmentId: 'shipment', orderId: 'order', recipient: `수령인${n}`, phone: '01000000000', postalCode: '00123',
  address: '주소', goodCode: 'G', variantCode: 'V', goodName: '상품', optionName: '옵션', qty: n, unitPrice: 1000, deliveryNote: '문 앞', carrier: '한진',
  barcode: '880', erpCode: 'E', erpName: 'ERP', smartstore: detail(n) });
const data: ShipmentExportData = { shipments: [
  { id: 'a', updatedAt: 'x', originId: 'o', originName: '김포', shippingFee: 3000, shippingCollectFee: 0, template: 'standard', columns: [],
    pack: { id: 'p', revision: 1, count: 2, shipmentIds: ['a', 'b'], collectFee: 4000, canRelease: true }, lines: [line(1), line(2)] },
  { id: 'b', updatedAt: 'x', originId: 'o', originName: '김포', shippingFee: 0, shippingCollectFee: 4000, template: 'standard', columns: [],
    pack: null, lines: [{ ...line(3), smartstore: undefined }] },
] };
const references = (lines: ShipmentExportData['shipments'][number]['lines']) => lines.map(({ smartstore, ...rest }) => ({ rest, smartstore: smartstore && {
  orderNumber: smartstore.orderNumber, productOrderNumber: smartstore.productOrderNumber, shipmentNumber: smartstore.shipmentNumber,
  itemId: smartstore.itemId, address1: smartstore.address1, address2: smartstore.address2 } }));

describe('recipient-only standard export (1014-084 수령인 정보만)', () => {
  it('blanks buyer, payment, item amounts and the prepaid shipping fee in all shipments and lines, never only some rows', () => {
    const blanked = recipientOnlyShipmentExport(data);
    for (const shipment of blanked.shipments) {
      expect(shipment.shippingFee).toBeNull();
      for (const row of shipment.lines) if (row.smartstore) for (const field of RECIPIENT_ONLY_DETAIL_FIELDS) expect(row.smartstore[field], field).toBeNull();
    }
    expect(blanked.shipments[0].lines.map(row => row.smartstore?.itemTotal)).toEqual([null, null]);
  });
  /* 사용자 결정(2026-11-12) "착불 금액은 보이게": 창고가 수령인에게 받을 착불 배송비·합포장 착불 합계·착불 수납 정보는 그대로 둔다. */
  it('keeps the collect-on-delivery fee, pack collect total and collector terms for the warehouse', () => {
    const collector = { name: '한진 착불', method: '현장 수납', instructions: '착불 금액을 받습니다', refundContact: '02-000-0000' };
    const withCollector = { shipments: data.shipments.map(shipment => ({ ...shipment, collector })) } as unknown as ShipmentExportData;
    const blanked = recipientOnlyShipmentExport(withCollector);
    expect(blanked.shipments.map(shipment => shipment.shippingCollectFee)).toEqual([0, 4000]);
    expect(blanked.shipments[0].pack?.collectFee).toBe(4000);
    expect(blanked.shipments.map(shipment => shipment.collector)).toEqual([collector, collector]);
  });
  it('keeps recipient, address, goods, quantity, references and handling flags exactly', () => {
    const blanked = recipientOnlyShipmentExport(data);
    expect(blanked.shipments.map(shipment => references(shipment.lines as never)))
      .toEqual(data.shipments.map(shipment => references(shipment.lines)));
    expect(blanked.shipments[0].pack).toMatchObject({ id: 'p', count: 2, shipmentIds: ['a', 'b'], canRelease: true });
    expect(blanked.shipments[1].pack).toBeNull();
    expect(blanked.shipments[1].lines[0].smartstore).toBeUndefined();
  });
  it('classifies every detail field: only references, address, handling dates and goods stay', () => {
    const remaining = Object.keys(detail(1)).filter(field => !(RECIPIENT_ONLY_DETAIL_FIELDS as readonly string[]).includes(field)).sort();
    expect(remaining).toEqual(['address1', 'address2', 'buyerPhone', 'confirmedAt', 'expectedShipDate', 'exportedAt', 'goodId', 'goodType',
      'itemId', 'orderNumber', 'orderedAt', 'productOrderNumber', 'shipmentNumber', 'shippedAt']);
    // 구매자 연락처 칸은 DB가 늘 빈 문자열로 보낸다(admin_smartstore_shipment_export).
    expect(detail(1).buyerPhone).toBe('');
  });
  it('does not change the order reader data it was given', () => {
    const before = structuredClone(data);
    recipientOnlyShipmentExport(data);
    expect(data).toEqual(before);
  });
});
