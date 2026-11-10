import { FULFILLMENT_METHODS, parseFulfillmentTerms, type FulfillmentTerms, type FulfillmentMethod } from './goods-fulfillment';
import { parseShipmentDeliverySummary, type DeliveryPolicySnapshot } from './shipment-delivery';
import { parseProductionTerms, type ProductionTerms } from './order-production';
import { isUuid } from './uuid';
import { parseGoodsVolumeDiscountPolicy, type GoodsVolumeDiscountPolicy } from './goods-volume-discount';
import { parseGoodsDeliveryPolicy, type GoodsDeliveryPolicy, type GoodsDeliveryPaymentMode } from './goods-delivery-pricing';
import { GOODS_TRANSACTION_INT_MAX, GOODS_TRANSACTION_MAX_LINES, GOODS_TRANSACTION_MIN_PAYABLE, GOODS_TRANSACTION_ONLINE_MAX, GOODS_TRANSACTION_SELECTION_MAX_BYTES, transactionEpochMicros, transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord, transactionSafeAmount, transactionSum } from './goods-transaction-values';
import { hasShippingChargeDetails, parseShippingChargeDetails, type ShippingChargeDetails } from './shipping-charge-groups';

export { GOODS_TRANSACTION_MAX_LINES } from './goods-transaction-values';
export interface GoodsTransactionSource { kind: 'cart' | 'gift' | 'subscription'; id: string; revision: string }
export interface GoodsTransactionSelection { goodId: string; variantId: string; qty: number; inputRevision: number; inputValues: Record<string, string> }
export interface GoodsTransactionTotals {
  shippingCouponDiscountTotal?: number;
  subtotal: number; volumeDiscountTotal: number; netGoodsTotal: number; couponDiscountTotal: number;
  storeCreditTotal: number; prepaidShippingTotal: number; collectShippingTotal: number; onlineTotal: number; customerTotal: number;
}
export interface GoodsTransactionLine {
  production?: ProductionTerms | null;
  fulfillment?: FulfillmentTerms | null;
  lineId: string; goodId: string; variantId: string; qty: number; regularUnitPrice: number; unitPrice: number;
  volumeUnitDiscount: number; subtotal: number; volumeDiscountTotal: number; netSubtotal: number;
  couponDiscount: number; storeCreditDiscount: number; paidGoodsTotal: number; volumePolicyId: string | null;
}
export interface GoodsTransactionShippingComponent {
  installationFee?: number; shippingCouponDiscount?: number;
  goodId: string; paymentMode: GoodsDeliveryPaymentMode; baseFee: number; regionalFee: number; totalFee: number; deliveryPolicyId: string | null;
}
export interface GoodsTransactionCollector { name: string; method: string; refundContact: string; instructions: string }
export interface GoodsTransactionShippingGroup {
  deliveryMethod?: FulfillmentMethod; deliveryPolicy?: DeliveryPolicySnapshot | { version: 2; feeRule: 'checkout_prepaid'; confirmationRule: 'protected_download' } | null;
  originId: string; prepaidFee: number; collectFee: number; fullFee: number;
  components: GoodsTransactionShippingComponent[]; collector: GoodsTransactionCollector | null;
  chargeDetails?: ShippingChargeDetails;
}
export interface AppliedTransactionCoupon { userCouponId: string; code: string; name: string; benefitKind: 'goods' | 'shipping'; discount: number; applicationIndex: number }
export interface GoodsTransactionDisplay {
  coupons?: AppliedTransactionCoupon[];
  calculationVersion: 2; currency: 'KRW'; calculatedAt: string; nextChangeAt: string | null;
  lines: GoodsTransactionLine[]; shipping: GoodsTransactionShippingGroup[]; totals: GoodsTransactionTotals;
  userCouponId: string | null; storeCreditMaximum: number; paymentMethods: { card: boolean; bankTransfer: boolean };
}
export const GOODS_TRANSACTION_ISSUE_CODES = ['address_required', 'invalid_selection', 'goods_unavailable', 'adult_verification_required', 'purchase_limit', 'purchase_restricted', 'payment_method_unavailable',
  'shipping_unresolved', 'collect_not_ready', 'delivery_choice_required', 'coupon_unavailable', 'store_credit_unavailable', 'below_minimum_payment',
  'amount_overflow', 'source_changed'] as const;
