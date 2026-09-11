import { describe, expect, it } from 'vitest';
import { parseGoodsPreorderInput, preparePreorderAllocation } from './goods-preorders';
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
