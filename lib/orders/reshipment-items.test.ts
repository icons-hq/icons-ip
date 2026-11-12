import { describe, expect, it } from 'vitest';
import { orderReshipmentReceipt } from '@/test/fixtures/order-reshipment';
import { parseOrderReshipmentHistory, parseOrderReshipmentParcels, type OrderReshipmentParcel } from './reshipment-items';

const parcel: OrderReshipmentParcel = {
  claimId: '93942000-0000-4000-8000-000000000011', reshipmentId: '93942000-0000-4000-8000-000000000021', carrier: 'hanjin',
  trackingNumber: 'EXCHANGE0001', reshippedAt: '2026-11-10T01:00:00.000Z', deliveredAt: null, collectionWaived: true,
  items: [{ orderItemId: '93942000-0000-4000-8000-000000000013', name: '교환 출고 파랑 상품', variantName: '기본', qty: 2 }],
};

describe('exchange parcels per origin (TKT-166)', () => {
  it('reads several parcels of one exchange and a legacy claim pair', () => {
    const second = { ...parcel, reshipmentId: '93942000-0000-4000-8000-000000000022', trackingNumber: 'EXCHANGE0002', collectionWaived: false };
    const legacy = { ...parcel, claimId: '93942000-0000-4000-8000-000000000012', reshipmentId: null };
    expect(parseOrderReshipmentParcels([parcel, second, legacy])).toEqual([parcel, second, legacy]);
    expect(parseOrderReshipmentParcels([])).toEqual([]);
  });
  it.each([
    null,
    [parcel, parcel],
    [{ ...parcel, originName: '김포' }],
    [{ ...parcel, waiverReason: '내부 사유' }],
    [{ ...parcel, trackingNumber: 'bad' }],
    [{ ...parcel, deliveredAt: 'yesterday' }],
    [{ ...parcel, collectionWaived: 'yes' }],
    [{ ...parcel, items: [{ ...parcel.items[0], qty: 0 }] }],
    [{ ...parcel, items: [{ ...parcel.items[0], variantCode: 'INTERNAL' }] }],
  ])('rejects private or malformed parcel data %#', value => {
    expect(parseOrderReshipmentParcels(value)).toBeNull();
  });
});

describe('actual reshipment history', () => {
  it('keeps the physical shipment label and stable item identity', () => {
    expect(parseOrderReshipmentHistory([orderReshipmentReceipt])).toEqual([orderReshipmentReceipt]);
    expect(parseOrderReshipmentHistory([])).toEqual([]);
  });
  it.each([
    null,
    [orderReshipmentReceipt, orderReshipmentReceipt],
    [{ ...orderReshipmentReceipt, actorId: 'internal' }],
    [{ ...orderReshipmentReceipt, reshippedAt: 'invalid' }],
    [{ ...orderReshipmentReceipt, items: [] }],
    [{ ...orderReshipmentReceipt, items: [...orderReshipmentReceipt.items, ...orderReshipmentReceipt.items] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], qty: 0 }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], qty: 2147483648 }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], name: '' }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], operationPath: [] }] }],
  ])('rejects incomplete, duplicate or private receipt data %#', value => {
    expect(parseOrderReshipmentHistory(value)).toBeNull();
  });
});