export type GoodsTransactionIssueCode = typeof GOODS_TRANSACTION_ISSUE_CODES[number];
export type GoodsTransactionQuote =
  | { state: 'quoted'; quoteId: string; expiresAt: string; display: GoodsTransactionDisplay }
  | { state: 'blocked'; issues: Array<{ code: GoodsTransactionIssueCode; goodId: string | null }> };
export interface GoodsTransactionAdminTerms {
  goodId: string; revision: number; goodUpdatedAt: string; volume: GoodsVolumeDiscountPolicy | null; delivery: GoodsDeliveryPolicy | null;
}
export interface GoodsTransactionAdminReceipt extends GoodsTransactionAdminTerms { operationId: string; changed: boolean }

function uuid(value: unknown): value is string { return typeof value === 'string' && isUuid(value) && value === value.toLowerCase(); }
function nullableUuid(value: unknown): boolean { return value === null || uuid(value); }
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseGoodsTransactionSource(value: unknown): GoodsTransactionSource | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['kind', 'id', 'revision'])
    || !['cart', 'gift', 'subscription'].includes(String(value.kind)) || !uuid(value.id) || !text(value.revision, 256)) return null;
  return { kind: value.kind as GoodsTransactionSource['kind'], id: value.id, revision: value.revision };
}

export function parseGoodsTransactionSelection(value: unknown): GoodsTransactionSelection[] | null {
  if (!Array.isArray(value) || !value.length || value.length > GOODS_TRANSACTION_MAX_LINES) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > GOODS_TRANSACTION_SELECTION_MAX_BYTES) return null; } catch { return null; }
  const result: GoodsTransactionSelection[] = []; const identities = new Set<string>();
  for (const row of value) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['goodId', 'variantId', 'qty', 'inputRevision', 'inputValues'])
      || !transactionGoodId(row.goodId) || !uuid(row.variantId) || !transactionInteger(row.qty, 1, GOODS_TRANSACTION_INT_MAX)
      || !transactionInteger(row.inputRevision, 0, GOODS_TRANSACTION_INT_MAX) || !transactionRecord(row.inputValues)
      || Object.keys(row.inputValues).length > 5 || Object.entries(row.inputValues).some(([key, val]) => !uuid(key) || !text(val, 100))
      || (row.inputRevision === 0) !== (Object.keys(row.inputValues).length === 0)) return null;
    const inputValues = Object.fromEntries(Object.entries(row.inputValues).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) as Record<string, string>;
    const identity = JSON.stringify([row.goodId, row.variantId, row.inputRevision, inputValues]);
    if (identities.has(identity)) return null;
    identities.add(identity); result.push({ goodId: row.goodId, variantId: row.variantId, qty: row.qty, inputRevision: row.inputRevision, inputValues });
  }
  return result;
}

const TOTAL_KEYS = ['subtotal', 'volumeDiscountTotal', 'netGoodsTotal', 'couponDiscountTotal', 'storeCreditTotal', 'prepaidShippingTotal', 'collectShippingTotal', 'onlineTotal', 'customerTotal'] as const;
export function parseGoodsTransactionTotals(value: unknown): GoodsTransactionTotals | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, [...TOTAL_KEYS, ...(Object.hasOwn(value, 'shippingCouponDiscountTotal') ? ['shippingCouponDiscountTotal'] : [])]) || !transactionInteger(value.shippingCouponDiscountTotal ?? 0) || TOTAL_KEYS.some(key => !transactionInteger(value[key]))) return null;
  const row = value as unknown as GoodsTransactionTotals;
  try {
    if (row.volumeDiscountTotal > row.subtotal || row.netGoodsTotal !== row.subtotal - row.volumeDiscountTotal
      || row.couponDiscountTotal > row.netGoodsTotal || row.storeCreditTotal > row.netGoodsTotal - row.couponDiscountTotal
      || row.onlineTotal !== transactionSafeAmount(BigInt(row.netGoodsTotal) + BigInt(row.prepaidShippingTotal) - BigInt(row.couponDiscountTotal) - BigInt(row.storeCreditTotal))
      || row.onlineTotal < GOODS_TRANSACTION_MIN_PAYABLE || row.onlineTotal > GOODS_TRANSACTION_ONLINE_MAX || row.customerTotal !== transactionSum([row.onlineTotal, row.collectShippingTotal])) return null;
    return { ...row };
  } catch { return null; }
}

