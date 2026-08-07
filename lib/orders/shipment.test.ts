import { describe, expect, it } from 'vitest';
import {
  SHIPPING_CARRIERS,
  isShippingCarrierCode,
  isTrackingNumber,
  normalizeTrackingNumber,
  orderShipment,
  shippingCarrierLabel,
} from './shipment';

describe('shipping carriers', () => {
  it('한진택배를 실제 계약 택배사로 포함하고 코드는 DB 제약 형식을 지킨다', () => {
    expect(SHIPPING_CARRIERS.some((carrier) => carrier.code === 'hanjin')).toBe(true);
    for (const carrier of SHIPPING_CARRIERS) {
      expect(carrier.code).toMatch(/^[a-z0-9_]{2,32}$/);
      expect(carrier.label.length).toBeGreaterThan(0);
    }
  });

  it('허용 목록 밖 코드는 거절한다', () => {
    expect(isShippingCarrierCode('hanjin')).toBe(true);
    expect(isShippingCarrierCode('HANJIN')).toBe(false);
    expect(isShippingCarrierCode('unknown_carrier')).toBe(false);
    expect(isShippingCarrierCode('')).toBe(false);
  });

  it('알 수 없는 코드에는 라벨을 지어내지 않는다', () => {
    expect(shippingCarrierLabel('hanjin')).toBe('한진택배');
    expect(shippingCarrierLabel('unknown_carrier')).toBeNull();
  });
});

describe('normalizeTrackingNumber', () => {
  it('공백·하이픈을 제거하고 대문자로 고정한다', () => {
    expect(normalizeTrackingNumber(' 1234-5678-9012 ')).toBe('123456789012');
    expect(normalizeTrackingNumber('ab12cd34ef')).toBe('AB12CD34EF');
  });

  it('DB 제약과 같은 형식만 통과시킨다', () => {
    expect(isTrackingNumber('123456789012')).toBe(true);
    expect(isTrackingNumber('1234567')).toBe(false);
    expect(isTrackingNumber('1'.repeat(31))).toBe(false);
    expect(isTrackingNumber('1234-5678-9012')).toBe(false);
  });
});

describe('orderShipment', () => {
  it('택배사 라벨과 조회 링크를 함께 만든다', () => {
    const shipment = orderShipment('hanjin', '123456789012');

    expect(shipment).toMatchObject({
      carrier: 'hanjin',
      carrierLabel: '한진택배',
      trackingNumber: '123456789012',
    });
    expect(shipment?.trackingUrl).toContain('123456789012');
    expect(shipment?.trackingUrl.startsWith('https://')).toBe(true);
  });

  it('한쪽만 있거나 알 수 없는 택배사면 배송 정보를 만들지 않는다', () => {
    expect(orderShipment(null, '123456789012')).toBeNull();
    expect(orderShipment('hanjin', null)).toBeNull();
    expect(orderShipment('unknown_carrier', '123456789012')).toBeNull();
    expect(orderShipment('hanjin', '   ')).toBeNull();
  });
});
