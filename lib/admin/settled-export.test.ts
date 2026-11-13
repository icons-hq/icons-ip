import { describe, expect, it } from 'vitest';
import { settledExportFixture, settledExportV2Fixture } from '@/test/fixtures/settled-export';
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
  it('카테고리·IP 쿠폰 주문도 파일 전체를 거절하지 않고 수집된 대상 판정으로 배분한다', () => {
    const source = settledExportFixture();
    source.orders[0].coupon!.terms = { goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: ['30000000-0000-4000-8000-000000000001'] };
    source.orders[0].items = source.orders[0].items.map((item, index) => ({ ...item, couponEligible: index < 2 }));
    const parsed = parseSettledExportSnapshot(source);
    expect(buildSettledExportModel(parsed).lines.map(row => row.couponAmount)).toEqual([501, 500, 0]);
    const ip = settledExportFixture();
    ip.orders[0].coupon!.terms = { goodsScope: 'selected_ips', targetGoodIds: [], targetIpIds: ['maple'] };
    ip.orders[0].items = ip.orders[0].items.map((item, index) => ({ ...item, ipId: index < 2 ? 'maple' : 'other' }));
    expect(buildSettledExportModel(parseSettledExportSnapshot(ip)).lines.map(row => row.couponAmount)).toEqual([501, 500, 0]);
    // 이전 수집본(판정 없음)의 카테고리 쿠폰은 추정하지 않고 주문 원장을 남긴다.
    const old = settledExportFixture();
    old.orders[0].coupon!.terms = { goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: ['30000000-0000-4000-8000-000000000001'] };
    const result = buildSettledExportModel(parseSettledExportSnapshot(old));
    expect(result.lines.every(row => row.couponAmount === null)).toBe(true);
    expect(result.orders[0].issues.join(' ')).toContain('쿠폰 대상·금액');
    const unknown = settledExportFixture();
    (unknown.orders[0].coupon!.terms as unknown as { goodsScope: string }).goodsScope = 'selected_brands';
    expect(() => parseSettledExportSnapshot(unknown)).toThrow();
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
  it('검색 대상을 영수증에 보존하고 잘못된 대상을 전체 검색으로 넓히지 않는다', () => {
    expect(parseSettledExportFilters({ field: 'recipient', query: 'GAP1530' }))
      .toEqual({ from: null, to: null, field: 'recipient', query: 'GAP1530' });
    expect(parseSettledExportFilters({ field: 'all', query: 'GAP1530' }))
      .toEqual({ from: null, to: null, query: 'GAP1530' });
    for (const field of ['not_supported', ' recipient ', ['recipient', 'all'], 1]) {
      expect(parseSettledExportFilters({ field, query: 'GAP1530' })).toBeNull();
    }
    const source = settledExportFixture(); source.filters.field = 'tracking';
    expect(parseSettledExportSnapshot(source).filters.field).toBe('tracking');
  });
});


describe('거래확정 v2 고정 원장', () => {
  it('상품코드 변경·쿠폰 대상 변경 후에도 저장된 배분만 사용한다', () => {
    const snapshot = settledExportV2Fixture();snapshot.orders[0].items[0].goodId = 'renamed-good';snapshot.orders[0].coupon = null;
    const model = buildSettledExportModel(parseSettledExportSnapshot(snapshot));
    expect(model.lines.map(line => line.volumeDiscount)).toEqual([1000, 1000, 0]);
    expect(model.lines.map(line => line.couponAmount)).toEqual([501, 500, 0]);
    expect(model.lines.map(line => line.creditAmount)).toEqual([300, 300, 400]);
    expect(model.lines.map(line => line.productDiscount)).toEqual([0, 1999, 1000]);
    expect(model.orders[0]).toMatchObject({ beforeCouponAmount: 27002, volumeDiscount: 2000, detailTotal: 30001, paymentAmount: 30001, shippingCollectTotal: 2250, detailShippingCollect: 2250, collectDifference: 0 });
  });
  it('누락·중복·원장 합계 불일치를 현재 정책으로 재계산하지 않는다', () => {
    for (const mutate of [
      (s: ReturnType<typeof settledExportV2Fixture>) => { s.orders[0].items[0].allocation = null; },
      (s: ReturnType<typeof settledExportV2Fixture>) => { s.orders[0].items[0].allocation!.volumeDiscount++; },
      (s: ReturnType<typeof settledExportV2Fixture>) => { s.orders[0].volumeDiscount!++; },
      (s: ReturnType<typeof settledExportV2Fixture>) => { s.orders[0].shipments[1].shippingCollectFee!++; },
      (s: ReturnType<typeof settledExportV2Fixture>) => { s.orders[0].shippingComponents!.push({ ...s.orders[0].shippingComponents![0] }); },
    ]) { const snapshot = settledExportV2Fixture();mutate(snapshot);expect(() => buildSettledExportModel(parseSettledExportSnapshot(snapshot))).toThrow(); }
  });
});