function parseLine(value: unknown): GoodsTransactionLine | null {
  const keys = ['lineId', 'goodId', 'variantId', 'qty', 'regularUnitPrice', 'unitPrice', 'volumeUnitDiscount', 'subtotal', 'volumeDiscountTotal', 'netSubtotal', 'couponDiscount', 'storeCreditDiscount', 'paidGoodsTotal', 'volumePolicyId'];
  if (!transactionRecord(value) || !transactionExactKeys(value, [...keys, ...(Object.hasOwn(value, 'production') ? ['production'] : []), ...(Object.hasOwn(value, 'fulfillment') ? ['fulfillment'] : [])]) || !uuid(value.lineId) || !transactionGoodId(value.goodId) || !uuid(value.variantId)
    || !transactionInteger(value.qty, 1, GOODS_TRANSACTION_INT_MAX) || !transactionInteger(value.regularUnitPrice, 0, GOODS_TRANSACTION_INT_MAX)
    || !transactionInteger(value.unitPrice, 0, value.regularUnitPrice) || !transactionInteger(value.volumeUnitDiscount, 0, value.unitPrice)
    || !nullableUuid(value.volumePolicyId) || keys.slice(7, 13).some(key => !transactionInteger(value[key]))) return null;
  const fulfillment = value.fulfillment == null ? null : parseFulfillmentTerms(value.fulfillment);
  if (value.fulfillment != null && (!fulfillment || fulfillment.goodId !== value.goodId)) return null;
  const production = value.production == null ? null : parseProductionTerms(value.production);
  if (value.production != null && (!production || production.goodId !== value.goodId)) return null;
  const row = value as unknown as GoodsTransactionLine;
  if (BigInt(row.qty) * BigInt(row.unitPrice) !== BigInt(row.subtotal) || BigInt(row.qty) * BigInt(row.volumeUnitDiscount) !== BigInt(row.volumeDiscountTotal)
    || row.netSubtotal !== row.subtotal - row.volumeDiscountTotal || row.couponDiscount > row.netSubtotal
    || row.storeCreditDiscount > row.netSubtotal - row.couponDiscount || row.paidGoodsTotal !== row.netSubtotal - row.couponDiscount - row.storeCreditDiscount
    || (row.volumePolicyId === null && row.volumeDiscountTotal !== 0)) return null;
  return { ...row };
}

export function componentPrepaidFee(c: GoodsTransactionShippingComponent) { return c.paymentMode === 'prepaid' ? c.totalFee : c.installationFee ?? 0; }
export function componentCollectFee(c: GoodsTransactionShippingComponent) { return c.paymentMode === 'collect' ? c.totalFee - (c.installationFee ?? 0) : 0; }

