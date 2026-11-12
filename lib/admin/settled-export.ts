import { SHIPPING_COLLECT_STATES, SHIPPING_COLLECT_STATE_LABEL, type ShippingCollectState } from './shipping-collect-events';
import { isUuid } from '@/lib/uuid';
import { normalizeAdminSettledFilters } from './settled';
import { SALES_DATE_FIELDS, SALES_ORDER_SEARCH_FIELDS, type SalesDateField, type SalesOrderSearchField } from './sales-list';
import { allocateLegacyOrderDiscounts, allocateSettledAmount, parseLegacyCouponTerms, type LegacyCouponTerms } from './item-allocation';

export interface SettledExportFilters { from: string | null; to: string | null; query: string; dateField?: SalesDateField; field?: Exclude<SalesOrderSearchField, 'all'> }
export interface SettledExportReceipt { id: string; capturedAt: string; orderCount: number }
export interface SettledPriceAllocation { subtotal: number; volumeDiscount: number; netSubtotal: number; couponDiscount: number; storeCreditDiscount: number; paidGoodsTotal: number }
export interface SettledShippingComponent { shippingCouponDiscount?: number; installationFee?: number; id: string; shipmentId: string; paymentMode: 'prepaid' | 'collect'; baseFee: number; regionalFee: number; totalFee: number }
export interface SettledExportItem {
  allocation?: SettledPriceAllocation | null;
  /** 주문 당시 IP와 쿠폰 대상 판정(2026-10-27 이후 수집본). 이전 수집본은 없다. */
  ipId?: string | null; couponEligible?: boolean | null;
  id: string; goodId: string; variantId: string | null; goodName: string | null; variantName: string | null;
  qty: number; unitPrice: number; regularUnitPrice: number | null; shipmentId: string | null;
  erpCode: string | null; erpName: string | null; barcode: string | null; erpCapturedAt: string | null;
  /** 재고 부족 부분 취소(ADR-0032)로 취소된 수량과 그 배분. 부분 취소가 없는 품목·이전 수집본에는 없다. */
  partialCancel?: SettledPartialCancel;
}
export interface SettledPartialCancel {
  canceledQty: number; activeQty: number;
  /** 취소분의 복수구매 할인 뒤 금액·복수구매 할인·쿠폰·적립금·결제 몫(환불한 품목 금액). */
  netAmount: number; volumeDiscount: number; couponDiscount: number; storeCreditDiscount: number; paidAmount: number;
}
export interface SettledExportOrder {
  /** 적용된 재고 부족 부분 취소의 환불 합계(품목 결제 몫 + 닫힌 배송 건 배송비). 부분 취소가 없으면 없다. */
  partialRefundedAmount?: number;
  shippingCouponDiscount?: number; coupons?: { code: string; discountAmount: number; benefitKind: 'goods' | 'shipping'; applicationIndex: number }[];
  calculationVersion?: 1 | 2; volumeDiscount?: number; shippingCollectTotal?: number; shippingComponents?: SettledShippingComponent[];
  id: string; createdAt: string; doneAt: string | null; total: number; shippingFee: number; couponDiscount: number; storeCredits: number;
  coupon: { code: string; discountAmount: number; eligibleSubtotal: number | null; terms: LegacyCouponTerms | null } | null;
  payments: { id: string; amount: number; status: string; provider: string; approvedAt: string | null; timeSource: 'bank_confirmation' | 'provider_approval' | null }[];
  shipments: { id: string; trackingNumber: string | null; shippingFee: number; status: string; shippingCollectFee?: number; collectState?: ShippingCollectState | null; closedByPartialCancel?: true }[];
  items: SettledExportItem[];
}
export interface SettledExportSnapshot {
  schemaVersion: 1 | 2; receiptId: string; capturedAt: string; filters: SettledExportFilters; orders: SettledExportOrder[];
}
export interface SettledExportLine {
  installationFee: number | null; shippingCouponDiscount: number | null;
  volumeDiscount: number; shippingCollectFee: number | null; collectState: string; calculationVersion: 1 | 2;
  doneAt: string | null; orderId: string; trackingNumber: string | null; erpName: string | null; qty: number;
  salesAmount: number | null; shippingFee: number | null; paidAt: string | null;
  regularAmount: number | null; productDiscount: number | null; beforeCouponAmount: number; couponAmount: number | null; creditAmount: number | null;
  erpCode: string | null; barcode: string | null; goodName: string | null; variantName: string | null;
  shipmentId: string | null; itemId: string; paymentTimeSource: string; issues: string[];
}
export interface SettledExportOrderSummary {
  installationFee: number; shippingCouponDiscount: number;
  volumeDiscount: number; shippingCollectTotal: number; detailShippingCollect: number | null; collectDifference: number | null; calculationVersion: 1 | 2;
  id: string; doneAt: string | null; paidAt: string | null; itemCount: number; qty: number;
  beforeCouponAmount: number; couponDiscount: number; storeCredits: number; shippingFee: number; total: number;
  detailSales: number | null; detailShipping: number | null; detailTotal: number | null; paymentAmount: number | null;
  detailDifference: number | null; ledgerDifference: number | null; paymentStatus: string; issues: string[];
}
export interface SettledExportModel { snapshot: SettledExportSnapshot; lines: SettledExportLine[]; orders: SettledExportOrderSummary[] }

