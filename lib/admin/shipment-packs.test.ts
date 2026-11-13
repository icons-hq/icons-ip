import { describe, expect, it } from 'vitest';
import { parseShipmentPackSummary } from './shipment-packs';

const pack = { id: '00000000-0000-4000-8000-000000000001', revision: 1, count: 2,
  shipmentIds: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'], collectFee: 4000, canRelease: true };

describe('shipment pack summary', () => {
  it('keeps the collect fee for order readers and accepts it blank for dispatch-only operators (1014-084 수령인 정보만)', () => {
    expect(parseShipmentPackSummary(pack)).toEqual(pack);
    expect(parseShipmentPackSummary({ ...pack, collectFee: null })).toEqual({ ...pack, collectFee: null });
  });
  it('still rejects malformed fees and member counts', () => {
    expect(parseShipmentPackSummary({ ...pack, collectFee: -1 })).toBeNull();
    expect(parseShipmentPackSummary({ ...pack, collectFee: '4000' })).toBeNull();
    expect(parseShipmentPackSummary({ ...pack, count: 3 })).toBeNull();
    expect(parseShipmentPackSummary({ ...pack, extra: true })).toBeNull();
  });
});
