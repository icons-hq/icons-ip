import { isUuid } from './uuid';
import { GOODS_TRANSACTION_INT_MAX, GOODS_TRANSACTION_MAX_LINES, parseTransactionDraftValues, transactionEpochMicros, transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord, transactionSafeAmount, transactionSum } from './goods-transaction-values';

export const GOODS_VOLUME_DISCOUNT_DRAFT_KEYS = ['condition', 'threshold', 'discountKind', 'discountValue', 'startsAt', 'endsAt'] as const;

export interface GoodsVolumeDiscountTerms {
  condition: 'quantity' | 'regular_subtotal';
  threshold: number;
  discountKind: 'fixed' | 'percent';
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
}
export interface GoodsVolumeDiscountPolicy {
  id: string;
  goodId: string;
  revision: number;
  status: 'draft' | 'active' | 'disabled';
  terms: GoodsVolumeDiscountTerms | null;
  draftValues: Record<string, string>;
}
export interface GoodsVolumeDiscountLine {
  lineId: string;
  goodId: string;
  regularUnitPrice: number;
  unitPrice: number;
  qty: number;
}
export interface GoodsVolumeDiscountResult {
  subtotal: number;
  volumeDiscountTotal: number;
  netSubtotal: number;
  nextChangeAt: string | null;
  lines: Array<GoodsVolumeDiscountLine & { volumeUnitDiscount: number; volumeDiscountTotal: number; netSubtotal: number; policyId: string | null }>;
}

export function parseGoodsVolumeDiscountTerms(value: unknown): GoodsVolumeDiscountTerms | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['condition', 'threshold', 'discountKind', 'discountValue', 'startsAt', 'endsAt'])
    || (value.condition !== 'quantity' && value.condition !== 'regular_subtotal')
    || !transactionInteger(value.threshold, value.condition === 'quantity' ? 2 : 1, value.condition === 'quantity' ? GOODS_TRANSACTION_INT_MAX : 999_999_999_999)
    || (value.discountKind !== 'fixed' && value.discountKind !== 'percent')
    || !transactionInteger(value.discountValue, 1, value.discountKind === 'percent' ? 100 : GOODS_TRANSACTION_INT_MAX)) return null;
  if (value.startsAt !== null || value.endsAt !== null) {
    if (!transactionInstant(value.startsAt) || !transactionInstant(value.endsAt) || transactionEpochMicros(value.startsAt) >= transactionEpochMicros(value.endsAt)) return null;
  }
  return { condition: value.condition, threshold: value.threshold, discountKind: value.discountKind, discountValue: value.discountValue,
    startsAt: value.startsAt as string | null, endsAt: value.endsAt as string | null };
}

export function parseGoodsVolumeDiscountPolicy(value: unknown): GoodsVolumeDiscountPolicy | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'goodId', 'revision', 'status', 'terms', 'draftValues'])
    || typeof value.id !== 'string' || !isUuid(value.id) || !transactionGoodId(value.goodId)
    || !transactionInteger(value.revision, 1, GOODS_TRANSACTION_INT_MAX) || !['draft', 'active', 'disabled'].includes(String(value.status))) return null;
  const terms = value.terms === null ? null : parseGoodsVolumeDiscountTerms(value.terms);
  const draftValues = parseTransactionDraftValues(value.draftValues, GOODS_VOLUME_DISCOUNT_DRAFT_KEYS);
  if ((value.terms !== null && !terms) || (value.status === 'active' && !terms) || !draftValues) return null;
  return { id: value.id.toLowerCase(), goodId: value.goodId, revision: value.revision,
    status: value.status as GoodsVolumeDiscountPolicy['status'], terms, draftValues };
}

/** Independent exact calculation for validation and admin examples. Checkout
 * must display the server quote rather than charge this local result. */
export function calculateGoodsVolumeDiscount(lines: readonly GoodsVolumeDiscountLine[], policies: readonly GoodsVolumeDiscountPolicy[], calculatedAt: string): GoodsVolumeDiscountResult {
  if (!transactionInstant(calculatedAt) || !lines.length || lines.length > GOODS_TRANSACTION_MAX_LINES || policies.length > GOODS_TRANSACTION_MAX_LINES || new Set(lines.map(line => line.lineId)).size !== lines.length
    || lines.some(line => !line.lineId || !line.goodId || !transactionInteger(line.qty, 1, GOODS_TRANSACTION_INT_MAX)
      || !transactionInteger(line.regularUnitPrice, 0, GOODS_TRANSACTION_INT_MAX) || !transactionInteger(line.unitPrice, 0, line.regularUnitPrice))) {
    throw new RangeError('invalid_volume_discount_lines');
  }
  const policyByGood = new Map<string, GoodsVolumeDiscountPolicy>();
  for (const raw of policies) {
    const policy = parseGoodsVolumeDiscountPolicy(raw);
    if (!policy || policyByGood.has(policy.goodId)) throw new RangeError('invalid_volume_discount_policies');
    policyByGood.set(policy.goodId, policy);
  }
  const quantity = new Map<string, bigint>(); const regular = new Map<string, bigint>();
  for (const line of lines) {
    quantity.set(line.goodId, (quantity.get(line.goodId) ?? BigInt(0)) + BigInt(line.qty));
    regular.set(line.goodId, (regular.get(line.goodId) ?? BigInt(0)) + BigInt(line.qty) * BigInt(line.regularUnitPrice));
  }
  const at = transactionEpochMicros(calculatedAt); const changes: string[] = [];
  const result = lines.map(line => {
    const policy = policyByGood.get(line.goodId); const terms = policy?.terms;
    let volumeUnitDiscount = 0; let policyId: string | null = null;
    if (policy?.status === 'active' && terms) {
      for (const boundary of [terms.startsAt, terms.endsAt]) if (boundary && transactionEpochMicros(boundary) > at) changes.push(boundary);
      const inPeriod = terms.startsAt === null || (at >= transactionEpochMicros(terms.startsAt) && at < transactionEpochMicros(terms.endsAt!));
      const basis = (terms.condition === 'quantity' ? quantity : regular).get(line.goodId)!;
      if (inPeriod && basis >= BigInt(terms.threshold)) {
        volumeUnitDiscount = terms.discountKind === 'fixed' ? Math.min(line.unitPrice, terms.discountValue)
          : transactionSafeAmount(BigInt(line.unitPrice) * BigInt(terms.discountValue) / BigInt(100));
        policyId = policy.id;
      }
    }
    const volumeDiscountTotal = transactionSafeAmount(BigInt(volumeUnitDiscount) * BigInt(line.qty));
    return { ...line, volumeUnitDiscount, volumeDiscountTotal, netSubtotal: transactionSafeAmount(BigInt(line.qty) * BigInt(line.unitPrice - volumeUnitDiscount)), policyId };
  });
  const subtotal = transactionSum(result.map(line => transactionSafeAmount(BigInt(line.unitPrice) * BigInt(line.qty))));
  const volumeDiscountTotal = transactionSum(result.map(line => line.volumeDiscountTotal));
  return { subtotal, volumeDiscountTotal, netSubtotal: subtotal - volumeDiscountTotal,
    nextChangeAt: changes.sort((a, b) => transactionEpochMicros(a) < transactionEpochMicros(b) ? -1 : transactionEpochMicros(a) > transactionEpochMicros(b) ? 1 : 0)[0] ?? null, lines: result };
}