function parseShippingGroup(value: unknown, selectedGoods: Set<string>, lines: readonly GoodsTransactionLine[]): GoodsTransactionShippingGroup | null {
  const grouped = hasShippingChargeDetails(value);
  const methodFields = transactionRecord(value) && Object.hasOwn(value, 'deliveryMethod');
  if (!transactionRecord(value) || !transactionExactKeys(value, ['originId', 'prepaidFee', 'collectFee', 'fullFee', 'components', 'collector', ...(grouped ? ['chargeDetails'] : []), ...(methodFields ? ['deliveryMethod', 'deliveryPolicy'] : [])])
    || !uuid(value.originId) || !transactionInteger(value.prepaidFee) || !transactionInteger(value.collectFee) || !transactionInteger(value.fullFee)
    || !Array.isArray(value.components) || !value.components.length || value.components.length > GOODS_TRANSACTION_MAX_LINES) return null;
  const components: GoodsTransactionShippingComponent[] = []; const ids = new Set<string>();
  for (const component of value.components) {
    if (!transactionRecord(component) || !transactionExactKeys(component, ['goodId', 'paymentMode', 'baseFee', 'regionalFee', 'totalFee', 'deliveryPolicyId', ...(Object.hasOwn(component, 'installationFee') ? ['installationFee'] : []), ...(Object.hasOwn(component, 'shippingCouponDiscount') ? ['shippingCouponDiscount'] : [])])
      || !transactionGoodId(component.goodId) || !selectedGoods.has(component.goodId) || ids.has(component.goodId)
      || !['prepaid', 'collect'].includes(String(component.paymentMode)) || !transactionInteger(component.baseFee)
      || !transactionInteger(component.regionalFee) || !transactionInteger(component.totalFee) || !nullableUuid(component.deliveryPolicyId)
      || !transactionInteger(component.installationFee ?? 0) || !transactionInteger(component.shippingCouponDiscount ?? 0, 0, component.baseFee + component.regionalFee) || component.paymentMode === 'collect' && (component.shippingCouponDiscount ?? 0) !== 0 || BigInt(component.baseFee) + BigInt(component.regionalFee) + BigInt((component.installationFee as number | undefined) ?? 0) - BigInt((component.shippingCouponDiscount as number | undefined) ?? 0) !== BigInt(component.totalFee)) return null;
    ids.add(component.goodId); components.push(component as unknown as GoodsTransactionShippingComponent);
  }
  let collector: GoodsTransactionCollector | null = null;
  if (value.collector !== null) {
    if (!transactionRecord(value.collector) || !transactionExactKeys(value.collector, ['name', 'method', 'refundContact', 'instructions'])
      || !text(value.collector.name, 100) || !text(value.collector.method, 200) || !text(value.collector.refundContact, 200)
      || !text(value.collector.instructions, 500)) return null;
    collector = value.collector as unknown as GoodsTransactionCollector;
  }
  if ((value.collectFee > 0 || grouped && components.some(row => row.paymentMode === 'collect')) && !collector) return null;
  if (transactionSum(components.map(componentPrepaidFee)) !== value.prepaidFee
    || transactionSum(components.map(componentCollectFee)) !== value.collectFee
    || transactionSum([value.prepaidFee, value.collectFee]) !== value.fullFee) return null;
  const chargeDetails = grouped ? parseShippingChargeDetails(value.chargeDetails, components, lines) : null;
  if (grouped && !chargeDetails) return null;
  let delivery: Pick<GoodsTransactionShippingGroup, 'deliveryMethod' | 'deliveryPolicy'> = {};
  if (methodFields) {
    const method = value.deliveryMethod as FulfillmentMethod;
    if (!FULFILLMENT_METHODS.includes(method) || lines.some(line => components.some(c => c.goodId === line.goodId) && (line.fulfillment?.method ?? 'parcel') !== method)) return null;
    if (method === 'digital') {
      const p = value.deliveryPolicy;
      if (!transactionRecord(p) || !transactionExactKeys(p, ['version', 'feeRule', 'confirmationRule']) || p.version !== 2 || p.feeRule !== 'checkout_prepaid' || p.confirmationRule !== 'protected_download') return null;
      delivery = { deliveryMethod: method, deliveryPolicy: p as GoodsTransactionShippingGroup['deliveryPolicy'] };
    } else {
      const summary = parseShipmentDeliverySummary({ method, policy: value.deliveryPolicy, providerName: null, canIssueReceipt: false });
      if (!summary || method === 'parcel' && value.deliveryPolicy !== null || method !== 'parcel' && summary.policy?.version !== 2) return null;
      delivery = { deliveryMethod: method, deliveryPolicy: summary.policy };
    }
  }
  return { ...delivery, originId: value.originId, prepaidFee: value.prepaidFee, collectFee: value.collectFee, fullFee: value.fullFee, components, collector,
    ...(chargeDetails ? { chargeDetails } : {}) };
}

