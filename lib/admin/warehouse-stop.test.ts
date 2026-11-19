import { describe, expect, it } from 'vitest';
import {
  isoToKstLocal,
  kstLocalToIso,
  normalizeCanceledDispatchResolution,
  normalizeWarehouseStopReplyInput,
  parseOrderWarehouseStopContext,
  warehouseStopErrorMessage,
  warehouseStopRequirement,
} from './warehouse-stop';

const ORDER = '11111111-1111-4111-8111-111111111111';
const SHIPMENT_A = '22222222-2222-4222-8222-222222222221';
const SHIPMENT_B = '22222222-2222-4222-8222-222222222222';
const OPERATION = '33333333-3333-4333-8333-333333333333';

const raw = {
  orderId: ORDER, orderStatus: 'confirmed', canRecord: true, canResolve: false,
  shipments: [
    { shipmentId: SHIPMENT_A, shipmentNumber: '2026111930000001', originName: '김포', status: 'ready', exportedAt: '2026-11-19T01:00:00Z', stopStatus: 'stopped',
      replies: [{ id: 'r1', outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T02:00:00Z', note: null, recordedAt: '2026-11-19T02:01:00Z',
        recordedByName: '운영자', current: true, usedKind: null, usedAt: null }] },
    { shipmentId: SHIPMENT_B, shipmentNumber: null, originName: '남양주', status: 'ready', exportedAt: '2026-11-19T01:00:00Z', stopStatus: 'required', replies: [] },
  ],
  discoveries: [{ id: 'd1', shipmentId: SHIPMENT_B, shipmentNumber: null, originName: '남양주', source: 'warehouse_reply', carrier: null, trackingNumber: null,
    discoveredAt: '2026-11-19T03:00:00Z', discoveredByName: null, state: 'open', restoredQty: 1, withdrawnQty: 1, shortfallQty: 0, returnedQty: null,
    resolvedAt: null, resolvedByName: null, resolutionNote: null,
    lines: [{ orderItemId: 'i1', goodName: '합성 키링', variantName: null, restoredQty: 1, withdrawnQty: 1, returnedQty: null }] }],
};

describe('창고 회신 문맥 읽기 (ADR-0046)', () => {
  it('DB 응답을 그대로 해석하고 모양이 다르면 null이다', () => {
    const parsed = parseOrderWarehouseStopContext(raw)!;
    expect(parsed.shipments.map(item => item.stopStatus)).toEqual(['stopped', 'required']);
    expect(parsed.shipments[0].replies[0]).toMatchObject({ outcome: 'stopped', channel: 'phone', current: true, usedKind: null });
    expect(parsed.discoveries[0]).toMatchObject({ source: 'warehouse_reply', state: 'open', withdrawnQty: 1 });
    expect(parseOrderWarehouseStopContext({ ...raw, canRecord: 'yes' })).toBeNull();
    expect(parseOrderWarehouseStopContext({ ...raw, shipments: [{ ...raw.shipments[0], stopStatus: 'maybe' }] })).toBeNull();
    expect(parseOrderWarehouseStopContext({ ...raw, discoveries: [{ ...raw.discoveries[0], state: 'gone' }] })).toBeNull();
    expect(parseOrderWarehouseStopContext({ ...raw, shipments: [{ ...raw.shipments[0], replies: [{ ...raw.shipments[0].replies[0], usedKind: 'other' }] }] })).toBeNull();
  });

  it('취소 양식의 판정은 DB와 같은 순서(이미 출고 → 회신 필요 → 이미 씀)로 가장 막는 상태를 고른다', () => {
    const parsed = parseOrderWarehouseStopContext(raw)!;
    expect(warehouseStopRequirement(parsed)).toMatchObject({ state: 'required', shipments: [{ shipmentId: SHIPMENT_B }] });
    expect(warehouseStopRequirement(parsed, [SHIPMENT_A])).toMatchObject({ state: 'ready', shipments: [{ shipmentId: SHIPMENT_A }] });
    const shipped = { ...parsed, shipments: parsed.shipments.map((item, index) => ({ ...item, stopStatus: index ? 'already_shipped' as const : 'used' as const })) };
    expect(warehouseStopRequirement(shipped).state).toBe('already_shipped');
    expect(warehouseStopRequirement(shipped, [SHIPMENT_A]).state).toBe('used');
  });

  it('DB 거절 코드를 운영자 다음 행동으로 옮긴다', () => {
    expect(warehouseStopErrorMessage('warehouse_stop_reply_required')).toContain('창고 회신 기록');
    expect(warehouseStopErrorMessage('warehouse_already_shipped')).toContain('반품');
    expect(warehouseStopErrorMessage('warehouse_stop_reply_used')).toContain('다른 취소');
    expect(warehouseStopErrorMessage('warehouse_stop_reply_before_export')).toContain('출고지시 파일을 보낸 시각');
    expect(warehouseStopErrorMessage('canceled_dispatch_already_resolved')).toContain('이미 처리');
    expect(warehouseStopErrorMessage('something_else')).toContain('새로고침');
  });
});

