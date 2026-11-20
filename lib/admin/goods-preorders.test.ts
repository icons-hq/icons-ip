import { describe, expect, it } from 'vitest';
import {
  parseAdminPreorderReservations, parseGoodsPreorderInput, parseRandomPreorderRequest, pendingPreorderReservationsByVariant, preorderApplyProblemLabels, preorderApplyProblems,
  preorderCapacityFromStock, preorderCapacityProblem, preorderCapacityStockNote, preorderMutationError, preparePreorderAllocation,
} from './goods-preorders';
describe('preorder operation inputs', () => {
  /* 2026-11-19: 임시저장(초안)·승인 근거는 없다. 저장 = 적용이고 물량·접수 기간·발송 예정일만 있으면 된다. */
  it('rejects drafts, needs only quantity and promised dates to save, and keeps an optional note', () => {
    expect(parseGoodsPreorderInput({ state: 'draft', capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' })).toBeNull();
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01' }))
      .toMatchObject({ state: 'active', capacityQty: 50, approvalReference: null });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01', approvalReference: ' 일정 변경 메모 ' }))
      .toMatchObject({ approvalReference: '일정 변경 메모' });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '', startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01' })).toBeNull();
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '0' })).toBeNull();
  });
  it('interprets operator wall times in Korea and refuses an earlier promised date', () => {
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: '50', startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01', approvalReference: '공급 승인 1' }))
      .toMatchObject({ capacityQty: 50, startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-09-14', approvalReference: '공급 승인 1' })).toBeNull();
  });
  it('requires every selected order item and one consistent physical-stock observation per option', () => {
    const rows = [
      { orderItemId: '00000000-0000-4000-8000-000000000001', variantId: '00000000-0000-4000-8000-000000000003', physicalStockQty: 3 },
      { orderItemId: '00000000-0000-4000-8000-000000000002', variantId: '00000000-0000-4000-8000-000000000003', physicalStockQty: 3 },
    ];
    expect(preparePreorderAllocation(rows, rows.map((row) => row.orderItemId))).toEqual({
      orderItemIds: rows.map((row) => row.orderItemId), expectedStock: { '00000000-0000-4000-8000-000000000003': 3 },
    });
    expect(preparePreorderAllocation(rows, ['00000000-0000-4000-8000-000000000004'])).toBeNull();
    expect(preparePreorderAllocation([rows[0], { ...rows[1], physicalStockQty: 5 }], rows.map((row) => row.orderItemId))).toBeNull();
  });
});

describe('일반 재고 전환을 막는 미할당 예약', () => {
  it('옵션마다 모든 예약 조건(이전 회차의 중지된 조건 포함)의 미할당 수량을 합하고, 남은 옵션만 돌려준다', () => {
    const pending = pendingPreorderReservationsByVariant([
      { variantId: 'red', reservedQty: 0 }, { variantId: 'red', reservedQty: 2 }, { variantId: 'red', reservedQty: 1 },
      { variantId: 'blue', reservedQty: 0 },
    ]);
    expect([...pending]).toEqual([['red', 3]]);
    expect(pendingPreorderReservationsByVariant([]).size).toBe(0);
  });
});

describe('랜덤 판매 일괄 예약 입력', () => {
  const a = '00000000-0000-4000-8000-0000000000a1';
  const b = '00000000-0000-4000-8000-0000000000b1';
  const selected = '00000000-0000-4000-8000-0000000000d1';
  const values = { startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20' };
  it('공통 일정은 한 번, 예약 물량은 옵션별로 읽는다(저장 = 적용, 근거 없이)', () => {
    expect(parseRandomPreorderRequest('active', values, [
      { variantId: a, policyId: null, expectedRevision: null, capacityQty: '30' },
      { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 },
    ])).toEqual({
      state: 'active',
      values: { startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20', approvalReference: null },
      options: [
        { variantId: a, policyId: null, expectedRevision: null, capacityQty: 30 },
        { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 },
      ],
    });
  });
  it('저장은 모든 옵션 물량과 공통 일정이 있어야 하고, 초안·기존 정책 이어 쓰기는 없다', () => {
    const options = [{ variantId: a, policyId: null, expectedRevision: null, capacityQty: 30 }, { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 }];
    expect(parseRandomPreorderRequest('active', values, options)?.options.map((option) => option.capacityQty)).toEqual([30, 20]);
    expect(parseRandomPreorderRequest('active', values, [options[0], { ...options[1], capacityQty: '' }])).toBeNull();
    expect(parseRandomPreorderRequest('active', { ...values, expectedShipDate: '2099-11-01' }, options)).toBeNull();
    expect(parseRandomPreorderRequest('active', values, [{ ...options[0], policyId: selected, expectedRevision: 1 }])).toBeNull();
    expect(parseRandomPreorderRequest('draft', values, options)).toBeNull();
  });
  it('중지·일반 재고 전환은 옵션마다 선택된 정책과 revision만 보낸다', () => {
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: 2 }]))
      .toEqual({ state: 'stopped', values: null, options: [{ variantId: a, policyId: selected, expectedRevision: 2 }] });
    expect(parseRandomPreorderRequest('stock', null, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', values, [{ variantId: a, policyId: selected, expectedRevision: 2 }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: 2, capacityQty: 1 }])).toBeNull();
  });
  it('중복 옵션·짝이 맞지 않는 정책·잘못된 상태는 거절한다', () => {
    expect(parseRandomPreorderRequest('active', values, [{ variantId: a, policyId: null, expectedRevision: null, capacityQty: 1 }, { variantId: a, policyId: null, expectedRevision: null, capacityQty: 1 }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: selected, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('open', values, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('active', values, [])).toBeNull();
  });
  it('일괄 저장 거절 코드를 운영자 문구로 옮긴다', () => {
    expect(preorderMutationError('random_preorder_options_mismatch')).toContain('새로고침');
    expect(preorderMutationError('random_option_preorder_mismatch')).toContain('발송 예정일');
  });
});

describe('출고 보류 예약 주문 표시', () => {
  const row = { orderItemId: '10000000-0000-4000-8000-000000000001', orderId: '20000000-0000-4000-8000-000000000001', policyId: '30000000-0000-4000-8000-000000000001',
    variantId: '40000000-0000-4000-8000-000000000001', variantName: null, qty: 1, physicalStockQty: 3, state: 'reserved', orderStatus: 'paid',
    expectedShipDate: '2026-12-02', createdAt: '2026-11-18T00:00:00Z', allocatedAt: null, allocationReference: null, releasedAt: null, releaseReason: null };
  it('보류 여부를 읽고(옛 응답은 없음) 형식이 틀리면 거절한다', () => {
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [{ ...row, fulfillmentHold: true }] })?.items[0].fulfillmentHold).toBe(true);
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [row] })?.items[0].fulfillmentHold).toBeUndefined();
    expect(parseAdminPreorderReservations({ total: 1, hasMore: false, items: [{ ...row, fulfillmentHold: 'yes' }] })).toBeNull();
    expect(preorderMutationError('order fulfillment hold')).toContain('출고 보류');
  });
});

