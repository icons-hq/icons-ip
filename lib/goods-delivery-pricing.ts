import { isUuid } from './uuid';
import { GOODS_TRANSACTION_INT_MAX, allocateTransactionAmount, parseTransactionDraftValues, transactionExactKeys, transactionGoodId, transactionInteger, transactionRecord, transactionSafeAmount, transactionSum } from './goods-transaction-values';

export const GOODS_DELIVERY_DRAFT_KEYS = ['kind', 'baseFee', 'interval', 'firstLimit', 'secondLimit', 'extra1', 'extra2', 'paymentMode'] as const;

export type GoodsDeliveryQuantityTerms =
  | { kind: 'repeat'; baseFee: number; interval: number }
  | { kind: 'tier2'; baseFee: number; firstLimit: number; extra1: number }
  | { kind: 'tier3'; baseFee: number; firstLimit: number; secondLimit: number; extra1: number; extra2: number };
export type GoodsDeliveryPaymentMode = 'prepaid' | 'collect';
export type GoodsDeliveryPaymentChoice = GoodsDeliveryPaymentMode | 'buyer_choice';

export interface GoodsDeliveryPolicy {
  id: string;
  goodId: string;
  revision: number;
  status: 'draft' | 'active' | 'disabled';
  paymentMode: GoodsDeliveryPaymentChoice;
  quantityTerms: GoodsDeliveryQuantityTerms | null;
  draftValues: Record<string, string>;
}

export function parseGoodsDeliveryPolicy(value: unknown): GoodsDeliveryPolicy | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'goodId', 'revision', 'status', 'paymentMode', 'quantityTerms', 'draftValues'])
    || typeof value.id !== 'string' || !isUuid(value.id) || !transactionGoodId(value.goodId)
    || !transactionInteger(value.revision, 1, GOODS_TRANSACTION_INT_MAX) || !['draft', 'active', 'disabled'].includes(String(value.status))
    || !['prepaid', 'collect', 'buyer_choice'].includes(String(value.paymentMode))) return null;
  const quantityTerms = value.quantityTerms === null ? null : parseGoodsDeliveryQuantityTerms(value.quantityTerms);
  const draftValues = parseTransactionDraftValues(value.draftValues, GOODS_DELIVERY_DRAFT_KEYS);
  if ((value.quantityTerms !== null && !quantityTerms) || !draftValues) return null;
  return { id: value.id.toLowerCase(), goodId: value.goodId, revision: value.revision, status: value.status as GoodsDeliveryPolicy['status'],
    paymentMode: value.paymentMode as GoodsDeliveryPaymentChoice, quantityTerms, draftValues };
}

export function parseGoodsDeliveryQuantityTerms(value: unknown): GoodsDeliveryQuantityTerms | null {
  if (!transactionRecord(value) || !transactionInteger(value.baseFee, 0, 1_000_000)) return null;
  if (value.kind === 'repeat' && transactionExactKeys(value, ['kind', 'baseFee', 'interval'])
    && transactionInteger(value.interval, 1, GOODS_TRANSACTION_INT_MAX)) return { kind: 'repeat', baseFee: value.baseFee, interval: value.interval };
  if (!transactionInteger(value.firstLimit, 1, GOODS_TRANSACTION_INT_MAX) || !transactionInteger(value.extra1, 0, 1_000_000)) return null;
  if (value.kind === 'tier2' && transactionExactKeys(value, ['kind', 'baseFee', 'firstLimit', 'extra1'])) {
    return { kind: 'tier2', baseFee: value.baseFee, firstLimit: value.firstLimit, extra1: value.extra1 };
  }
  if (value.kind === 'tier3' && transactionExactKeys(value, ['kind', 'baseFee', 'firstLimit', 'secondLimit', 'extra1', 'extra2'])
    && transactionInteger(value.secondLimit, value.firstLimit + 1, GOODS_TRANSACTION_INT_MAX)
    && transactionInteger(value.extra2, value.extra1, 1_000_000)) {
    return { kind: 'tier3', baseFee: value.baseFee, firstLimit: value.firstLimit, secondLimit: value.secondLimit, extra1: value.extra1, extra2: value.extra2 };
  }
  return null;
}

