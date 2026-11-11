import { describe, expect, it } from 'vitest';
import { parseGoodsPreorderInput, parseRandomPreorderRequest, preorderMutationError, preparePreorderAllocation } from './goods-preorders';
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