describe('회신 기록·발견 처리 입력', () => {
  const base = { orderId: ORDER, shipmentIds: [SHIPMENT_A], outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T14:05', note: ' 서원 통화 ', operationId: OPERATION };

  it('KST 화면 시각을 ISO로 바꾸고 메모를 다듬는다', () => {
    expect(normalizeWarehouseStopReplyInput(base)).toEqual({ ok: true, value: {
      orderId: ORDER, shipmentIds: [SHIPMENT_A], outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T05:05:00.000Z', note: '서원 통화', operationId: OPERATION } });
    expect(kstLocalToIso('2026-02-30T10:00')).toBeNull();
    expect(kstLocalToIso('2026-11-19 10:00')).toBeNull();
    expect(isoToKstLocal('2026-11-19T05:05:00.000Z')).toBe('2026-11-19T14:05');
  });

  it('배송 건·결과·경로·시각이 없거나 기타 경로에 메모가 없으면 거절한다', () => {
    expect(normalizeWarehouseStopReplyInput({ ...base, shipmentIds: [] })).toMatchObject({ ok: false, error: expect.stringContaining('배송 건') });
    expect(normalizeWarehouseStopReplyInput({ ...base, shipmentIds: [SHIPMENT_A, SHIPMENT_A] })).toMatchObject({ ok: false });
    expect(normalizeWarehouseStopReplyInput({ ...base, outcome: 'maybe' })).toMatchObject({ ok: false, error: expect.stringContaining('회신 결과') });
    expect(normalizeWarehouseStopReplyInput({ ...base, channel: 'fax' })).toMatchObject({ ok: false, error: expect.stringContaining('경로') });
    expect(normalizeWarehouseStopReplyInput({ ...base, repliedAt: '' })).toMatchObject({ ok: false, error: expect.stringContaining('시각') });
    expect(normalizeWarehouseStopReplyInput({ ...base, channel: 'other', note: '  ' })).toMatchObject({ ok: false, error: expect.stringContaining('메모') });
    expect(normalizeWarehouseStopReplyInput({ ...base, note: '가'.repeat(501) })).toMatchObject({ ok: false, error: expect.stringContaining('500자') });
    expect(normalizeWarehouseStopReplyInput({ ...base, operationId: 'nope' })).toMatchObject({ ok: false, error: expect.stringContaining('새로고침') });
  });

  it('발견 처리는 결과와 5자 이상 근거 메모를 받는다', () => {
    const resolution = { orderId: ORDER, dispatchId: SHIPMENT_B, outcome: 'returned', note: '반송 상자 입고 확인', operationId: OPERATION };
    expect(normalizeCanceledDispatchResolution(resolution)).toMatchObject({ ok: true, value: { outcome: 'returned', note: '반송 상자 입고 확인' } });
    expect(normalizeCanceledDispatchResolution({ ...resolution, note: '짧음' })).toMatchObject({ ok: false });
    expect(normalizeCanceledDispatchResolution({ ...resolution, outcome: 'refund' })).toMatchObject({ ok: false });
  });
});