export function isSettledExportId(value: string) { return isUuid(value); }
export function parseSettledExportFilters(value: Record<string, unknown>): SettledExportFilters | null {
  const inputs: Record<string, string> = {};
  for (const key of ['from', 'to', 'query', 'dateField', 'field']) {
    const field = value[key];
    if (field !== undefined && field !== null && typeof field !== 'string') return null;
    inputs[key] = typeof field === 'string' ? field : '';
  }
  const filters = normalizeAdminSettledFilters(inputs);
  if (inputs.dateField && !SALES_DATE_FIELDS.some(option => option.value === inputs.dateField)) return null;
  if (inputs.field && !SALES_ORDER_SEARCH_FIELDS.some(option => option.value === inputs.field)) return null;
  if ((inputs.from && filters.from !== inputs.from) || (inputs.to && filters.to !== inputs.to)
    || inputs.query.trim() !== filters.query) return null;
  return { from: filters.from, to: filters.to, query: filters.query, ...(filters.dateField ? { dateField: filters.dateField } : {}),
    ...(filters.field ? { field: filters.field } : {}) };
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
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || !filters) invalid();
  const orders = unique(array(raw.orders).map(value => {
    const row = record(value);const v2 = raw.schemaVersion === 2;
    if (v2 && row.calculationVersion !== 1 && row.calculationVersion !== 2) invalid();
    const calculationVersion = v2 ? row.calculationVersion as 1 | 2 : 1;
    const shippingComponents = v2 ? unique(array(row.shippingComponents).map(value => {
      const component = record(value);if (!['prepaid', 'collect'].includes(String(component.paymentMode))) invalid();
      return { id: text(component.id), shipmentId: text(component.shipmentId), paymentMode: component.paymentMode as 'prepaid' | 'collect', ...(component.shippingCouponDiscount === undefined ? {} : { shippingCouponDiscount: money(component.shippingCouponDiscount) }), ...(component.installationFee === undefined ? {} : { installationFee: money(component.installationFee) }), baseFee: money(component.baseFee), regionalFee: money(component.regionalFee), totalFee: money(component.totalFee) };
    })) : [];
    let coupon: SettledExportOrder['coupon'] = null;
    if (row.coupon !== null) {
      const source = record(row.coupon); let terms: NonNullable<SettledExportOrder['coupon']>['terms'] = null;
      if (source.terms !== null) {
        // 상품·카테고리·IP 쿠폰 모두 받는다. 대상 품목 판정은 배분 공통 함수가 한다.
        const saved = record(source.terms); array(saved.targetGoodIds).map(text);
        terms = parseLegacyCouponTerms(saved) ?? invalid();
      }
      coupon = { code: text(source.code), discountAmount: money(source.discountAmount), eligibleSubtotal: source.eligibleSubtotal === null ? null : money(source.eligibleSubtotal), terms };
    }
    const items = unique(array(row.items).map(value => {
      const item = record(value); const qty = money(item.qty); if (!qty) invalid();
      let allocation: SettledPriceAllocation | null = null;
      if (v2 && item.allocation !== null) {
        const saved = record(item.allocation);
        allocation = { subtotal: money(saved.subtotal), volumeDiscount: money(saved.volumeDiscount), netSubtotal: money(saved.netSubtotal), couponDiscount: money(saved.couponDiscount), storeCreditDiscount: money(saved.storeCreditDiscount), paidGoodsTotal: money(saved.paidGoodsTotal) };
      }
      if (calculationVersion === 2 && allocation === null) invalid();
      let partialCancel: SettledPartialCancel | undefined;
      if (item.canceledQty !== undefined) {
        if (!v2) invalid();
        partialCancel = { canceledQty: money(item.canceledQty), activeQty: money(item.activeQty), netAmount: money(item.partialCanceledGrossAmount),
          volumeDiscount: money(item.partialCanceledVolumeDiscount), couponDiscount: money(item.partialCanceledCouponDiscount),
          storeCreditDiscount: money(item.partialCanceledStoreCreditDiscount), paidAmount: money(item.partialCanceledPaidAmount) };
        if (!partialCancel.canceledQty || partialCancel.canceledQty + partialCancel.activeQty !== qty) invalid();
      }
      return {
        ...(v2 ? { allocation } : {}),
        ...(partialCancel ? { partialCancel } : {}),
        ...(item.ipId === undefined ? {} : { ipId: nullableText(item.ipId) }),
        ...(item.couponEligible === undefined ? {} : { couponEligible: item.couponEligible === null ? null : typeof item.couponEligible === 'boolean' ? item.couponEligible : invalid() }),
        id: text(item.id), goodId: text(item.goodId), variantId: nullableText(item.variantId), goodName: nullableText(item.goodName), variantName: nullableText(item.variantName), qty,
        unitPrice: money(item.unitPrice), regularUnitPrice: item.regularUnitPrice === null ? null : money(item.regularUnitPrice), shipmentId: nullableText(item.shipmentId),
        erpCode: nullableText(item.erpCode), erpName: nullableText(item.erpName), barcode: nullableText(item.barcode), erpCapturedAt: nullableDate(item.erpCapturedAt),
      };
    }));
    const shipments = unique(array(row.shipments).map(value => { const source = record(value);
      if (v2 && source.collectState !== null && !SHIPPING_COLLECT_STATES.includes(source.collectState as ShippingCollectState)) invalid();
      if (source.closedByPartialCancel !== undefined && (source.closedByPartialCancel !== true || !v2)) invalid();
      return { id: text(source.id), trackingNumber: nullableText(source.trackingNumber), shippingFee: money(source.shippingFee), status: text(source.status),
        ...(v2 ? { shippingCollectFee: money(source.shippingCollectFee), collectState: source.collectState as ShippingCollectState | null } : {}),
        ...(source.closedByPartialCancel ? { closedByPartialCancel: true as const } : {}) }; }));
    const payments = unique(array(row.payments).map(value => {
      const payment = record(value);
      if (payment.timeSource !== null && payment.timeSource !== 'bank_confirmation' && payment.timeSource !== 'provider_approval') invalid();
      return { id: text(payment.id), amount: money(payment.amount), status: text(payment.status), provider: text(payment.provider), approvedAt: nullableDate(payment.approvedAt), timeSource: payment.timeSource as 'bank_confirmation' | 'provider_approval' | null };
    }));
    const coupons = row.coupons === undefined ? undefined : array(row.coupons).map((value, index) => {
      const c = record(value); if (!['goods', 'shipping'].includes(String(c.benefitKind)) || c.applicationIndex !== index + 1 || money(c.discountAmount) <= 0) invalid();
      return { code: text(c.code), discountAmount: money(c.discountAmount), benefitKind: c.benefitKind as 'goods' | 'shipping', applicationIndex: index + 1 };
    });
    if (coupons && (coupons.length > 6 || new Set(coupons.map(c => c.code)).size !== coupons.length || coupons.filter(c => c.benefitKind === 'shipping').length > 1)) invalid();
    const partialRefundedAmount = row.partialRefundedAmount === undefined ? undefined : money(row.partialRefundedAmount);
    if (partialRefundedAmount !== undefined && !v2) invalid();
    // 적용된 부분 취소가 있으면 취소된 품목이 반드시 있다. 닫힌 배송 건도 그 부분 취소의 결과다.
    if ((partialRefundedAmount !== undefined) !== items.some(item => item.partialCancel)
      || (partialRefundedAmount === undefined && shipments.some(shipment => shipment.closedByPartialCancel))) invalid();
    return { ...(partialRefundedAmount === undefined ? {} : { partialRefundedAmount }), ...(row.shippingCouponDiscount === undefined ? {} : { shippingCouponDiscount: money(row.shippingCouponDiscount) }), ...(coupons ? { coupons } : {}), ...(v2 ? { calculationVersion, volumeDiscount: money(row.volumeDiscount), shippingCollectTotal: money(row.shippingCollectTotal), shippingComponents } : {}), id: text(row.id), createdAt: date(row.createdAt), doneAt: nullableDate(row.doneAt), total: money(row.total), shippingFee: money(row.shippingFee), couponDiscount: money(row.couponDiscount), storeCredits: money(row.storeCredits), coupon, items, shipments, payments };
  }));
  if (!orders.length || orders.length > 1000 || orders.reduce((count, order) => count + order.items.length, 0) > 10000) invalid();
  return { schemaVersion: raw.schemaVersion as 1 | 2, receiptId: text(raw.receiptId), capturedAt: date(raw.capturedAt), filters, orders };
}
function safeNumber(value: bigint): number { const number = Number(value); if (!Number.isSafeInteger(number)) invalid(); return number; }
function sum(values: number[]): number { return safeNumber(values.reduce((total, value) => total + BigInt(value), BigInt(0))); }
function sumKnown(values: (number | null)[]): number | null { return values.some(value => value === null) ? null : sum(values as number[]); }
function multiply(left: number, right: number) { return safeNumber(BigInt(left) * BigInt(right)); }

