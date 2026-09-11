import { describe, expect, it } from 'vitest';
import { settledExportFixture } from '@/test/fixtures/settled-export';
import { allocateSettledAmount, buildSettledExportModel, parseSettledExportFilters, parseSettledExportSnapshot } from './settled-export';

describe('거래확정 금액과 출처', () => {
  it('3품목·2배송·대상 쿠폰·적립금을 원 단위로 배분해 실제 결제 원장과 일치시킨다', () => {
    const result = buildSettledExportModel(settledExportFixture());
    expect(result.lines.map(row => row.couponAmount)).toEqual([501, 500, 0]);
    expect(result.lines.map(row => row.creditAmount)).toEqual([339, 339, 322]);
    expect(result.lines.map(row => row.salesAmount)).toEqual([9161, 9162, 8678]);
    expect(result.lines.map(row => row.shippingFee)).toEqual([3000, 0, 2000]);
    expect(result.orders[0]).toMatchObject({ detailTotal: 32001, paymentAmount: 32001, detailDifference: 0, ledgerDifference: 0, issues: [] });
  });
  it('입력 순서가 바뀌어도 남는 1원과 배송비를 같은 품목에 준다', () => {
    const first = settledExportFixture(); const reversed = structuredClone(first);
    reversed.orders[0].items.reverse(); reversed.orders[0].shipments.reverse();
    expect(buildSettledExportModel(reversed).lines).toEqual(buildSettledExportModel(first).lines);
  });
  it('큰 정수 곱셈에서도 배분 총액과 품목 상한을 보존한다', () => {
    for (const amount of [1, 99, 100001, 4_000_000_000_001]) {
      const weights = [{ id: 'a', amount: 7_000_000_000_001 }, { id: 'b', amount: 8_000_000_000_003 }, { id: 'c', amount: 0 }];
      const allocated = allocateSettledAmount(amount, weights)!;
      expect(allocated.reduce((sum, value) => sum + value, 0)).toBe(amount);
      expect(allocated[2]).toBe(0);
      allocated.forEach((value, index) => expect(value >= 0 && value <= weights[index].amount && Number.isSafeInteger(value)).toBe(true));
    }
  });
  it('ERP와 정가 미기록은 현재 값을 넣지 않으며 기록된 결제금액은 유지한다', () => {
    const source = settledExportFixture();
    source.orders[0].items[0] = { ...source.orders[0].items[0], erpCode: null, erpName: null, barcode: null, erpCapturedAt: null, regularUnitPrice: null };
    const result = buildSettledExportModel(source);
    expect(result.lines[0]).toMatchObject({ erpName: null, regularAmount: null, productDiscount: null, salesAmount: 9161 });
    expect(result.lines[0].issues).toContain('주문 당시 ERP 기록 미기록');
    expect(result.orders[0].detailDifference).toBe(0);
  });
  it('과거 쿠폰 대상이 없으면 판매금액을 추정하지 않고 주문 원장을 남긴다', () => {
    const source = settledExportFixture(); source.orders[0].coupon!.terms = null;
    const result = buildSettledExportModel(source);
    expect(result.lines.every(row => row.couponAmount === null && row.creditAmount === null && row.salesAmount === null)).toBe(true);
    expect(result.orders[0]).toMatchObject({ total: 32001, detailTotal: null, detailDifference: null, ledgerDifference: 0 });
    expect(result.orders[0].issues.join(' ')).toContain('쿠폰 대상·금액');
  });
  it('결제시각이 없으면 주문 생성일로 대체하지 않는다', () => {
    const source = settledExportFixture(); source.orders[0].payments[0].approvedAt = null; source.orders[0].payments[0].timeSource = null;
    const result = buildSettledExportModel(source);
    expect(result.lines[0].paidAt).toBeNull();
    expect(result.orders[0].issues).toContain('결제 승인·입금확인 시각 미기록');
  });
  it('미배정 품목·중복 결제·합계 차이를 정상 0원으로 숨기지 않는다', () => {
    const source = settledExportFixture(); source.orders[0].items[0].shipmentId = null;
    source.orders[0].payments.push({ ...source.orders[0].payments[0], id: 'second-payment' });
    const result = buildSettledExportModel(source);
    expect(result.orders[0]).toMatchObject({ detailTotal: null, paymentAmount: null, ledgerDifference: null });
    expect(result.orders[0].issues.join(' ')).toContain('결제 원장 중복');
    const mismatch = settledExportFixture(); mismatch.orders[0].payments[0].amount = 32000;
    expect(buildSettledExportModel(mismatch).orders[0].ledgerDifference).toBe(-1);
  });
  it('수량·금액·식별자 중복을 파싱 경계에서 거절한다', () => {
    const quantity = settledExportFixture(); quantity.orders[0].items[0].qty = 0;
    expect(() => parseSettledExportSnapshot(quantity)).toThrow();
    const overflow = settledExportFixture(); overflow.orders[0].total = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseSettledExportSnapshot(overflow)).toThrow();
    const duplicate = settledExportFixture(); duplicate.orders[0].items.push({ ...duplicate.orders[0].items[0] });
    expect(() => parseSettledExportSnapshot(duplicate)).toThrow();
  });
  it('다운로드 기간 오류를 전체 조회로 바꾸지 않는다', () => {
    expect(parseSettledExportFilters({ from: '2026-02-30' })).toBeNull();
    expect(parseSettledExportFilters({ from: '2026-09-10', to: '2026-09-01' })).toBeNull();
    expect(parseSettledExportFilters({ query: ['one', 'two'] })).toBeNull();
    expect(parseSettledExportFilters({ query: 'x'.repeat(101) })).toBeNull();
    expect(parseSettledExportFilters({ from: '2026-09-01', to: '2026-09-10', query: ' 0000 ' })).toEqual({ from: '2026-09-01', to: '2026-09-10', query: '0000' });
  });
});
