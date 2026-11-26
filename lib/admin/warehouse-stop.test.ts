import { describe, expect, it } from 'vitest';
import {
  WAREHOUSE_STOP_RETURNED_LOCK_REASON,
  WAREHOUSE_STOP_STATUS_LABELS,
  canceledDispatchResolveConfirm,
  canceledDispatchResolveMissing,
  isoToKstLocal,
  kstLocalToIso,
  normalizeCanceledDispatchResolution,
  normalizeWarehouseStopReplyInput,
  parseOrderWarehouseStopContext,
  warehouseStopErrorMessage,
  warehouseStopReplyConfirm,
  warehouseStopReplyMissing,
  warehouseStopRequirement,
  warehouseStopReturnedAllowed,
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
        recordedByName: '운영자', current: true, usedKind: null, usedAt: null, supersededAt: null }] },
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
    const used = parseOrderWarehouseStopContext({ ...raw, shipments: [{ ...raw.shipments[0], replies: [{ ...raw.shipments[0].replies[0], outcome: 'returned',
      usedKind: 'claim_collection', usedAt: '2026-11-19T03:00:00Z', supersededAt: '2026-11-19T04:00:00Z' }] }] })!;
    expect(used.shipments[0].replies[0]).toMatchObject({ outcome: 'returned', usedKind: 'claim_collection', supersededAt: '2026-11-19T04:00:00Z' });
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
    expect(warehouseStopErrorMessage('claim_collection_warehouse_already_shipped')).toContain('반송 입고');
    expect(warehouseStopErrorMessage('claim_collection_warehouse_reply_required')).toContain('창고 회신 기록');
    expect(warehouseStopErrorMessage('warehouse_stop_reply_returned_without_shipped')).toContain('이미 출고했다고 회신한');
    expect(warehouseStopErrorMessage('something_else')).toContain('새로고침');
  });
});

describe('창고 회신 이름과 오류 문구', () => {
  it('상태 이름은 회신 결과 이름(출고 중단 확인)과 같은 말이다', () => {
    expect(WAREHOUSE_STOP_STATUS_LABELS.required).toBe('창고 회신 기록 필요');
    expect(WAREHOUSE_STOP_STATUS_LABELS.stopped).toBe('출고 중단 회신 있음');
    expect(WAREHOUSE_STOP_STATUS_LABELS.already_shipped).toBe('이미 출고 회신');
    expect(WAREHOUSE_STOP_STATUS_LABELS.used).toBe('다른 취소에 쓴 회신');
  });

  it('같은 번호로 다른 내용이 들어왔을 때는 요청·번호 같은 내부 말 없이 다음 할 일을 말한다', () => {
    for (const code of ['warehouse_stop_reply_operation_conflict', 'canceled_dispatch_operation_conflict']) {
      const message = warehouseStopErrorMessage(code);
      expect(message).toContain('이미 다른 내용으로');
      expect(message).toContain('새로고침');
      expect(message).not.toMatch(/요청|번호/);
    }
    expect(warehouseStopErrorMessage('operator_capability_required')).toContain('이 작업을 할 권한이 없습니다');
  });

  it('취소 뒤 출고 발견의 택배사 이름은 읽는 쪽이 채울 때만 받고 없으면 비워 둔다(코드를 이름으로 지어내지 않는다)', () => {
    const labeled = parseOrderWarehouseStopContext({ ...raw, discoveries: [{ ...raw.discoveries[0], carrier: 'epost', carrierLabel: '우체국택배', trackingNumber: '6000000000001' }] })!;
    expect(labeled.discoveries[0]).toMatchObject({ carrier: 'epost', carrierLabel: '우체국택배' });
    expect(parseOrderWarehouseStopContext(raw)!.discoveries[0].carrierLabel).toBeNull();
  });
});

