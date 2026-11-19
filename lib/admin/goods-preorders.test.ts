import { describe, expect, it } from 'vitest';
import {
  parseAdminPreorderReservations, parseGoodsPreorderInput, parseRandomPreorderRequest, pendingPreorderReservationsByVariant, preorderApplyProblemLabels, preorderApplyProblems,
  preorderCapacityProblem, preorderDraftOnlyVariantIds, preorderMutationError, preparePreorderAllocation,
} from './goods-preorders';
describe('preorder operation inputs', () => {
  it('retains unset drafts and requires supply evidence and all promised dates to activate', () => {
    expect(parseGoodsPreorderInput({ state: 'draft', capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' }))
      .toEqual({ state: 'draft', capacityQty: null, startsAt: null, endsAt: null, expectedShipDate: null, approvalReference: null });
    expect(parseGoodsPreorderInput({ state: 'active', capacityQty: 50, startsAt: '2026-09-10T09:00', endsAt: '2026-09-15T18:00', expectedShipDate: '2026-10-01', approvalReference: '' })).toBeNull();
    expect(parseGoodsPreorderInput({ state: 'draft', capacityQty: '0' })).toBeNull();
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
  const draft = '00000000-0000-4000-8000-0000000000d1';
  const values = { startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20', approvalReference: '홍실 2차 승인' };
  it('공통 일정은 한 번, 승인 물량은 옵션별로 읽는다(초안은 물량을 비워 둘 수 있다)', () => {
    expect(parseRandomPreorderRequest('draft', values, [
      { variantId: a, policyId: draft, expectedRevision: 1, capacityQty: '30' },
      { variantId: b, policyId: null, expectedRevision: null, capacityQty: '' },
    ])).toEqual({
      state: 'draft',
      values: { startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20', approvalReference: '홍실 2차 승인' },
      options: [
        { variantId: a, policyId: draft, expectedRevision: 1, capacityQty: 30 },
        { variantId: b, policyId: null, expectedRevision: null, capacityQty: null },
      ],
    });
  });
  it('활성화는 모든 옵션 물량과 공통 일정·근거가 있어야 한다', () => {
    const options = [{ variantId: a, policyId: null, expectedRevision: null, capacityQty: 30 }, { variantId: b, policyId: null, expectedRevision: null, capacityQty: 20 }];
    expect(parseRandomPreorderRequest('active', values, options)?.options.map((option) => option.capacityQty)).toEqual([30, 20]);
    expect(parseRandomPreorderRequest('active', values, [options[0], { ...options[1], capacityQty: '' }])).toBeNull();
    expect(parseRandomPreorderRequest('active', { ...values, approvalReference: '' }, options)).toBeNull();
    expect(parseRandomPreorderRequest('active', { ...values, expectedShipDate: '2099-11-01' }, options)).toBeNull();
  });
  it('중지·일반 재고 전환은 옵션마다 선택된 정책과 revision만 보낸다', () => {
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: draft, expectedRevision: 2 }]))
      .toEqual({ state: 'stopped', values: null, options: [{ variantId: a, policyId: draft, expectedRevision: 2 }] });
    expect(parseRandomPreorderRequest('stock', null, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', values, [{ variantId: a, policyId: draft, expectedRevision: 2 }])).toBeNull();
    expect(parseRandomPreorderRequest('stopped', null, [{ variantId: a, policyId: draft, expectedRevision: 2, capacityQty: 1 }])).toBeNull();
  });
  it('중복 옵션·짝이 맞지 않는 정책·잘못된 상태는 거절한다', () => {
    expect(parseRandomPreorderRequest('draft', values, [{ variantId: a, policyId: null, expectedRevision: null }, { variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('draft', values, [{ variantId: a, policyId: draft, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('open', values, [{ variantId: a, policyId: null, expectedRevision: null }])).toBeNull();
    expect(parseRandomPreorderRequest('draft', values, [])).toBeNull();
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

/* 2026-11-19 사고: 기본값 '초안'으로 저장한 예약 6건이 판매에 적용되지 않았다. 적용은 칸별 이유를 보이고 막고, 임시저장만 남은 옵션을 찾는다. */
describe('예약판매 적용 전 칸별 확인', () => {
  const now = Date.parse('2026-11-19T05:00:00.000Z'); // 2026-11-19 14:00 KST
  const filled = { capacityQty: '300', startsAt: '2026-11-20T10:00', endsAt: '2026-12-01T23:59', expectedShipDate: '2026-12-10', approvalReference: '협조전-20261119-0001' };
  it('빈 칸은 칸마다 이유를 돌려주고, 이름은 화면 순서로 잇는다', () => {
    const problems = preorderApplyProblems({ capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '  ' }, now);
    expect(Object.keys(problems)).toEqual(['capacityQty', 'startsAt', 'endsAt', 'expectedShipDate', 'approvalReference']);
    expect(problems.capacityQty).toBe('승인 예약 물량을 입력해주세요.');
    expect(preorderApplyProblemLabels(problems)).toBe('승인 예약 물량·접수 시작·접수 종료·발송 예정일·승인 근거');
    /* 사고 그대로: 물량·접수 종료·승인 근거만 비었다. */
    expect(preorderApplyProblemLabels(preorderApplyProblems({ ...filled, capacityQty: '', endsAt: '', approvalReference: '' }, now))).toBe('승인 예약 물량·접수 종료·승인 근거');
  });
  it('모두 맞으면 빈 객체이고, DB와 같은 순서·시각 규칙을 미리 막는다', () => {
    expect(preorderApplyProblems(filled, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, capacityQty: '0' }, now).capacityQty).toContain('1 이상의 정수');
    expect(preorderApplyProblems({ ...filled, endsAt: '2026-11-20T09:00' }, now).endsAt).toContain('접수 시작보다 뒤');
    expect(preorderApplyProblems({ ...filled, startsAt: '2026-11-01T10:00', endsAt: '2026-11-19T13:59' }, now).endsAt).toContain('지금보다 뒤');
    /* 발송 예정일은 접수 종료일(KST) 이상이다 — 12/1 23:59 KST 종료면 12/1은 되고 11/30은 안 된다. */
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-12-01' }, now)).toEqual({});
    expect(preorderApplyProblems({ ...filled, expectedShipDate: '2026-11-30' }, now).expectedShipDate).toContain('접수 종료일과 같거나 뒤');
    expect(preorderApplyProblems({ ...filled, approvalReference: 'x'.repeat(2001) }, now).approvalReference).toContain('2,000자');
  });
  it('랜덤 판매의 공통 칸 확인은 물량을 빼고, 옵션별 물량은 따로 본다', () => {
    const { capacityQty, ...common } = filled; void capacityQty;
    expect(preorderApplyProblems(common, now)).toEqual({});
    expect(preorderCapacityProblem('')).toBe('승인 예약 물량을 입력해주세요.');
    expect(preorderCapacityProblem('1.5')).toContain('정수');
    expect(preorderCapacityProblem(' 20 ')).toBeNull();
  });
  it('임시저장만 있고 적용 중인 예약이 없는 옵션만 찾는다(사용 옵션 범위)', () => {
    const policies = [
      { variantId: 'red', state: 'draft' as const }, { variantId: 'red', state: 'draft' as const },
      { variantId: 'blue', state: 'draft' as const }, { variantId: 'blue', state: 'active' as const },
      { variantId: 'green', state: 'stopped' as const }, { variantId: 'green', state: 'draft' as const },
      { variantId: 'gone', state: 'draft' as const },
    ];
    expect(preorderDraftOnlyVariantIds(policies)).toEqual(['red', 'green', 'gone']);
    expect(preorderDraftOnlyVariantIds(policies, ['green', 'red', 'blue'])).toEqual(['green', 'red']);
    expect(preorderDraftOnlyVariantIds([{ variantId: 'red', state: 'active' }])).toEqual([]);
  });
});
