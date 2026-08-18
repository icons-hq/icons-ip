import { describe, expect, it } from 'vitest';
import {
  findShippingCarrier,
  isSelectableShippingCarrier,
  isShippingCarrierCode,
  isShippingCarrierCodeFormat,
  isTrackingNumber,
  normalizeTrackingNumber,
  orderShipment,
  selectableShippingCarriers,
  shippingCarrierLabel,
  shippingCarrierTrackingUrl,
  type ShippingCarrierRegistry,
} from './shipment';

/* DB `public.shipping_carriers`의 시작값과 같은 모양이다. 앱에는 상수 목록이 없고
   레지스트리가 유일한 진실원이므로, 테스트도 레지스트리를 만들어 넘긴다(#251). */
const REGISTRY: ShippingCarrierRegistry = [
  {
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
      + '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
  },
  {
    code: 'retired_courier',
    label: '계약종료 택배',
    active: false,
    trackingUrlTemplate: 'https://example.test/track?no={trackingNumber}',
  },
];

describe('택배사 레지스트리', () => {
  it('등록 여부와 지금 고를 수 있는지를 나눠 판정한다', () => {
    expect(isShippingCarrierCode(REGISTRY, 'hanjin')).toBe(true);
    /* 계약이 끝난 택배사도 등록은 등록이다 — 기존 주문의 조회 링크가 살아 있어야 한다. */
    expect(isShippingCarrierCode(REGISTRY, 'retired_courier')).toBe(true);
    expect(isSelectableShippingCarrier(REGISTRY, 'retired_courier')).toBe(false);
    expect(isSelectableShippingCarrier(REGISTRY, 'hanjin')).toBe(true);
  });

  it('레지스트리 밖 코드와 대소문자가 다른 코드는 거절한다', () => {
    expect(isShippingCarrierCode(REGISTRY, 'HANJIN')).toBe(false);
    expect(isShippingCarrierCode(REGISTRY, 'unknown_carrier')).toBe(false);
    expect(isShippingCarrierCode(REGISTRY, '')).toBe(false);
  });

  it('드롭다운에는 활성 택배사만 싣는다', () => {
    expect(selectableShippingCarriers(REGISTRY).map((carrier) => carrier.code))
      .toEqual(['hanjin']);
  });

  it('알 수 없는 코드에는 라벨을 지어내지 않는다', () => {
    expect(shippingCarrierLabel(REGISTRY, 'hanjin')).toBe('한진택배');
    expect(shippingCarrierLabel(REGISTRY, 'unknown_carrier')).toBeNull();
    expect(findShippingCarrier(REGISTRY, 'unknown_carrier')).toBeNull();
  });

  it('레지스트리에 넣을 수 있는 코드 형식은 DB CHECK와 같다', () => {
    expect(isShippingCarrierCodeFormat('hanjin')).toBe(true);
    expect(isShippingCarrierCodeFormat('cj_logistics')).toBe(true);
    expect(isShippingCarrierCodeFormat('CJ')).toBe(false);
    expect(isShippingCarrierCodeFormat('a')).toBe(false);
  });

  /* 조회 URL을 화면이 조립하지 않는다. 템플릿이 진실원이라 택배사를 늘려도
     코드는 그대로다 — 이슈 #251의 완료 조건 그 자체다. */
  it('조회 URL은 템플릿의 자리표시자를 채워 만든다', () => {
    expect(shippingCarrierTrackingUrl(REGISTRY[0], '123456789012'))
      .toBe(
        'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
        + '?mCode=MN038&schLang=KR&wblnumText2=123456789012',
      );
  });

  /* 템플릿은 운영자가 등록하는 값이다. 검증을 통과하지 않은 운송장으로 불려도
     템플릿이 열린 주입점이 되면 안 된다. */
  it('운송장 값을 URL에 인코딩해 끼운다', () => {
    expect(shippingCarrierTrackingUrl(REGISTRY[1], 'a&b=c'))
      .toBe('https://example.test/track?no=a%26b%3Dc');
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
    const shipment = orderShipment(REGISTRY, 'hanjin', '123456789012');

    expect(shipment).toMatchObject({
      carrier: 'hanjin',
      carrierLabel: '한진택배',
      trackingNumber: '123456789012',
    });
    expect(shipment?.trackingUrl).toContain('123456789012');
    expect(shipment?.trackingUrl.startsWith('https://')).toBe(true);
  });

  /* 계약이 끝나 비활성화된 택배사로 이미 나간 주문도 고객은 계속 추적할 수 있어야
     한다. 비활성화가 과거 배송의 조회 링크를 지우면 그만큼 CS가 수동이 된다. */
  it('비활성 택배사로 등록된 기존 배송도 그대로 조회된다', () => {
    expect(orderShipment(REGISTRY, 'retired_courier', '123456789012')).toMatchObject({
      carrier: 'retired_courier',
      carrierLabel: '계약종료 택배',
    });
  });

  it('한쪽만 있거나 알 수 없는 택배사면 배송 정보를 만들지 않는다', () => {
    expect(orderShipment(REGISTRY, null, '123456789012')).toBeNull();
    expect(orderShipment(REGISTRY, 'hanjin', null)).toBeNull();
    expect(orderShipment(REGISTRY, 'unknown_carrier', '123456789012')).toBeNull();
    expect(orderShipment(REGISTRY, 'hanjin', '   ')).toBeNull();
  });
});