/** 배분 규칙은 주문 상세·상품주문 화면·ICONS 표준 양식 엑셀과 같은 공통 함수다(`./item-allocation`). */
export { allocateSettledAmount };

export function buildSettledExportModel(snapshot: SettledExportSnapshot): SettledExportModel {
  const lines: SettledExportLine[] = []; const summaries: SettledExportOrderSummary[] = [];
  for (const order of snapshot.orders) {
    const issues: string[] = []; const items = [...order.items].sort((a, b) => (a.shipmentId ?? '~').localeCompare(b.shipmentId ?? '~', 'en') || a.id.localeCompare(b.id, 'en'));
    const calculationVersion = order.calculationVersion ?? 1;const isV2 = calculationVersion === 2;
    const gross = items.map(item => multiply(item.qty, item.unitPrice));
    const saved = items.map(item => item.allocation);
    if (isV2) {
      if (saved.some((a, index) => !a || a.subtotal !== gross[index] || a.netSubtotal !== a.subtotal - a.volumeDiscount || a.paidGoodsTotal !== a.netSubtotal - a.couponDiscount - a.storeCreditDiscount)
        || sum(saved.map(a => a!.volumeDiscount)) !== order.volumeDiscount || sum(saved.map(a => a!.couponDiscount)) !== order.couponDiscount
        || sum(saved.map(a => a!.storeCreditDiscount)) !== order.storeCredits || sum(saved.map(a => a!.paidGoodsTotal)) + order.shippingFee !== order.total) invalid();
      const components = order.shippingComponents ?? [];
      if (sum(components.map(c => c.shippingCouponDiscount ?? 0)) !== (order.shippingCouponDiscount ?? 0) || order.coupons && (sum(order.coupons.filter(c => c.benefitKind === 'goods').map(c => c.discountAmount)) !== order.couponDiscount || sum(order.coupons.filter(c => c.benefitKind === 'shipping').map(c => c.discountAmount)) !== (order.shippingCouponDiscount ?? 0))) invalid();
      if (!components.length || components.some(c => c.baseFee + c.regionalFee + (c.installationFee ?? 0) - (c.shippingCouponDiscount ?? 0) !== c.totalFee || (c.shippingCouponDiscount ?? 0) > c.baseFee + c.regionalFee || c.paymentMode === 'collect' && (c.shippingCouponDiscount ?? 0) !== 0 || !order.shipments.some(s => s.id === c.shipmentId))
        || sum(components.map(c => c.paymentMode === 'prepaid' ? c.totalFee : c.installationFee ?? 0)) !== order.shippingFee
        || sum(components.map(c => c.paymentMode === 'collect' ? c.totalFee - (c.installationFee ?? 0) : 0)) !== order.shippingCollectTotal
        || order.shipments.some(shipment => sum(components.filter(c => c.shipmentId === shipment.id).map(c => c.paymentMode === 'prepaid' ? c.totalFee : c.installationFee ?? 0)) !== shipment.shippingFee
          || sum(components.filter(c => c.shipmentId === shipment.id).map(c => c.paymentMode === 'collect' ? c.totalFee - (c.installationFee ?? 0) : 0)) !== shipment.shippingCollectFee
          || ((shipment.shippingCollectFee ?? 0) > 0) !== Boolean(shipment.collectState))) invalid();
    } else if ((order.volumeDiscount ?? 0) !== 0 || (order.shippingCollectTotal ?? 0) !== 0 || order.shippingComponents?.length) invalid();
    // 재고 부족 부분 취소(ADR-0032): 수량·금액 열은 남은 몫(원래 배분 − 취소분)이다. 취소분은 원장의 줄별 배분이라 합이 정확하다.
    const remaining = items.map((item, index) => {
      const cut = item.partialCancel;
      if (!cut) return null;
      const a = saved[index]!;
      const activeGross = multiply(cut.activeQty, item.unitPrice);
      if (cut.netAmount !== multiply(cut.canceledQty, item.unitPrice) - cut.volumeDiscount || cut.volumeDiscount > a.volumeDiscount
        || cut.couponDiscount > a.couponDiscount || cut.storeCreditDiscount > a.storeCreditDiscount || cut.paidAmount > a.paidGoodsTotal) invalid();
      return { qty: cut.activeQty, gross: activeGross, volume: a.volumeDiscount - cut.volumeDiscount, coupon: a.couponDiscount - cut.couponDiscount,
        credit: a.storeCreditDiscount - cut.storeCreditDiscount, paid: a.paidGoodsTotal - cut.paidAmount, cut };
    });
    const live = (index: number) => remaining[index]?.qty !== 0;
    const closedShipments = order.shipments.filter(shipment => shipment.closedByPartialCancel);
    const closedIds = new Set(closedShipments.map(shipment => shipment.id));
    const partialRefunded = order.partialRefundedAmount ?? 0;
    const qtyOf = (item: SettledExportItem, index: number) => remaining[index]?.qty ?? item.qty;
    const grossOf = (index: number) => remaining[index]?.gross ?? gross[index];
    const before = isV2 ? saved.map((a, index) => remaining[index] ? remaining[index]!.gross - remaining[index]!.volume : a!.netSubtotal) : gross;
    if (!items.length) issues.push('주문 품목 미기록');
    if (order.partialRefundedAmount !== undefined) {
      const cuts = remaining.flatMap(entry => entry ? [entry.cut] : []);
      issues.push(`재고 부족 부분 취소 반영: 수량·금액은 남은 몫(취소 ${sum(cuts.map(cut => cut.canceledQty)).toLocaleString('ko-KR')}개 · 환불 ${partialRefunded.toLocaleString('ko-KR')}원 제외)`);
      if (sum(cuts.map(cut => cut.paidAmount)) + sum(closedShipments.map(shipment => shipment.shippingFee)) !== partialRefunded) issues.push('부분 취소 환불 합계와 취소분 배분 불일치');
    }
    if (!order.doneAt) issues.push('거래확정 시각 미기록');
    const payment = order.payments.length === 1 ? order.payments[0] : null;
    const paidAt = payment?.approvedAt ?? null;
    if (!payment) issues.push(order.payments.length ? '결제 원장 중복: 금액·시각 확인 필요' : '결제 원장 미기록');
    if (!paidAt) issues.push('결제 승인·입금확인 시각 미기록');
    if (payment && payment.status !== 'paid') issues.push(`결제 상태 확인 필요: ${payment.status}`);
    const legacy = isV2 ? null : allocateLegacyOrderDiscounts({ couponDiscount: order.couponDiscount, storeCredits: order.storeCredits, coupon: order.coupon,
      items: items.map((item, index) => ({ id: item.id, goodId: item.goodId, ipId: item.ipId, couponEligible: item.couponEligible, amount: before[index] })) });
    if (legacy) issues.push(...legacy.issues);
    const coupon = isV2 ? saved.map((a, index) => remaining[index]?.coupon ?? a!.couponDiscount) : legacy!.coupon;
    const afterCoupon = coupon ? before.map((amount, index) => amount - coupon[index]) : null;
    const credits = isV2 ? saved.map((a, index) => remaining[index]?.credit ?? a!.storeCreditDiscount) : legacy!.credits;
    const shipmentMap = new Map(order.shipments.map(shipment => [shipment.id, shipment]));
    const assigned = new Set<string>();
    const settledLine = (item: SettledExportItem, index: number): SettledExportLine => {
      const rowIssues = [...issues]; const shipment = item.shipmentId ? shipmentMap.get(item.shipmentId) : undefined;
      const rest = remaining[index];
      if (rest) rowIssues.push(`부분 취소 ${rest.cut.canceledQty.toLocaleString('ko-KR')}개 반영(주문 수량 ${item.qty.toLocaleString('ko-KR')}개 · 취소분 결제 몫 ${rest.cut.paidAmount.toLocaleString('ko-KR')}원 환불)`);
      if (!shipment) rowIssues.push('배송 건 배정 미기록');
      if (shipment && !shipment.trackingNumber) rowIssues.push('운송장 미기록 또는 운송장 없는 수령 방식');
      if (shipment && shipment.status !== 'delivered') rowIssues.push(`배송 상태 확인 필요: ${shipment.status}`);
      if (!item.erpCapturedAt) rowIssues.push('주문 당시 ERP 기록 미기록');
      else if (!item.erpName) rowIssues.push('주문 당시 ERP 품명 미설정');
      const qty = qtyOf(item, index);
      const regularAmount = item.regularUnitPrice === null ? null : multiply(qty, item.regularUnitPrice);
      if (regularAmount === null) rowIssues.push('주문 당시 할인 전 정가 미기록');
      const productDiscount = regularAmount === null || regularAmount < grossOf(index) ? null : regularAmount - grossOf(index);
      if (regularAmount !== null && productDiscount === null) rowIssues.push('정가·판매가 기록 불일치');
      const shippingFee = shipment ? assigned.has(shipment.id) ? 0 : shipment.shippingFee : null;
      const shippingCollectFee = shipment ? assigned.has(shipment.id) ? 0 : shipment.shippingCollectFee ?? 0 : null;
      const installationFee = shipment ? assigned.has(shipment.id) ? 0 : sum((order.shippingComponents ?? []).filter(c => c.shipmentId === shipment.id).map(c => c.installationFee ?? 0)) : null;
      const shippingCouponDiscount = shipment ? assigned.has(shipment.id) ? 0 : sum((order.shippingComponents ?? []).filter(c => c.shipmentId === shipment.id).map(c => c.shippingCouponDiscount ?? 0)) : null;
      if (shipment) assigned.add(shipment.id);
      // 남은 몫의 판매금액은 실제 남은 결제 몫이다. 쿠폰·적립금 취소분은 각각 끝수를 버려 배분하므로 열 사이에 몇 원 차이가 날 수 있다.
      const componentSales = afterCoupon && credits ? afterCoupon[index] - credits[index] : null;
      if (rest && componentSales !== null && componentSales !== rest.paid) rowIssues.push(`부분 취소 배분 끝수 차이 ${(componentSales - rest.paid).toLocaleString('ko-KR')}원(판매금액은 남은 결제 몫)`);
      return {
        shippingCouponDiscount, installationFee, volumeDiscount: isV2 ? rest?.volume ?? saved[index]!.volumeDiscount : 0, shippingCollectFee, collectState: shipment?.collectState ? SHIPPING_COLLECT_STATE_LABEL[shipment.collectState] : '해당 없음', calculationVersion,
        doneAt: order.doneAt, orderId: order.id, trackingNumber: shipment?.trackingNumber ?? null, erpName: item.erpName, qty,
        salesAmount: rest ? rest.paid : componentSales, shippingFee, paidAt,
        regularAmount, productDiscount, beforeCouponAmount: before[index], couponAmount: coupon?.[index] ?? null, creditAmount: credits?.[index] ?? null,
        erpCode: item.erpCode, barcode: item.barcode, goodName: item.goodName, variantName: item.variantName,
        shipmentId: item.shipmentId, itemId: item.id, paymentTimeSource: !paidAt ? '미기록' : payment?.timeSource === 'bank_confirmation' ? '입금확인 기록' : '결제사 승인 기록', issues: rowIssues,
      };
    };
    // 모두 취소된 품목은 줄을 만들지 않는다(남은 수량·금액이 0이고 배송 건에서도 빠졌다).
    const orderLines = items.flatMap((item, index): SettledExportLine[] => live(index) ? [settledLine(item, index)] : []);
    // 부분 취소로 닫힌 배송 건은 배송비를 환불했으므로 품목이 없는 것이 맞다.
    if (order.shipments.some(shipment => !assigned.has(shipment.id) && !closedIds.has(shipment.id))) issues.push('품목이 없는 배송 건: 배송비 배분 확인 필요');
    const detailSales = items.length ? sumKnown(orderLines.map(line => line.salesAmount)) : null;
    const detailShipping = items.length ? sumKnown(orderLines.map(line => line.shippingFee)) : null;
    const detailShippingCollect = items.length ? sumKnown(orderLines.map(line => line.shippingCollectFee)) : null;
    const closedCollect = sum(closedShipments.map(shipment => shipment.shippingCollectFee ?? 0));
    const collectDifference = detailShippingCollect === null ? null : detailShippingCollect - ((order.shippingCollectTotal ?? 0) - closedCollect);
    if (collectDifference) issues.push('착불 배송비 품목 합계와 별도 지급 원장 불일치');
    const detailTotal = detailSales === null || detailShipping === null ? null : sum([detailSales, detailShipping]);
    // 부분 취소가 있으면 주문 금액·결제 원장 모두 환불한 몫을 뺀 남은 금액으로 대조한다.
    const total = order.total - partialRefunded;
    const paymentAmount = payment ? payment.amount - partialRefunded : null;
    const detailDifference = detailTotal === null ? null : detailTotal - total;
    const ledgerDifference = paymentAmount === null ? null : paymentAmount - total;
    if (detailDifference) issues.push('품목·배송비 합계와 주문 금액 불일치');
    if (ledgerDifference) issues.push('결제 원장과 주문 금액 불일치');
    if (detailTotal === null) issues.push('품목 금액 배분 미완료: 주문 원장 금액 참조');
    const allIssues = [...new Set([...issues, ...orderLines.flatMap(line => line.issues)])];
    for (const line of orderLines) line.issues = [...new Set([...line.issues, ...issues])];
    lines.push(...orderLines);
    const cuts = remaining.flatMap(entry => entry ? [entry.cut] : []);
    const openComponents = (order.shippingComponents ?? []).filter(c => !closedIds.has(c.shipmentId));
    summaries.push({ shippingCouponDiscount: closedIds.size ? (order.shippingCouponDiscount ?? 0) - sum((order.shippingComponents ?? []).filter(c => closedIds.has(c.shipmentId)).map(c => c.shippingCouponDiscount ?? 0)) : order.shippingCouponDiscount ?? 0, installationFee: sum(openComponents.map(c => c.installationFee ?? 0)), volumeDiscount: (order.volumeDiscount ?? 0) - sum(cuts.map(cut => cut.volumeDiscount)), shippingCollectTotal: (order.shippingCollectTotal ?? 0) - closedCollect, detailShippingCollect, collectDifference, calculationVersion, id: order.id, doneAt: order.doneAt, paidAt, itemCount: orderLines.length, qty: sum(items.map((item, index) => qtyOf(item, index))), beforeCouponAmount: sum(before), couponDiscount: order.couponDiscount - sum(cuts.map(cut => cut.couponDiscount)), storeCredits: order.storeCredits - sum(cuts.map(cut => cut.storeCreditDiscount)), shippingFee: order.shippingFee - sum(closedShipments.map(shipment => shipment.shippingFee)), total, detailSales, detailShipping, detailTotal, paymentAmount, detailDifference, ledgerDifference, paymentStatus: payment?.status ?? '미확인', issues: allIssues });
  }
  return { snapshot, lines, orders: summaries };
}