describe('창고 회신 양식의 잠금과 확인창', () => {
  it('반송 입고는 고른 배송 건이 모두 이미 출고 회신이 있는 발송 대기 건일 때만 고를 수 있다(DB 판정과 같다)', () => {
    expect(warehouseStopReturnedAllowed([{ status: 'ready', stopStatus: 'already_shipped' }])).toBe(true);
    expect(warehouseStopReturnedAllowed([{ status: 'ready', stopStatus: 'already_shipped' }, { status: 'ready', stopStatus: 'required' }])).toBe(false);
    expect(warehouseStopReturnedAllowed([{ status: 'canceled', stopStatus: 'not_applicable' }])).toBe(false);
    expect(warehouseStopReturnedAllowed([{ status: 'ready', stopStatus: 'stopped' }])).toBe(false);
    expect(warehouseStopReturnedAllowed([])).toBe(false);
    expect(WAREHOUSE_STOP_RETURNED_LOCK_REASON).toContain('이미 출고했다고 회신한 발송 대기 배송 건에만');
  });

  it('회신 기록은 빠진 것을 순서대로 하나씩 말하고, 다 채우면 null이다', () => {
    const full = { selected: 1, outcome: 'stopped', channel: 'phone', repliedAt: '2026-11-19T14:05', note: '' };
    expect(warehouseStopReplyMissing({ ...full, selected: 0 })).toBe('기록할 배송 건을 골라주세요.');
    expect(warehouseStopReplyMissing({ ...full, outcome: '' })).toBe('창고 회신 결과를 골라주세요.');
    expect(warehouseStopReplyMissing({ ...full, channel: '' })).toBe('회신 경로를 골라주세요.');
    expect(warehouseStopReplyMissing({ ...full, repliedAt: '' })).toBe('창고가 회신한 시각을 넣어주세요.');
    expect(warehouseStopReplyMissing({ ...full, channel: 'other' })).toContain('경로가 기타이면 메모');
    expect(warehouseStopReplyMissing({ ...full, channel: 'other', note: '서원 담당 통화' })).toBeNull();
    expect(warehouseStopReplyMissing(full)).toBeNull();
  });

  it('취소 뒤 출고 처리는 결과와 5자 이상 근거가 있어야 한다', () => {
    expect(canceledDispatchResolveMissing({ outcome: '', note: '반송 상자 입고 확인' })).toBe('처리 결과를 골라주세요.');
    expect(canceledDispatchResolveMissing({ outcome: 'lost', note: ' 짧음 ' })).toBe('근거를 5자 이상 적어주세요.');
    expect(canceledDispatchResolveMissing({ outcome: 'lost', note: '반송 상자 입고 확인' })).toBeNull();
  });

  it('회신 기록 확인창은 대상·결과를 말하고 기록은 지울 수 없다고 한다. 취소된 배송 건의 이미 출고는 재고가 다시 빠진다고 먼저 말한다', () => {
    const plain = warehouseStopReplyConfirm({ targets: '남양주 · 2026111930000001', outcome: 'stopped', canceledSelected: false });
    expect(plain.title).toBe('창고 회신을 기록할까요?');
    expect(plain.message).toContain('배송 건 남양주 · 2026111930000001에 창고 회신(출고 중단 확인)을 남깁니다.');
    expect(plain.message).toContain('기록은 지울 수 없습니다.');
    expect(plain.confirmLabel).toBe('회신 기록');
    expect(plain.destructive).toBe(false);
    const discovery = warehouseStopReplyConfirm({ targets: '김포 · 2026111930000002', outcome: 'already_shipped', canceledSelected: true });
    expect(discovery.message).toContain("'취소 뒤 출고 발견'으로 남고, 그 수량만큼 재고를 다시 뺍니다.");
    expect(discovery.destructive).toBe(true);
    /* 취소된 배송 건이 없으면 이미 출고여도 재고를 건드리지 않는다. */
    expect(warehouseStopReplyConfirm({ targets: 'x', outcome: 'already_shipped', canceledSelected: false }).destructive).toBe(false);
  });

  it('취소 뒤 출고 처리 확인창은 어느 배송 건인지와 재고 결과(되돌림·그대로)를 말한다', () => {
    const returned = canceledDispatchResolveConfirm({ target: '남양주 · 2026111930000001', outcome: 'returned', withdrawnQty: 2 });
    expect(returned.message).toContain('배송 건 남양주 · 2026111930000001');
    expect(returned.message).toContain('발견 때 뺀 재고 2개를 되돌립니다. 되돌릴 수 없습니다.');
    expect(returned.confirmLabel).toBe('회수 입고 처리');
    const lost = canceledDispatchResolveConfirm({ target: '남양주 · 2026111930000001', outcome: 'lost', withdrawnQty: 2 });
    expect(lost.message).toContain('재고는 발견 때 뺀 그대로 둡니다. 되돌릴 수 없습니다.');
    expect(lost.confirmLabel).toBe('손실 처리');
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
