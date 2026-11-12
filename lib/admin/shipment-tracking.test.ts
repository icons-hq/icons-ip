import { describe, expect, it } from 'vitest';
import { parseShipmentTrackingSummaries, trackingProgressLabel } from './shipment-tracking';

const extra = { id: '00000000-0000-4000-8000-0000000000e1', carrier: 'epost', trackingNumber: 'XT10000002', source: 'warehouse_reply', createdAt: '2026-11-12T01:00:00Z' };
const progress = { total: 2, delivered: 1, latestStatus: 'out_for_delivery', latestAt: '2026-11-12T03:00:00Z', held: false };

describe('배송현황 추가 운송장·추적 표시 응답', () => {
  it('스위치가 켜져 있으면 자동·수동 구분과 추적 진행을 싣는다', () => {
    expect(parseShipmentTrackingSummaries({ autoDelivery: true, shipments: { a: { extraTrackings: [extra], deliveredBy: 'tracking', tracking: null }, b: { extraTrackings: [], deliveredBy: null, tracking: progress } } }, ['a', 'b']))
      .toEqual({ autoDelivery: true, shipments: { a: { extraTrackings: [extra], deliveredBy: 'tracking', tracking: null }, b: { extraTrackings: [], deliveredBy: null, tracking: progress } } });
  });
  it('스위치가 꺼져 있으면 추가 운송장만 남기고 추적 값은 실려 와도 비운다', () => {
    expect(parseShipmentTrackingSummaries({ autoDelivery: false, shipments: { a: { extraTrackings: [extra], deliveredBy: 'manual', tracking: progress } } }, ['a']))
      .toEqual({ autoDelivery: false, shipments: { a: { extraTrackings: [extra], deliveredBy: null, tracking: null } } });
  });
  it('모양이 틀리거나 목록의 배송 건이 빠지면 거절한다', () => {
    const valid = { autoDelivery: true, shipments: { a: { extraTrackings: [], deliveredBy: null, tracking: null } } };
    expect(parseShipmentTrackingSummaries(valid, ['a', 'missing'])).toBeNull();
    for (const broken of [
      null, { ...valid, autoDelivery: 'yes' }, { autoDelivery: true, shipments: [] },
      { autoDelivery: true, shipments: { a: { extraTrackings: [{ ...extra, trackingNumber: 'bad number' }], deliveredBy: null, tracking: null } } },
      { autoDelivery: true, shipments: { a: { extraTrackings: [{ ...extra, source: 'robot' }], deliveredBy: null, tracking: null } } },
      { autoDelivery: true, shipments: { a: { extraTrackings: [], deliveredBy: 'magic', tracking: null } } },
      { autoDelivery: true, shipments: { a: { extraTrackings: [], deliveredBy: null, tracking: { ...progress, delivered: 3 } } } },
      { autoDelivery: true, shipments: { a: { extraTrackings: [], deliveredBy: null, tracking: { ...progress, latestStatus: 'teleported' } } } },
    ]) expect(parseShipmentTrackingSummaries(broken, ['a'])).toBeNull();
  });
});

describe('trackingProgressLabel', () => {
  it('도착하지 않은 운송장이 남아 있으면 최근 이벤트가 배달 완료여도 이동 중으로 읽힌다', () => {
    expect(trackingProgressLabel({ latestStatus: 'delivered', delivered: 1, total: 2 })).toBe('택배 추적 이동 중 · 도착 1/2');
    expect(trackingProgressLabel({ latestStatus: 'delivered', delivered: 2, total: 2 })).toBe('택배 추적 배달 완료 · 도착 2/2');
    expect(trackingProgressLabel({ latestStatus: 'out_for_delivery', delivered: 1, total: 2 })).toBe('택배 추적 배송 출발 · 도착 1/2');
    expect(trackingProgressLabel({ latestStatus: null, delivered: 0, total: 1 })).toBe('택배 추적 기록 없음 · 도착 0/1');
  });
});
