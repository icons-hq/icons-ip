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
  /** 출고지 기본 택배사의 표시 이름 — legacy 견적 주소 래퍼만 싣는다(R26). 없거나 꺼진 택배사면 null. */
  carrierLabel?: string | null;
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
      || (row.hasPreorder === true && !isGoodsShipDate(row.expectedShipDate))
      || (row.carrierLabel !== undefined && row.carrierLabel !== null && typeof row.carrierLabel !== 'string')) return null;
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
/* 고객 화면은 출고지 이름(김포·남양주)을 말하지 않는다(10/14 회의 S7). 출고지는 운영 개념이고
 * 고객에게 필요한 것은 배송비 조건과 "함께 오는 묶음"뿐이다. 어드민은 이름을 그대로 쓴다. */
export function shippingPolicyDescription(policy: GoodShippingPolicy): string {
  if (policy.feeType === 'free') return '무료배송';
  if (policy.feeType === 'individual') return `${krw(policy.individualFee)} · 수량·옵션과 관계없이 굿즈당 1회`;
  return `배송비 ${krw(policy.baseFee)}${policy.freeThreshold === null ? '' : ` · 정책 적용 굿즈 ${krw(policy.freeThreshold)} 이상 무료`}`;
}

/** 택배사 이름을 아는 배송 묶음(견적 묶음·배송 건). */
export interface CarrierNamedGroup { carrierLabel?: string | null }

const carrierName = (group: CarrierNamedGroup | undefined) => group?.carrierLabel?.trim() || null;
const UNKNOWN_CARRIER = '택배';

function carrierGroupLabel(names: readonly string[], index: number): string {
  const name = names[index];
  const peers = names.filter(other => other === name).length;
  if (peers < 2) return `${name} 배송`;
  return `${name} 배송 ${names.slice(0, index + 1).filter(other => other === name).length}`;
}

/** 고객 화면(장바구니·주문서)의 배송 묶음 이름 — 출고지 기본 택배사로 부른다(R26 · D4①). 같은 택배사 묶음이
 *  둘 이상이면 번호를 붙이고, 택배사를 모르면 '택배 배송'이다. 출고지 이름은 내지 않는다(10/14 회의 S7). */
export function shippingGroupLabel(groups: readonly CarrierNamedGroup[], index: number): string {
  return carrierGroupLabel(groups.map(group => carrierName(group) ?? UNKNOWN_CARRIER), index);
}

/** 택배사를 모르는 묶음의 기존 이름. 묶음이 하나면 번호를 붙이지 않는다(선례: GoodsTransactionSummary). */
export function numberedShippingGroupLabel(index: number, count: number): string {
  return count > 1 ? `배송 묶음 ${index + 1}` : '배송 묶음';
}

/** 고객 주문 상세의 배송 건 이름 — 배송 건의 택배사를 알면 장바구니와 같은 규칙, 모르면 기존 '배송 묶음 N'. */
export function shipmentGroupLabel(groups: readonly CarrierNamedGroup[], index: number): string {
  const names = groups.map(carrierName);
  const name = names[index];
  if (!name) return numberedShippingGroupLabel(index, groups.length);
  return carrierGroupLabel(names.map(other => other ?? ''), index);
}

/** 묶음이 둘 이상일 때 배송비가 따로 붙는 이유(R27). 택배사가 모두 다를 때만 '택배사가 달라'라고 말한다. */
export function shippingGroupsNotice(groups: readonly CarrierNamedGroup[]): string | null {
  if (groups.length < 2) return null;
  const names = groups.map(carrierName);
  return names.every(Boolean) && new Set(names).size === names.length
    ? '택배사가 달라 배송비가 각각 계산됩니다.'
    : '배송 묶음마다 배송비가 각각 계산됩니다.';
}
