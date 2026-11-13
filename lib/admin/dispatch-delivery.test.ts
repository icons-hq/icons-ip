import { describe, expect, it } from 'vitest';
import {
  availableDispatchMethods, dispatchDeliveryError, dispatchDeliveryPlan, dispatchHandoffFromForm, parseDispatchDeliveryOptions, parseDispatchDeliveryReceipt,
  type DispatchDeliveryOptions, type DispatchDeliveryShipment,
} from './dispatch-delivery';

const ORIGIN = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
function shipment(overrides: Partial<DispatchDeliveryShipment> = {}): DispatchDeliveryShipment {
  return { id: '20000000-0000-4000-8000-000000000001', orderId: '30000000-0000-4000-8000-000000000001', orderNumber: '2026111110000001', shipmentNumber: '2026111130000001',
    originId: ORIGIN, originName: '김포', status: 'ready', orderStatus: 'confirmed', customerMethod: 'parcel', method: 'parcel', updatedAt: '2026-11-11T00:00:00.123456+00:00',
    exportedAt: null, hasTracking: false, packed: false, claimOpen: false, preorderReady: true, canSelect: true, canHandoff: true, ...overrides };
}
const quick = { id: '40000000-0000-4000-8000-000000000001', originId: ORIGIN, method: 'quick' as const, revision: 1, contactName: '퀵 담당', handoffLocation: '1층 데스크' };
const pickup = { ...quick, id: '40000000-0000-4000-8000-000000000002', method: 'pickup' as const };

