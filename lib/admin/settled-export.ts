import { normalizeAdminSettledFilters } from './settled';

export interface SettledExportFilters { from: string | null; to: string | null; query: string }
export interface SettledExportReceipt { id: string; capturedAt: string; orderCount: number }
export interface SettledExportItem {
  id: string; goodId: string; variantId: string | null; goodName: string | null; variantName: string | null;
  qty: number; unitPrice: number; regularUnitPrice: number | null; shipmentId: string | null;
  erpCode: string | null; erpName: string | null; barcode: string | null; erpCapturedAt: string | null;
}
export interface SettledExportOrder {
  id: string; createdAt: string; doneAt: string | null; total: number; shippingFee: number; couponDiscount: number; storeCredits: number;
  coupon: { code: string; discountAmount: number; eligibleSubtotal: number | null; terms: { goodsScope: 'all' | 'selected_goods'; targetGoodIds: string[] } | null } | null;
  payments: { id: string; amount: number; status: string; provider: string; approvedAt: string | null; timeSource: 'bank_confirmation' | 'provider_approval' | null }[];
  shipments: { id: string; trackingNumber: string | null; shippingFee: number; status: string }[];
  items: SettledExportItem[];
}
export interface SettledExportSnapshot {
  schemaVersion: 1; receiptId: string; capturedAt: string; filters: SettledExportFilters; orders: SettledExportOrder[];
}
export interface SettledExportLine {
  doneAt: string | null; orderId: string; trackingNumber: string | null; erpName: string | null; qty: number;
  salesAmount: number | null; shippingFee: number | null; paidAt: string | null;
  regularAmount: number | null; productDiscount: number | null; beforeCouponAmount: number; couponAmount: number | null; creditAmount: number | null;
  erpCode: string | null; barcode: string | null; goodName: string | null; variantName: string | null;
  shipmentId: string | null; itemId: string; paymentTimeSource: string; issues: string[];
}
export interface SettledExportOrderSummary {
  id: string; doneAt: string | null; paidAt: string | null; itemCount: number; qty: number;
  beforeCouponAmount: number; couponDiscount: number; storeCredits: number; shippingFee: number; total: number;
  detailSales: number | null; detailShipping: number | null; detailTotal: number | null; paymentAmount: number | null;
  detailDifference: number | null; ledgerDifference: number | null; paymentStatus: string; issues: string[];
}
export interface SettledExportModel { snapshot: SettledExportSnapshot; lines: SettledExportLine[]; orders: SettledExportOrderSummary[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSettledExportId(value: string) { return UUID.test(value); }
export function parseSettledExportFilters(value: Record<string, unknown>): SettledExportFilters | null {
  const inputs: Record<string, string> = {};
  for (const key of ['from', 'to', 'query']) {
    const field = value[key];
    if (field !== undefined && field !== null && typeof field !== 'string') return null;
    inputs[key] = typeof field === 'string' ? field : '';
  }
  const filters = normalizeAdminSettledFilters(inputs);
  if ((inputs.from && filters.from !== inputs.from) || (inputs.to && filters.to !== inputs.to)
    || inputs.query.trim() !== filters.query) return null;
  return { from: filters.from, to: filters.to, query: filters.query };
}
export function settledExportErrorMessage(message?: string | null) {
  if (message?.includes('settled_export_empty')) return '현재 조건에 해당하는 거래확정 주문이 없습니다.';
  if (message?.includes('settled_export_limit')) return '한 파일은 주문 1,000건·품목 10,000행까지 담습니다. 조회 기간을 줄여주세요.';
  if (message?.includes('settled_export_invalid_filters')) return '날짜와 검색어를 확인해주세요.';
  if (message?.includes('settled_export_request_conflict')) return '조회 조건이 바뀌었습니다. 목록을 새로 열고 파일을 만들어주세요.';
  if (message?.includes('settled_export_not_found')) return '직접 생성한 엑셀 기록을 찾을 수 없습니다. 목록에서 다시 만들어주세요.';
  return '거래확정 엑셀을 만들지 못했습니다. 다시 시도해주세요.';
}
function invalid(): never { throw new Error('거래확정 기록의 형식 또는 금액을 확인해주세요.'); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function text(value: unknown): string { if (typeof value !== 'string' || value.length > 32767) invalid(); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function money(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value; }
function date(value: unknown): string { const result = text(value); if (!Number.isFinite(Date.parse(result))) invalid(); return result; }
function nullableDate(value: unknown) { return value === null ? null : date(value); }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function unique<T extends { id: string }>(rows: T[]): T[] { if (new Set(rows.map(row => row.id)).size !== rows.length) invalid(); return rows; }

/** Reject corrupt numeric/identity data before a worksheet can hide it in a SUM. */
export function parseSettledExportSnapshot(value: unknown): SettledExportSnapshot {
  const raw = record(value);
  const filters = parseSettledExportFilters(record(raw.filters));
  if (raw.schemaVersion !== 1 || !filters) invalid();
  const orders = unique(array(raw.orders).map(value => {
    const row = record(value);
    let coupon: SettledExportOrder['coupon'] = null;
    if (row.coupon !== null) {
      const source = record(row.coupon); let terms: NonNullable<SettledExportOrder['coupon']>['terms'] = null;
      if (source.terms !== null) {
        const saved = record(source.terms);
        if (saved.goodsScope !== 'all' && saved.goodsScope !== 'selected_goods') invalid();
        terms = { goodsScope: saved.goodsScope, targetGoodIds: array(saved.targetGoodIds).map(text) };
      }
      coupon = { code: text(source.code), discountAmount: money(source.discountAmount), eligibleSubtotal: source.eligibleSubtotal === null ? null : money(source.eligibleSubtotal), terms };
    }
    const items = unique(array(row.items).map(value => {
      const item = record(value); const qty = money(item.qty); if (!qty) invalid();
      return {
        id: text(item.id), goodId: text(item.goodId), variantId: nullableText(item.variantId), goodName: nullableText(item.goodName), variantName: nullableText(item.variantName), qty,
        unitPrice: money(item.unitPrice), regularUnitPrice: item.regularUnitPrice === null ? null : money(item.regularUnitPrice), shipmentId: nullableText(item.shipmentId),
        erpCode: nullableText(item.erpCode), erpName: nullableText(item.erpName), barcode: nullableText(item.barcode), erpCapturedAt: nullableDate(item.erpCapturedAt),
      };
    }));
    const shipments = unique(array(row.shipments).map(value => { const source = record(value); return { id: text(source.id), trackingNumber: nullableText(source.trackingNumber), shippingFee: money(source.shippingFee), status: text(source.status) }; }));
    const payments = unique(array(row.payments).map(value => {
      const payment = record(value);
      if (payment.timeSource !== null && payment.timeSource !== 'bank_confirmation' && payment.timeSource !== 'provider_approval') invalid();
      return { id: text(payment.id), amount: money(payment.amount), status: text(payment.status), provider: text(payment.provider), approvedAt: nullableDate(payment.approvedAt), timeSource: payment.timeSource as 'bank_confirmation' | 'provider_approval' | null };
    }));
    return { id: text(row.id), createdAt: date(row.createdAt), doneAt: nullableDate(row.doneAt), total: money(row.total), shippingFee: money(row.shippingFee), couponDiscount: money(row.couponDiscount), storeCredits: money(row.storeCredits), coupon, items, shipments, payments };
  }));
  if (!orders.length || orders.length > 1000 || orders.reduce((count, order) => count + order.items.length, 0) > 10000) invalid();
  return { schemaVersion: 1, receiptId: text(raw.receiptId), capturedAt: date(raw.capturedAt), filters, orders };
}
function safeNumber(value: bigint): number { const number = Number(value); if (!Number.isSafeInteger(number)) invalid(); return number; }
function sum(values: number[]): number { return safeNumber(values.reduce((total, value) => total + BigInt(value), BigInt(0))); }
function sumKnown(values: (number | null)[]): number | null { return values.some(value => value === null) ? null : sum(values as number[]); }
function multiply(left: number, right: number) { return safeNumber(BigInt(left) * BigInt(right)); }

/** Largest remainder allocation. UUID order is the deterministic tie breaker. */
export function allocateSettledAmount(amount: number, weights: { id: string; amount: number }[]): number[] | null {
  const total = weights.reduce((value, weight) => value + BigInt(weight.amount), BigInt(0));
  if (amount === 0) return weights.map(() => 0);
  if (total < BigInt(amount) || total <= BigInt(0)) return null;
  const shares = weights.map((weight, index) => ({ index, id: weight.id, base: BigInt(amount) * BigInt(weight.amount) / total, remainder: BigInt(amount) * BigInt(weight.amount) % total }));
  let remaining = BigInt(amount) - shares.reduce((value, share) => value + share.base, BigInt(0));
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id, 'en') : a.remainder > b.remainder ? -1 : 1);
  for (const share of ranked) { if (!remaining) break; share.base += BigInt(1); remaining -= BigInt(1); }
  return shares.map(share => safeNumber(share.base));
}

export function buildSettledExportModel(snapshot: SettledExportSnapshot): SettledExportModel {
  const lines: SettledExportLine[] = []; const summaries: SettledExportOrderSummary[] = [];
  for (const order of snapshot.orders) {
    const issues: string[] = []; const items = [...order.items].sort((a, b) => (a.shipmentId ?? '~').localeCompare(b.shipmentId ?? '~', 'en') || a.id.localeCompare(b.id, 'en'));
    const before = items.map(item => multiply(item.qty, item.unitPrice));
    if (!items.length) issues.push('주문 품목 미기록');
    if (!order.doneAt) issues.push('거래확정 시각 미기록');
    const payment = order.payments.length === 1 ? order.payments[0] : null;
    const paidAt = payment?.approvedAt ?? null;
    if (!payment) issues.push(order.payments.length ? '결제 원장 중복: 금액·시각 확인 필요' : '결제 원장 미기록');
    if (!paidAt) issues.push('결제 승인·입금확인 시각 미기록');
    if (payment && payment.status !== 'paid') issues.push(`결제 상태 확인 필요: ${payment.status}`);
    let coupon: number[] | null = items.map(() => 0);
    if (order.couponDiscount) {
      const source = order.coupon;
      if (!source?.terms || source.eligibleSubtotal === null || source.discountAmount !== order.couponDiscount) {
        coupon = null; issues.push('쿠폰 대상·금액의 주문 당시 기록 미기록 또는 불일치');
      } else {
        const weights = items.map((item, index) => ({ id: item.id, amount: source.terms!.goodsScope === 'all' || source.terms!.targetGoodIds.includes(item.goodId) ? before[index] : 0 }));
        coupon = sum(weights.map(weight => weight.amount)) === source.eligibleSubtotal ? allocateSettledAmount(order.couponDiscount, weights) : null;
        if (!coupon) issues.push('쿠폰 대상 품목 합계 불일치');
      }
    }
    const afterCoupon = coupon ? before.map((amount, index) => amount - coupon[index]) : null;
    const credits = afterCoupon ? allocateSettledAmount(order.storeCredits, items.map((item, index) => ({ id: item.id, amount: afterCoupon[index] }))) : null;
    if (afterCoupon && !credits) issues.push('사용 적립금과 상품 금액 불일치');
    const shipmentMap = new Map(order.shipments.map(shipment => [shipment.id, shipment]));
    const assigned = new Set<string>();
    const orderLines = items.map((item, index): SettledExportLine => {
      const rowIssues = [...issues]; const shipment = item.shipmentId ? shipmentMap.get(item.shipmentId) : undefined;
      if (!shipment) rowIssues.push('배송 건 배정 미기록');
      if (shipment && !shipment.trackingNumber) rowIssues.push('운송장 미기록 또는 운송장 없는 수령 방식');
      if (shipment && shipment.status !== 'delivered') rowIssues.push(`배송 상태 확인 필요: ${shipment.status}`);
      if (!item.erpCapturedAt) rowIssues.push('주문 당시 ERP 기록 미기록');
      else if (!item.erpName) rowIssues.push('주문 당시 ERP 품명 미설정');
      const regularAmount = item.regularUnitPrice === null ? null : multiply(item.qty, item.regularUnitPrice);
      if (regularAmount === null) rowIssues.push('주문 당시 할인 전 정가 미기록');
      const productDiscount = regularAmount === null || regularAmount < before[index] ? null : regularAmount - before[index];
      if (regularAmount !== null && productDiscount === null) rowIssues.push('정가·판매가 기록 불일치');
      const shippingFee = shipment ? assigned.has(shipment.id) ? 0 : shipment.shippingFee : null;
      if (shipment) assigned.add(shipment.id);
      return {
        doneAt: order.doneAt, orderId: order.id, trackingNumber: shipment?.trackingNumber ?? null, erpName: item.erpName, qty: item.qty,
        salesAmount: afterCoupon && credits ? afterCoupon[index] - credits[index] : null, shippingFee, paidAt,
        regularAmount, productDiscount, beforeCouponAmount: before[index], couponAmount: coupon?.[index] ?? null, creditAmount: credits?.[index] ?? null,
        erpCode: item.erpCode, barcode: item.barcode, goodName: item.goodName, variantName: item.variantName,
        shipmentId: item.shipmentId, itemId: item.id, paymentTimeSource: !paidAt ? '미기록' : payment?.timeSource === 'bank_confirmation' ? '입금확인 기록' : '결제사 승인 기록', issues: rowIssues,
      };
    });
    if (order.shipments.some(shipment => !assigned.has(shipment.id))) issues.push('품목이 없는 배송 건: 배송비 배분 확인 필요');
    const detailSales = items.length ? sumKnown(orderLines.map(line => line.salesAmount)) : null;
    const detailShipping = items.length ? sumKnown(orderLines.map(line => line.shippingFee)) : null;
    const detailTotal = detailSales === null || detailShipping === null ? null : sum([detailSales, detailShipping]);
    const paymentAmount = payment?.amount ?? null;
    const detailDifference = detailTotal === null ? null : detailTotal - order.total;
    const ledgerDifference = paymentAmount === null ? null : paymentAmount - order.total;
    if (detailDifference) issues.push('품목·배송비 합계와 주문 금액 불일치');
    if (ledgerDifference) issues.push('결제 원장과 주문 금액 불일치');
    if (detailTotal === null) issues.push('품목 금액 배분 미완료: 주문 원장 금액 참조');
    const allIssues = [...new Set([...issues, ...orderLines.flatMap(line => line.issues)])];
    for (const line of orderLines) line.issues = [...new Set([...line.issues, ...issues])];
    lines.push(...orderLines);
    summaries.push({ id: order.id, doneAt: order.doneAt, paidAt, itemCount: items.length, qty: sum(items.map(item => item.qty)), beforeCouponAmount: sum(before), couponDiscount: order.couponDiscount, storeCredits: order.storeCredits, shippingFee: order.shippingFee, total: order.total, detailSales, detailShipping, detailTotal, paymentAmount, detailDifference, ledgerDifference, paymentStatus: payment?.status ?? '미확인', issues: allIssues });
  }
  return { snapshot, lines, orders: summaries };
}
