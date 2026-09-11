import { parseGoodClaimPolicy, type GoodClaimPolicy } from './goods-claim-policy';
import { krw } from './format';
import { isGoodsShipDate } from './goods-preorders';

export type ShippingFeeType = 'policy' | 'free' | 'individual';
export interface ShippingNoticeSnapshot {
  templateId: string; version: number; code: string; name: string;
  shippingNotice: string; returnExchangeNotice: string;
  csName: string; csPhone: string; csEmail: string;
}
export interface GoodShippingPolicy {
  originId: string; originName: string; baseFee: number; freeThreshold: number | null;
  feeType: ShippingFeeType; individualFee: number;
  claimPolicy?: GoodClaimPolicy | null;
  returnAddress?: string;
  shippingNotice?: string;
  returnExchangeNotice?: string;
  cs?: { name: string; phone: string; email: string };
}
export interface ShippingQuoteGroup {
  originId: string; originCode: string; originName: string; policySubtotal: number;
  baseFee: number; freeThreshold: number | null; policyFee: number; individualFee: number; totalFee: number;
  expectedShipDate?: string | null; hasPreorder?: boolean; hasStockItems?: boolean;
}
export interface ShippingQuote { totalFee: number; groups: ShippingQuoteGroup[] }
export interface ShippingQuoteItem { goodId: string; variantId: string; qty: number }
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseShippingNoticeSnapshot(value: unknown): ShippingNoticeSnapshot | null {
  if (!object(value) || !['templateId', 'code', 'name', 'shippingNotice', 'returnExchangeNotice', 'csName', 'csPhone', 'csEmail'].every((key) => typeof value[key] === 'string')
    || !amount(value.templateVersion) || value.templateVersion < 1) return null;
  return {
    templateId: String(value.templateId), version: value.templateVersion, code: String(value.code), name: String(value.name),
    shippingNotice: String(value.shippingNotice), returnExchangeNotice: String(value.returnExchangeNotice),
    csName: String(value.csName), csPhone: String(value.csPhone), csEmail: String(value.csEmail),
  };
}

export function parseShippingQuote(value: unknown): ShippingQuote | null {
  if (!object(value) || !amount(value.totalFee) || !Array.isArray(value.groups)) return null;
  const groups: ShippingQuoteGroup[] = [];
  for (const row of value.groups) {
    if (!object(row) || !['originId', 'originCode', 'originName'].every((key) => typeof row[key] === 'string')
      || !['policySubtotal', 'baseFee', 'policyFee', 'individualFee', 'totalFee'].every((key) => amount(row[key]))
      || (row.freeThreshold !== null && !amount(row.freeThreshold))
      || Number(row.totalFee) !== Number(row.policyFee) + Number(row.individualFee)) return null;
    if ((row.expectedShipDate != null && !isGoodsShipDate(row.expectedShipDate))
      || (row.hasPreorder !== undefined && typeof row.hasPreorder !== 'boolean')
      || (row.hasStockItems !== undefined && typeof row.hasStockItems !== 'boolean')
      || (row.hasPreorder === true && !isGoodsShipDate(row.expectedShipDate))) return null;
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
  for (const key of ['returnAddress', 'shippingNotice', 'returnExchangeNotice']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return null;
  }
  if (value.cs !== undefined && (!object(value.cs) || !['name', 'phone', 'email'].every((key) => typeof (value.cs as Record<string, unknown>)[key] === 'string'))) return null;
  return {
    originId: value.originId, originName: value.originName, baseFee: value.baseFee,
    freeThreshold: value.freeThreshold as number | null, feeType: value.feeType as ShippingFeeType, individualFee: value.individualFee,
    ...(value.claimPolicy !== undefined ? { claimPolicy: parseGoodClaimPolicy(value.claimPolicy) } : {}),
    ...(typeof value.returnAddress === 'string' ? { returnAddress: value.returnAddress } : {}),
    ...(typeof value.shippingNotice === 'string' ? { shippingNotice: value.shippingNotice } : {}),
    ...(typeof value.returnExchangeNotice === 'string' ? { returnExchangeNotice: value.returnExchangeNotice } : {}),
    ...(object(value.cs) ? { cs: { name: String(value.cs.name), phone: String(value.cs.phone), email: String(value.cs.email) } } : {}),
  };
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