export function calculateGoodsQuantityDelivery(qty: number, raw: GoodsDeliveryQuantityTerms): number {
  const terms = parseGoodsDeliveryQuantityTerms(raw);
  if (!transactionInteger(qty, 1) || !terms) throw new RangeError('invalid_quantity_delivery');
  if (terms.kind === 'repeat') return transactionSafeAmount((BigInt(qty) + BigInt(terms.interval) - BigInt(1)) / BigInt(terms.interval) * BigInt(terms.baseFee));
  if (qty <= terms.firstLimit) return terms.baseFee;
  return terms.baseFee + (terms.kind === 'tier3' && qty > terms.secondLimit ? terms.extra2 : terms.extra1);
}

export interface GoodsDeliveryAllocationGood {
  goodId: string;
  qty: number;
  subtotal: number;
  policyEligible: boolean;
  individualFee: number;
  regionalEligible: boolean;
  paymentMode: GoodsDeliveryPaymentMode;
}
export interface GoodsDeliveryAllocation {
  prepaidFee: number;
  collectFee: number;
  fullFee: number;
  goods: Array<{ goodId: string; baseFee: number; regionalFee: number; paymentMode: GoodsDeliveryPaymentMode; totalFee: number }>;
}

/** Allocate one physical origin shipment's already-resolved fees. Regional
 * eligibility/waivers are resolved by the DB regional policy adapter. */
export function allocateGoodsDeliveryFees(goods: readonly GoodsDeliveryAllocationGood[], policyBaseFee: number,
  regional: { unit: 'per_shipment' | 'per_good'; fee: number }): GoodsDeliveryAllocation {
  if (!goods.length || new Set(goods.map(good => good.goodId)).size !== goods.length || !transactionInteger(policyBaseFee)
    || !transactionInteger(regional.fee) || !['per_shipment', 'per_good'].includes(regional.unit)
    || goods.some(good => !good.goodId || !transactionInteger(good.qty, 1) || !transactionInteger(good.subtotal)
      || !transactionInteger(good.individualFee) || (good.policyEligible && good.individualFee !== 0)
      || typeof good.policyEligible !== 'boolean' || typeof good.regionalEligible !== 'boolean'
      || !['prepaid', 'collect'].includes(good.paymentMode))) throw new RangeError('invalid_delivery_allocation');
  const policyGoods = goods.filter(good => good.policyEligible);
  if (!policyGoods.length && policyBaseFee !== 0) throw new RangeError('delivery_policy_without_goods');
  const basis = (rows: readonly GoodsDeliveryAllocationGood[]) => rows.some(good => good.subtotal > 0) ? 'subtotal' : 'qty';
  const policyBasis = basis(policyGoods);
  const policyAmounts = policyGoods.length ? allocateTransactionAmount(policyBaseFee, policyGoods.map(good => ({ id: good.goodId, weight: good[policyBasis] }))) : {};
  const base = Object.fromEntries(goods.map(good => [good.goodId, good.policyEligible ? policyAmounts[good.goodId] : good.individualFee]));
  const regionalGoods = goods.filter(good => good.regionalEligible);
  if (!regionalGoods.length && regional.fee !== 0) throw new RangeError('delivery_region_without_goods');
  let regionalAmounts: Record<string, number> = {};
  if (regional.unit === 'per_good') regionalAmounts = Object.fromEntries(regionalGoods.map(good => [good.goodId, regional.fee]));
  else if (regionalGoods.length) {
    const regionalBasis = regionalGoods.some(good => base[good.goodId] > 0) ? 'base' : basis(regionalGoods);
    regionalAmounts = allocateTransactionAmount(regional.fee, regionalGoods.map(good => ({ id: good.goodId,
      weight: regionalBasis === 'base' ? base[good.goodId] : good[regionalBasis] })));
  }
  const rows = goods.map(good => ({ goodId: good.goodId, baseFee: base[good.goodId], regionalFee: regionalAmounts[good.goodId] ?? 0,
    paymentMode: good.paymentMode, totalFee: transactionSum([base[good.goodId], regionalAmounts[good.goodId] ?? 0]) }));
  const prepaidFee = transactionSum(rows.filter(row => row.paymentMode === 'prepaid').map(row => row.totalFee));
  const collectFee = transactionSum(rows.filter(row => row.paymentMode === 'collect').map(row => row.totalFee));
  return { prepaidFee, collectFee, fullFee: transactionSum([prepaidFee, collectFee]), goods: rows };
}