describe('거래확정 재고 부족 부분 취소(ADR-0032)', () => {
  type Raw = Record<string, unknown>;
  const cut = (item: unknown, fields: Raw) => Object.assign(item as Raw, fields);
  const cancelC = { canceledQty: 1, activeQty: 0, partialCanceledPaidAmount: 8600, partialCanceledGrossAmount: 9000,
    partialCanceledVolumeDiscount: 0, partialCanceledCouponDiscount: 0, partialCanceledStoreCreditDiscount: 400 };
  it('모두 취소된 품목은 줄을 만들지 않고, 닫힌 배송 건의 배송비·착불을 뺀 남은 금액으로 대조한다', () => {
    const snapshot = settledExportV2Fixture(); const order = snapshot.orders[0];
    cut(order.items[2], { ...cancelC, shipmentId: null });
    cut(order.shipments[1], { closedByPartialCancel: true });
    cut(order, { partialRefundedAmount: 10600 });
    const model = buildSettledExportModel(parseSettledExportSnapshot(snapshot));
    expect(model.lines.map(line => line.itemId)).toEqual([order.items[0].id, order.items[1].id]);
    expect(model.orders[0]).toMatchObject({ itemCount: 2, qty: 2, total: 19401, shippingFee: 3000, storeCredits: 600, detailTotal: 19401, paymentAmount: 19401,
      detailDifference: 0, ledgerDifference: 0, shippingCollectTotal: 0, collectDifference: 0 });
    expect(model.orders[0].issues.join(' / ')).toContain('재고 부족 부분 취소 반영');
    expect(model.orders[0].issues).not.toContain('품목이 없는 배송 건: 배송비 배분 확인 필요');
    expect(model.orders[0].issues).not.toContain('부분 취소 환불 합계와 취소분 배분 불일치');
  });

  it('부분 취소가 없으면 배송비 쿠폰 요약은 저장된 주문 값 그대로다(구성요소에 칸이 없어도 0으로 바뀌지 않는다)', () => {
    const snapshot = settledExportFixture(); const order = snapshot.orders[0];
    cut(order, { shippingCouponDiscount: 700 });
    const model = buildSettledExportModel(parseSettledExportSnapshot(snapshot));
    expect(model.orders[0].shippingCouponDiscount).toBe(700);
  });

  it('닫힌 배송 건이 있을 때만 배송비 쿠폰 요약에서 그 배송 건 구성요소 몫을 뺀다', () => {
    const snapshot = settledExportV2Fixture(); const order = snapshot.orders[0];
    const baseline = buildSettledExportModel(parseSettledExportSnapshot(snapshot)).orders[0].shippingCouponDiscount;
    expect(baseline).toBe(order.shippingCouponDiscount ?? 0);
    cut(order.items[2], { ...cancelC, shipmentId: null });
    cut(order.shipments[1], { closedByPartialCancel: true });
    cut(order, { partialRefundedAmount: 10600 });
    const closed = (order.shippingComponents ?? []).filter(c => c.shipmentId === order.shipments[1].id).reduce((total, c) => total + (c.shippingCouponDiscount ?? 0), 0);
    expect(buildSettledExportModel(parseSettledExportSnapshot(snapshot)).orders[0].shippingCouponDiscount).toBe(baseline - closed);
  });

  it('일부 취소된 품목은 남은 수량·남은 결제 몫이고, 끝수 차이는 숨기지 않는다', () => {
    const snapshot = settledExportV2Fixture(); const order = snapshot.orders[0];
    const [a, b] = order.items; a.qty = 2;
    a.allocation = { subtotal: 20002, volumeDiscount: 1000, netSubtotal: 19002, couponDiscount: 501, storeCreditDiscount: 300, paidGoodsTotal: 18201 };
    b.allocation = { subtotal: 10001, volumeDiscount: 1000, netSubtotal: 9001, couponDiscount: 500, storeCreditDiscount: 300, paidGoodsTotal: 8201 };
    order.total = 40002; order.payments[0].amount = 40002;
    cut(a, { canceledQty: 1, activeQty: 1, partialCanceledPaidAmount: 9100, partialCanceledGrossAmount: 9501,
      partialCanceledVolumeDiscount: 500, partialCanceledCouponDiscount: 250, partialCanceledStoreCreditDiscount: 150 });
    cut(order, { partialRefundedAmount: 9100 });
    const model = buildSettledExportModel(parseSettledExportSnapshot(snapshot));
    expect(model.lines[0]).toMatchObject({ qty: 1, salesAmount: 9101, beforeCouponAmount: 9501, couponAmount: 251, creditAmount: 150, volumeDiscount: 500, regularAmount: 10001 });
    expect(model.lines[0].issues.join(' / ')).toContain('부분 취소 1개 반영(주문 수량 2개');
    expect(model.lines[0].issues.join(' / ')).toContain('끝수 차이 -1원');
    expect(model.orders[0]).toMatchObject({ qty: 3, total: 30902, detailTotal: 30902, paymentAmount: 30902, detailDifference: 0, ledgerDifference: 0, couponDiscount: 751 });
  });

  // 버전 1 주문(ADR-0032 보완): 첫 부분 취소 때 DB가 공통 배분 규칙으로 얼린 원장이 품목 배분(allocation)으로 실린다.
  function legacyV1Snapshot() {
    const snapshot = settledExportFixture(); snapshot.schemaVersion = 2; const order = snapshot.orders[0];
    order.calculationVersion = 1; order.volumeDiscount = 0; order.shippingCollectTotal = 0; order.shippingComponents = [];
    order.items.forEach(item => { item.allocation = null; });
    order.shipments.forEach(shipment => { shipment.shippingCollectFee = 0; shipment.collectState = null; });
    return snapshot;
  }
  function frozen(snapshot: ReturnType<typeof legacyV1Snapshot>) {
    const baseline = buildSettledExportModel(parseSettledExportSnapshot(snapshot));
    const copy = structuredClone(snapshot);
    copy.orders[0].items.forEach(item => {
      const line = baseline.lines.find(entry => entry.itemId === item.id)!;
      const subtotal = item.unitPrice * item.qty;
      item.allocation = { subtotal, volumeDiscount: 0, netSubtotal: subtotal, couponDiscount: line.couponAmount!, storeCreditDiscount: line.creditAmount!,
        paidGoodsTotal: line.salesAmount! };
    });
    return { baseline, copy };
  }

  it('버전 1 주문도 얼린 배분 원장이 있으면 그 값을 쓰고, 공통 배분으로 나눈 값과 한 칸도 다르지 않다', () => {
    const { baseline, copy } = frozen(legacyV1Snapshot());
    expect(baseline.orders[0].issues).toEqual(expect.not.arrayContaining(['쿠폰 대상·금액의 주문 당시 기록 미기록 또는 불일치']));
    const model = buildSettledExportModel(parseSettledExportSnapshot(copy));
    expect(model.lines).toEqual(baseline.lines);
    expect(model.orders).toEqual(baseline.orders);
    // 원장 합계가 주문 원장과 맞지 않으면 다시 나누지 않고 거절한다.
    copy.orders[0].items[0].allocation!.couponDiscount += 1; copy.orders[0].items[0].allocation!.paidGoodsTotal -= 1;
    expect(() => buildSettledExportModel(parseSettledExportSnapshot(copy))).toThrow();
  });

  it('부분 취소가 있는 버전 1 주문은 얼린 원장 − 취소분으로 남은 몫을 쓰고 결제 원장과 맞춘다', () => {
    const { baseline, copy } = frozen(legacyV1Snapshot()); const order = copy.orders[0]; const c = order.items[2];
    const line = baseline.lines.find(entry => entry.itemId === c.id)!;
    cut(c, { canceledQty: 1, activeQty: 0, partialCanceledPaidAmount: line.salesAmount, partialCanceledGrossAmount: 9000, partialCanceledVolumeDiscount: 0,
      partialCanceledCouponDiscount: line.couponAmount, partialCanceledStoreCreditDiscount: line.creditAmount, shipmentId: null });
    cut(order.shipments[1], { closedByPartialCancel: true });
    cut(order, { partialRefundedAmount: line.salesAmount! + 2000 });
    const model = buildSettledExportModel(parseSettledExportSnapshot(copy));
    expect(model.lines.map(entry => entry.itemId)).toEqual([order.items[0].id, order.items[1].id]);
    expect(model.lines.map(entry => entry.salesAmount)).toEqual(baseline.lines.slice(0, 2).map(entry => entry.salesAmount));
    expect(model.orders[0]).toMatchObject({ itemCount: 2, total: 32001 - line.salesAmount! - 2000, detailDifference: 0, ledgerDifference: 0 });
    expect(model.orders[0].issues).not.toContain('부분 취소 환불 합계와 취소분 배분 불일치');
  });

  it('수량이 맞지 않거나 이전 계산 버전이거나 환불 합계가 빠진 부분 취소 기록은 거절한다', () => {
    const wrongQty = settledExportV2Fixture(); cut(wrongQty.orders[0].items[2], { ...cancelC, activeQty: 1 }); cut(wrongQty.orders[0], { partialRefundedAmount: 8600 });
    expect(() => parseSettledExportSnapshot(wrongQty)).toThrow();
    const missingTotal = settledExportV2Fixture(); cut(missingTotal.orders[0].items[2], cancelC);
    expect(() => parseSettledExportSnapshot(missingTotal)).toThrow();
    const legacy = settledExportFixture(); cut(legacy.orders[0].items[2], cancelC); cut(legacy.orders[0], { partialRefundedAmount: 8600 });
    expect(() => parseSettledExportSnapshot(legacy)).toThrow();
  });
});
