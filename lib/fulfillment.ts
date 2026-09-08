import { krw } from './format';

export type ShippingFeeType = 'policy' | 'free' | 'individual';
export interface GoodShippingPolicy {
  originId: string; originName: string; baseFee: number; freeThreshold: number | null;
  feeType: ShippingFeeType; individualFee: number;
}
export interface ShippingQuoteGroup {
  originId: string; originCode: string; originName: string; policySubtotal: number;
  baseFee: number; freeThreshold: number | null; policyFee: number; individualFee: number; totalFee: number;
}
export interface ShippingQuote { totalFee: number; groups: ShippingQuoteGroup[] }
export interface ShippingQuoteItem { goodId: string; variantId: string; qty: number }
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseShippingQuote(value: unknown): ShippingQuote | null {
  if (!object(value) || !amount(value.totalFee) || !Array.isArray(value.groups)) return null;
  const groups: ShippingQuoteGroup[] = [];
  for (const row of value.groups) {
    if (!object(row) || !['originId', 'originCode', 'originName'].every((key) => typeof row[key] === 'string')
      || !['policySubtotal', 'baseFee', 'policyFee', 'individualFee', 'totalFee'].every((key) => amount(row[key]))
      || (row.freeThreshold !== null && !amount(row.freeThreshold))
      || Number(row.totalFee) !== Number(row.policyFee) + Number(row.individualFee)) return null;
    groups.push(row as unknown as ShippingQuoteGroup);
  }
  if (groups.reduce((sum, group) => sum + group.totalFee, 0) !== value.totalFee) return null;
  return { totalFee: value.totalFee, groups };
}
export function parseGoodShippingPolicy(value: unknown): GoodShippingPolicy | null {
  if (!object(value) || typeof value.originId !== 'string' || typeof value.originName !== 'string'
    || !amount(value.baseFee) || !amount(value.individualFee)
    || (value.freeThreshold !== null && !amount(value.freeThreshold))
    || !['policy', 'free', 'individual'].includes(String(value.feeType))) return null;
  return value as unknown as GoodShippingPolicy;
}
export function parseShippingQuoteItems(value: unknown): ShippingQuoteItem[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const result: ShippingQuoteItem[] = [];
  for (const row of value) {
    if (!object(row) || typeof row.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(row.goodId)
      || !amount(row.qty) || row.qty < 1 || row.qty > 2147483647
      || typeof row.variantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.variantId)) return null;
    result.push({ goodId: row.goodId, qty: row.qty, variantId: row.variantId });
  }
  return result;
}
export function shippingPolicyDescription(policy: GoodShippingPolicy): string {
  if (policy.feeType === 'free') return '무료배송';
  if (policy.feeType === 'individual') return `${krw(policy.individualFee)} · 수량·옵션과 관계없이 굿즈당 1회`;
  return `${policy.originName} 출고 · 배송비 ${krw(policy.baseFee)}${policy.freeThreshold === null ? '' : ` · 정책 적용 굿즈 ${krw(policy.freeThreshold)} 이상 무료`}`;
}