export function parseGoodsTransactionDisplay(value: unknown): GoodsTransactionDisplay | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['calculationVersion', 'currency', 'calculatedAt', 'nextChangeAt', 'lines', 'shipping', 'totals', 'userCouponId', 'storeCreditMaximum', 'paymentMethods', ...(Object.hasOwn(value, 'coupons') ? ['coupons'] : [])])
    || value.calculationVersion !== 2 || value.currency !== 'KRW' || !transactionInstant(value.calculatedAt)
    || (value.nextChangeAt !== null && (!transactionInstant(value.nextChangeAt) || transactionEpochMicros(value.nextChangeAt) <= transactionEpochMicros(value.calculatedAt)))
    || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > GOODS_TRANSACTION_MAX_LINES
    || !Array.isArray(value.shipping) || !value.shipping.length || value.shipping.length > GOODS_TRANSACTION_MAX_LINES
    || !nullableUuid(value.userCouponId) || !transactionInteger(value.storeCreditMaximum) || !transactionRecord(value.paymentMethods)
    || !transactionExactKeys(value.paymentMethods, ['card', 'bankTransfer']) || typeof value.paymentMethods.card !== 'boolean'
    || typeof value.paymentMethods.bankTransfer !== 'boolean' || (!value.paymentMethods.card && !value.paymentMethods.bankTransfer)) return null;
  try {
    const totals = parseGoodsTransactionTotals(value.totals); if (!totals) return null;
    const parsedLines = value.lines.map(parseLine); if (parsedLines.some(line => !line)) return null;
    const lines = parsedLines as GoodsTransactionLine[];
    if (new Set(lines.map(line => line.lineId)).size !== lines.length) return null;
    const selectedGoods = new Set(lines.map(line => line.goodId));
    const parsedGroups = value.shipping.map(group => parseShippingGroup(group, selectedGoods, lines)); if (parsedGroups.some(group => !group)) return null;
    const shipping = parsedGroups as GoodsTransactionShippingGroup[];
    const componentIds = shipping.flatMap(group => group.components.map(component => component.goodId));
    const chargeGroupIds = shipping.flatMap(group => group.chargeDetails?.groups.map(detail => detail.groupId) ?? []);
    if (new Set(shipping.map(group => `${group.originId}:${group.deliveryMethod ?? 'parcel'}`)).size !== shipping.length || componentIds.length !== selectedGoods.size
      || new Set(componentIds).size !== componentIds.length || new Set(chargeGroupIds).size !== chargeGroupIds.length) return null;
    const checks: Array<[number[], number]> = [[lines.map(row => row.subtotal), totals.subtotal], [lines.map(row => row.volumeDiscountTotal), totals.volumeDiscountTotal],
      [lines.map(row => row.netSubtotal), totals.netGoodsTotal], [lines.map(row => row.couponDiscount), totals.couponDiscountTotal],
      [lines.map(row => row.storeCreditDiscount), totals.storeCreditTotal], [shipping.map(row => row.prepaidFee), totals.prepaidShippingTotal],
      [shipping.map(row => row.collectFee), totals.collectShippingTotal]];
    if (checks.some(([rows, expected]) => transactionSum(rows) !== expected) || (value.userCouponId === null && totals.couponDiscountTotal !== 0)
      || value.storeCreditMaximum < totals.storeCreditTotal || value.storeCreditMaximum > Math.min(totals.netGoodsTotal - totals.couponDiscountTotal,
        transactionSum([totals.netGoodsTotal - totals.couponDiscountTotal, totals.prepaidShippingTotal]) - GOODS_TRANSACTION_MIN_PAYABLE)) return null;
    let coupons: AppliedTransactionCoupon[] | undefined;
    if (value.coupons !== undefined) {
      if (!Array.isArray(value.coupons) || value.coupons.length > 6) return null;
      const seen = new Set<string>(); let shippingSeen = false;
      for (const [index, c] of value.coupons.entries()) {
        if (!transactionRecord(c) || !transactionExactKeys(c, ['userCouponId', 'code', 'name', 'benefitKind', 'discount', 'applicationIndex']) || !uuid(c.userCouponId) || seen.has(c.userCouponId)
          || !text(c.code, 24) || !text(c.name, 80) || !['goods', 'shipping'].includes(String(c.benefitKind)) || !transactionInteger(c.discount, 1) || c.applicationIndex !== index + 1 || shippingSeen) return null;
        seen.add(c.userCouponId); if (c.benefitKind === 'shipping') shippingSeen = true;
      }
      coupons = value.coupons as AppliedTransactionCoupon[];
      if ((coupons[0]?.userCouponId ?? null) !== value.userCouponId || transactionSum(coupons.filter(c => c.benefitKind === 'goods').map(c => c.discount)) !== totals.couponDiscountTotal
        || transactionSum(coupons.filter(c => c.benefitKind === 'shipping').map(c => c.discount)) !== (totals.shippingCouponDiscountTotal ?? 0)) return null;
    } else if ((totals.shippingCouponDiscountTotal ?? 0) !== 0) return null;
    if (transactionSum(shipping.flatMap(g => g.components.map(c => c.shippingCouponDiscount ?? 0))) !== (totals.shippingCouponDiscountTotal ?? 0)) return null;
    return { ...(coupons ? { coupons } : {}), calculationVersion: 2, currency: 'KRW', calculatedAt: value.calculatedAt, nextChangeAt: value.nextChangeAt as string | null,
      lines, shipping, totals, userCouponId: value.userCouponId as string | null, storeCreditMaximum: value.storeCreditMaximum,
      paymentMethods: { card: value.paymentMethods.card, bankTransfer: value.paymentMethods.bankTransfer } };
  } catch { return null; }
}

