import { parseShippingQuote, type ShippingQuote, type ShippingQuoteGroup } from './fulfillment';
import { parseGoodsSalesQuote, type GoodsSalesQuote } from './goods-sales';

export type ShippingRegionStatus = 'unconfigured' | 'standard' | 'surcharge' | 'address_required'
  | 'unavailable' | 'manual_review' | 'policy_unavailable' | 'carrier_mismatch';
export type ShippingRegionFeeUnit = 'per_shipment' | 'per_good';
export interface ShippingDestination { postalCode: string; address1: string }
export interface RegionalShippingSnapshot {
  regionMode: 'legacy_base_only' | 'managed'; regionStatus: ShippingRegionStatus;
  regionalContractFee: number | null; regionalFee: number | null; finalFee: number | null;
  policyId: string | null; policyVersion: number | null; ruleId: string | null;
  regionLabel: string | null; carrierCode: string | null;
  feeUnit: ShippingRegionFeeUnit | null; unitCount: number;
  destinationPostalCode: string | null; matchedAddressPrefix: string | null;
}
export interface AddressShippingQuoteGroup extends ShippingQuoteGroup, RegionalShippingSnapshot {}
export interface AddressShippingQuote extends ShippingQuote {
  groups: AddressShippingQuoteGroup[];
  checkoutAllowed: boolean; finalTotalFee: number | null;
  destination: ShippingDestination | null; nextChangeAt: string | null;
}
export interface AddressGoodsSalesQuote extends GoodsSalesQuote { shipping: AddressShippingQuote }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly ShippingRegionStatus[] = ['unconfigured', 'standard', 'surcharge', 'address_required',
  'unavailable', 'manual_review', 'policy_unavailable', 'carrier_mismatch'];
const RESOLVED: readonly ShippingRegionStatus[] = ['unconfigured', 'standard', 'surcharge'];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableAmount = (value: unknown): value is number | null => value === null || amount(value);
const nullableText = (value: unknown, max: number): value is string | null => value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= max);
const nullableId = (value: unknown): value is string | null => value === null || (typeof value === 'string' && UUID.test(value));

/** Postal data comes from the checkout address. No substring or fuzzy region inference. */
export function normalizeShippingAddress(value: string): string { return value.replace(/\s+/gu, ' ').trim(); }
export function parseShippingDestination(value: unknown): ShippingDestination | null {
  if (!object(value) || typeof value.postalCode !== 'string' || typeof value.address1 !== 'string') return null;
  const postalCode = value.postalCode.trim(); const address1 = normalizeShippingAddress(value.address1);
  if (!/^\d{5}$/.test(postalCode) || !address1 || address1.length > 200 || /[\u0000-\u0008\u000e-\u001f\u007f]/.test(address1)) return null;
  return { postalCode, address1 };
}

export function parseRegionalShippingSnapshot(value: unknown): RegionalShippingSnapshot | null {
  if (!object(value) || !['legacy_base_only', 'managed'].includes(String(value.regionMode))
    || !STATUSES.includes(value.regionStatus as ShippingRegionStatus)
    || !nullableAmount(value.regionalContractFee) || !nullableAmount(value.regionalFee) || !nullableAmount(value.finalFee)
    || !nullableId(value.policyId) || !nullableId(value.ruleId)
    || !(value.policyVersion === null || (amount(value.policyVersion) && value.policyVersion > 0))
    || !nullableText(value.regionLabel, 100) || !nullableText(value.carrierCode, 80)
    || !(value.feeUnit === null || value.feeUnit === 'per_shipment' || value.feeUnit === 'per_good')
    || !amount(value.unitCount) || value.unitCount > 1000
    || !(value.destinationPostalCode === null || (typeof value.destinationPostalCode === 'string' && /^\d{5}$/.test(value.destinationPostalCode)))
    || !nullableText(value.matchedAddressPrefix, 200)) return null;
  const status = value.regionStatus as ShippingRegionStatus;
  if (value.regionMode === 'legacy_base_only') {
    if (status !== 'unconfigured' || value.regionalContractFee !== null || value.regionalFee !== 0 || value.finalFee === null
      || value.policyId !== null || value.policyVersion !== null || value.ruleId !== null || value.regionLabel !== null
      || value.feeUnit !== null || value.unitCount !== 0 || value.matchedAddressPrefix !== null) return null;
  } else {
    if (status === 'unconfigured' || value.carrierCode === null) return null;
    const hasPolicy = value.policyId !== null && value.policyVersion !== null && value.feeUnit !== null;
    if (['policy_unavailable', 'carrier_mismatch'].includes(status)) {
      if (value.policyId !== null || value.policyVersion !== null || value.feeUnit !== null) return null;
    } else if (!hasPolicy) return null;
    if (RESOLVED.includes(status)) {
      if (value.destinationPostalCode === null || value.regionalFee === null || value.finalFee === null || value.regionalContractFee === null) return null;
      if (status === 'standard' && (value.regionalContractFee !== 0 || value.regionalFee !== 0 || value.unitCount !== 0)) return null;
      if (status === 'surcharge' && (value.ruleId === null || value.regionLabel === null
        || value.regionalFee !== value.regionalContractFee * value.unitCount
        || (value.feeUnit === 'per_shipment' && value.unitCount > 1))) return null;
    } else if (value.regionalFee !== null || value.finalFee !== null || value.regionalContractFee !== null || value.unitCount !== 0) return null;
  }
  return {
    regionMode: value.regionMode as RegionalShippingSnapshot['regionMode'], regionStatus: status,
    regionalContractFee: value.regionalContractFee, regionalFee: value.regionalFee, finalFee: value.finalFee,
    policyId: value.policyId, policyVersion: value.policyVersion as number | null, ruleId: value.ruleId,
    regionLabel: value.regionLabel, carrierCode: value.carrierCode, feeUnit: value.feeUnit as ShippingRegionFeeUnit | null,
    unitCount: value.unitCount, destinationPostalCode: value.destinationPostalCode as string | null,
    matchedAddressPrefix: value.matchedAddressPrefix,
  };
}