/* 2026-11-19: 예약판매는 저장하면 적용된다. 저장할 때 빈 칸·DB가 거절할 값은 칸마다 이유를 보이고 막는다(승인 근거 칸은 없다). */
describe('예약판매 저장 전 칸별 확인', () => {
  const now = Date.parse('2026-11-19T05:00:00.000Z'); // 2026-11-19 14:00 KST
  const filled = { capacityQty: '300', startsAt: '2026-11-20T10:00', endsAt: '2026-12-01T23:59', expectedShipDate: '2026-12-10' };
  it('빈 칸은 칸마다 이유를 돌려주고, 이름은 화면 순서로 잇는다', () => {
    const problems = preorderApplyProblems({ capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '' }, now);
    expect(Object.keys(problems)).toEqual(['capacityQty', 'startsAt', 'endsAt', 'expectedShipDate']);
    expect(problems.capacityQty).toBe('예약 물량을 입력해주세요.');
    expect(preorderApplyProblemLabels(problems)).toBe('예약 물량·접수 시작·접수 종료·발송 예정일');
    /* 사고 그대로(물량·접수 종료가 빈 초안): 이제 저장 자체가 막히고 두 칸을 알린다. */
    expect(preorderApplyProblemLabels(preorderApplyProblems({ ...filled, capacityQty: '', endsAt: '' }, now))).toBe('예약 물량·접수 종료');
  });
  it('모두 맞으면 빈 객체이고, DB와 같은 순서·시각 규칙을 미리 막는다', () => {
    expect(preorderApplyProblems(filled, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, capacityQty: '0' }, now).capacityQty).toContain('1 이상의 정수');
    expect(preorderApplyProblems({ ...filled, endsAt: '2026-11-20T09:00' }, now).endsAt).toContain('접수 시작보다 뒤');
    expect(preorderApplyProblems({ ...filled, startsAt: '2026-11-01T10:00', endsAt: '2026-11-19T13:59' }, now).endsAt).toContain('지금보다 뒤');
    /* 발송 예정일은 접수 종료일(KST) 이상이다 — 12/1 23:59 KST 종료면 12/1은 되고 11/30은 안 된다. */
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-12-01' }, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-11-30' }, now).expectedShipDate).toContain('접수 종료일과 같거나 뒤');
  });
  it('랜덤 판매의 공통 칸 확인은 물량을 빼고, 옵션별 물량은 따로 본다', () => {
    const { capacityQty, ...common } = filled; void capacityQty;
    expect(preorderApplyProblems(common, now)).toEqual({});
    expect(preorderCapacityProblem('')).toBe('예약 물량을 입력해주세요.');
    expect(preorderCapacityProblem('1.5')).toContain('정수');
    expect(preorderCapacityProblem(' 20 ')).toBeNull();
  });
});

/* 11/19 "예약상품도 그냥 재고수량 미리 입력할 수 있게" — 예약 물량 기본값은 옵션 재고수량이고, 다르면 경고만 한다. */
describe('예약 물량 = 재고수량', () => {
  it('재고수량이 1 이상이면 그 수를, 0·미입력이면 빈 값을 기본 물량으로 쓴다', () => {
    expect(preorderCapacityFromStock(500)).toBe('500');
    for (const stock of [0, -1, Number.NaN, 1.5, null, undefined]) expect(preorderCapacityFromStock(stock)).toBe('');
  });
  it('물량이 재고수량과 같으면 안내가 없고, 다르면 입고 때 맞추라고 안내한다(막지 않는다)', () => {
    expect(preorderCapacityStockNote('500', 500)).toBeNull();
    expect(preorderCapacityStockNote('', 500)).toBeNull();
    expect(preorderCapacityStockNote('300', 500)).toContain('재고수량 500개와 다릅니다');
    /* 재고 0에서 입고 때 더하는 기존 흐름. */
    expect(preorderCapacityStockNote('300', 0)).toContain('재고 조정으로 들어온 수량을 더한 뒤');
    expect(preorderCapacityStockNote('300', Number.NaN)).toContain('재고수량이 0입니다');
  });
});