export function parseGoodsTransactionQuote(value: unknown): GoodsTransactionQuote | null {
  if (!transactionRecord(value)) return null;
  if (value.state === 'blocked') {
    if (!transactionExactKeys(value, ['state', 'issues']) || !Array.isArray(value.issues) || !value.issues.length || value.issues.length > GOODS_TRANSACTION_MAX_LINES) return null;
    const issues: Extract<GoodsTransactionQuote, { state: 'blocked' }>['issues'] = [];
    for (const issue of value.issues) {
      if (!transactionRecord(issue) || !transactionExactKeys(issue, ['code', 'goodId']) || (issue.goodId !== null && !transactionGoodId(issue.goodId))
        || !GOODS_TRANSACTION_ISSUE_CODES.includes(issue.code as GoodsTransactionIssueCode)) return null;
      issues.push({ code: issue.code as GoodsTransactionIssueCode, goodId: issue.goodId as string | null });
    }
    if (new Set(issues.map(issue => `${issue.code}:${issue.goodId}`)).size !== issues.length) return null;
    return { state: 'blocked', issues };
  }
  if (value.state !== 'quoted' || !transactionExactKeys(value, ['state', 'quoteId', 'expiresAt', 'display'])
    || !uuid(value.quoteId) || !transactionInstant(value.expiresAt)) return null;
  const display = parseGoodsTransactionDisplay(value.display); if (!display) return null;
  const expires = transactionEpochMicros(value.expiresAt); const at = transactionEpochMicros(display.calculatedAt);
  if (expires <= at || expires > at + BigInt(600_000_000) || (display.nextChangeAt && expires > transactionEpochMicros(display.nextChangeAt))) return null;
  return { state: 'quoted', quoteId: value.quoteId, expiresAt: value.expiresAt, display };
}

export function parseGoodsTransactionAdminTerms(value: unknown): GoodsTransactionAdminTerms | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['goodId', 'revision', 'goodUpdatedAt', 'volume', 'delivery'])
    || !transactionGoodId(value.goodId) || !transactionInteger(value.revision, 0, GOODS_TRANSACTION_INT_MAX) || !transactionInstant(value.goodUpdatedAt)) return null;
  const volume = value.volume === null ? null : parseGoodsVolumeDiscountPolicy(value.volume);
  const delivery = value.delivery === null ? null : parseGoodsDeliveryPolicy(value.delivery);
  if ((value.volume !== null && !volume) || (value.delivery !== null && !delivery)
    || (volume && (volume.goodId !== value.goodId || volume.revision > value.revision))
    || (delivery && (delivery.goodId !== value.goodId || delivery.revision > value.revision))) return null;
  return { goodId: value.goodId, revision: value.revision, goodUpdatedAt: value.goodUpdatedAt, volume, delivery };
}

export function parseGoodsTransactionAdminReceipt(value: unknown): GoodsTransactionAdminReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['operationId', 'changed', 'goodId', 'revision', 'goodUpdatedAt', 'volume', 'delivery'])
    || !uuid(value.operationId) || typeof value.changed !== 'boolean') return null;
  const { operationId, changed, ...rest } = value; const terms = parseGoodsTransactionAdminTerms(rest);
  return terms ? { ...terms, operationId, changed } : null;
}