describe('발송처리 화면 배송 방법 계획 (S36-072·S36-X04)', () => {
  it('고른 건 전부의 출고지에서 켜진 방법만 고를 수 있고 택배는 늘 고를 수 있다', () => {
    const options: DispatchDeliveryOptions = { shipments: [shipment()], policies: [quick, pickup] };
    expect(availableDispatchMethods(options)).toEqual(['parcel', 'quick', 'pickup']);
    expect(availableDispatchMethods({ shipments: [shipment(), shipment({ id: '20000000-0000-4000-8000-000000000002', originId: OTHER })], policies: [quick, pickup] })).toEqual(['parcel']);
    expect(availableDispatchMethods({ shipments: [], policies: [quick] })).toEqual(['parcel']);
  });

  it('고객이 고른 방법과 다르게 바꾸는 건만 사유가 필요하고, 같은 방법·인계 없음은 제외한다', () => {
    const options: DispatchDeliveryOptions = { shipments: [shipment(), shipment({ id: '20000000-0000-4000-8000-000000000003', customerMethod: 'quick', method: 'parcel' })], policies: [quick] };
    const [parcelCustomer, quickCustomer] = dispatchDeliveryPlan(options, 'quick', true);
    expect(parcelCustomer).toMatchObject({ kind: 'apply', changeMethod: true, handoff: true, needsReason: true });
    expect(quickCustomer).toMatchObject({ kind: 'apply', changeMethod: true, handoff: true, needsReason: false });
    expect(dispatchDeliveryPlan(options, 'parcel', false).map(step => step.kind)).toEqual(['skip', 'skip']);
    /* 고객이 고른 택배로 되돌리는 건은 사유가 필요 없다. */
    expect(dispatchDeliveryPlan({ shipments: [shipment({ method: 'quick' })], policies: [quick] }, 'parcel', false)[0]).toMatchObject({ kind: 'apply', changeMethod: true, needsReason: false });
    expect(dispatchDeliveryPlan({ shipments: [shipment({ method: 'quick' })], policies: [quick] }, 'quick', true)[0]).toMatchObject({ kind: 'apply', changeMethod: false, handoff: true, needsReason: false });
    /* 방문수령은 인계 기록이 없다 — 방법만 적용한다. */
    expect(dispatchDeliveryPlan({ shipments: [shipment()], policies: [pickup] }, 'pickup', true)[0]).toMatchObject({ kind: 'apply', handoff: false, needsReason: true });
  });

  it('출고지시 전달·운송장·합포장·클레임·운영 조건 없음·발주확인 전 인계는 보내지 않고 이유를 보인다', () => {
    const blocked = (overrides: Partial<DispatchDeliveryShipment>, handoff = false) => dispatchDeliveryPlan({ shipments: [shipment(overrides)], policies: [quick] }, 'quick', handoff)[0];
    expect(blocked({ canSelect: false, exportedAt: '2026-11-11T00:00:00Z' })).toMatchObject({ kind: 'skip', reason: expect.stringContaining('출고지시') });
    expect(blocked({ canSelect: false, packed: true })).toMatchObject({ kind: 'skip', reason: expect.stringContaining('합포장') });
    expect(blocked({ canSelect: false, claimOpen: true })).toMatchObject({ kind: 'skip', reason: expect.stringContaining('취소·반품·교환') });
    expect(blocked({ canSelect: false, customerMethod: 'none', method: 'none' })).toMatchObject({ kind: 'skip', reason: expect.stringContaining('배송없음') });
    expect(blocked({ originId: OTHER })).toMatchObject({ kind: 'skip', reason: expect.stringContaining('운영 조건') });
    expect(blocked({ canHandoff: false, orderStatus: 'paid' }, true)).toMatchObject({ kind: 'skip', reason: expect.stringContaining('발주확인') });
    expect(blocked({ canHandoff: false, preorderReady: false }, true)).toMatchObject({ kind: 'skip', reason: expect.stringContaining('예약 품목') });
  });

  it('인계 시각은 한국 시각으로 읽어 UTC로 보내고, 빈 칸·긴 값은 받지 않는다', () => {
    const form = { operatorName: ' 출고 담당 ', providerName: '퀵 업체', providerPhone: '02-1234-5678', handoffReference: '인계 메모', occurredAt: '2026-11-11T18:30' };
    expect(dispatchHandoffFromForm(form)).toEqual({ operatorName: '출고 담당', providerName: '퀵 업체', providerPhone: '02-1234-5678', handoffReference: '인계 메모', occurredAt: '2026-11-11T09:30:00.000Z' });
    expect(dispatchHandoffFromForm({ ...form, providerName: '  ' })).toBeNull();
    expect(dispatchHandoffFromForm({ ...form, providerPhone: '0'.repeat(41) })).toBeNull();
    expect(dispatchHandoffFromForm({ ...form, occurredAt: '어제' })).toBeNull();
  });

  it('서버 응답은 형식이 맞을 때만 받고 동시 변경 확인용 시각을 문자열 그대로 둔다', () => {
    const raw = { shipments: [shipment()], policies: [{ ...quick, allowDelegate: false }] };
    expect(parseDispatchDeliveryOptions(raw)?.shipments[0].updatedAt).toBe('2026-11-11T00:00:00.123456+00:00');
    expect(parseDispatchDeliveryOptions({ ...raw, shipments: [{ ...shipment(), method: 'drone' }] })).toBeNull();
    expect(parseDispatchDeliveryOptions({ ...raw, policies: [{ ...quick, method: 'parcel' }] })).toBeNull();
    const receipt = { operationId: quick.id, method: 'quick', results: [{ shipmentId: shipment().id, ok: false, error: 'shipment_pack_method_locked' }], changed: 0, handedOff: 0, failed: 1, replayed: false };
    expect(parseDispatchDeliveryReceipt(receipt)).toEqual(receipt);
    expect(parseDispatchDeliveryReceipt({ ...receipt, results: [{ shipmentId: shipment().id, ok: true }] })).toBeNull();
    expect(dispatchDeliveryError('shipment_pack_method_locked')).toContain('합포장');
    expect(dispatchDeliveryError('production_incomplete')).toContain('제작 완료');
    expect(dispatchDeliveryError('unknown_code')).toContain('새로고침');
  });
});