/** The original parser still verifies the original fee math. Region fields cannot weaken it. */
export function parseAddressShippingQuote(value: unknown): AddressShippingQuote | null {
  if (!object(value) || !amount(value.totalFee) || !Array.isArray(value.groups)
    || typeof value.checkoutAllowed !== 'boolean' || !nullableAmount(value.finalTotalFee)
    || !(value.nextChangeAt === null || (typeof value.nextChangeAt === 'string' && Number.isFinite(Date.parse(value.nextChangeAt))))) return null;
  const destination = value.destination === null ? null : parseShippingDestination(value.destination);
  if (value.destination !== null && !destination) return null;
  const baseGroups: Record<string, unknown>[] = []; const groups: AddressShippingQuoteGroup[] = [];
  const origins = new Set<string>();
  for (const row of value.groups) {
    const region = parseRegionalShippingSnapshot(row);
    if (!object(row) || !region || !amount(row.policyFee) || !amount(row.individualFee) || !amount(row.totalFee)
      || typeof row.originId !== 'string' || origins.has(row.originId)) return null;
    origins.add(row.originId);
    const base = row.policyFee + row.individualFee;
    if (!Number.isSafeInteger(base) || row.totalFee !== base + (region.regionalFee ?? 0)
      || (region.finalFee !== null && region.finalFee !== row.totalFee)
      || region.destinationPostalCode !== (destination?.postalCode ?? null)
      || (region.matchedAddressPrefix !== null && (!destination || !(destination.address1 === region.matchedAddressPrefix
        || destination.address1.startsWith(`${region.matchedAddressPrefix} `))))) return null;
    baseGroups.push({ ...row, totalFee: base }); groups.push({ ...row, ...region } as unknown as AddressShippingQuoteGroup);
  }
  const baseQuote = parseShippingQuote({ totalFee: baseGroups.reduce((sum, group) => sum + Number(group.totalFee), 0), groups: baseGroups });
  const total = groups.reduce((sum, group) => sum + group.totalFee, 0);
  const allowed = groups.every((group) => group.finalFee !== null);
  if (!baseQuote || !Number.isSafeInteger(total) || total !== value.totalFee || allowed !== value.checkoutAllowed
    || (allowed ? value.finalTotalFee !== total : value.finalTotalFee !== null)) return null;
  return { totalFee: total, groups, checkoutAllowed: allowed, finalTotalFee: value.finalTotalFee, destination, nextChangeAt: value.nextChangeAt as string | null };
}

export function parseAddressGoodsSalesQuote(value: unknown): AddressGoodsSalesQuote | null {
  const quote = parseGoodsSalesQuote(value, parseAddressShippingQuote);
  if (!quote) return null;
  const shipping = quote.shipping as AddressShippingQuote;
  if (shipping.nextChangeAt !== null && Date.parse(shipping.nextChangeAt) <= Date.parse(quote.calculatedAt)) return null;
  return { ...quote, shipping };
}
export function shippingRegionStatusMessage(status: ShippingRegionStatus): string {
  return {
    unconfigured: '표시된 배송비로 주문이 확정됩니다.', standard: '이 주소는 지역 추가 배송비가 없습니다.',
    surcharge: '배송지에 따른 추가 배송비가 포함되어 있습니다.', address_required: '배송지를 입력하면 배송비가 확정됩니다.',
    unavailable: '이 출고지에서 배송할 수 없는 주소입니다. 다른 배송지를 선택해주세요.',
    manual_review: '이 주소의 배송 가능 여부와 배송비를 확인해야 합니다. 고객센터에 문의해주세요.',
    policy_unavailable: '현재 배송비를 확인 중입니다. 잠시 후 다시 시도해주세요.',
    carrier_mismatch: '현재 배송비를 확인 중입니다. 잠시 후 다시 시도해주세요.',
  }[status];
}
