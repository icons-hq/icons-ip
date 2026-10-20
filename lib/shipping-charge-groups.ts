import { isUuid } from './uuid';
import { GOODS_TRANSACTION_INT_MAX, GOODS_TRANSACTION_MAX_LINES, transactionExactKeys, transactionGoodId, transactionInteger, transactionSum } from './goods-transaction-values';
import type { GoodsTransactionCollector, GoodsTransactionShippingComponent } from './goods-transaction';

export type ShippingChargeGroupMode = 'min' | 'max';
export type ShippingChargeRegionMode = 'inherit' | 'override';
export interface ShippingChargeGroupDetail {
  groupId: string; revision: number; mode: ShippingChargeGroupMode; quantity: number; subtotal: number;
  baseFee: number; regionalFee: number; regionMode: ShippingChargeRegionMode; goodIds: string[];
}
export interface ShippingChargeDetails {
  version: 1; unassignedBaseFee: number; originRegionalFee: number;
  originRegionFeeUnit: 'per_shipment' | 'per_good' | null; groups: ShippingChargeGroupDetail[];
}
export interface ShippingChargeRegionalSnapshot {
  version: 1; regionalFee: number;
  sources: ({ kind: 'origin'; feeUnit: 'per_shipment' | 'per_good'; fee: number }
    | { kind: 'group'; groupId: string; revision: number; feeUnit: 'per_charge_group'; fee: number })[];
}
export interface ShippingChargeSnapshot {
  calculationVersion: 2; originId: string; originName: string; totalFee: number;
  prepaidFee: number; collectFee: number; fullFee: number; components: GoodsTransactionShippingComponent[];
  collector: GoodsTransactionCollector | null; chargeDetails: ShippingChargeDetails;
}
interface ChargeSelection { goodId: string; qty: number; subtotal: number }

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && property?.enumerable === true && 'value' in property;
  });
}
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value === value.trim()
  && value.length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** Presence, including malformed/null values, must prevent legacy fallback. */
export function hasShippingChargeDetails(value: unknown): boolean {
  return value !== null && typeof value === 'object' && 'chargeDetails' in value;
}

/** Only selected actual goods cross this boundary. Owner identities and policy
 * evidence belong to the private immutable calculation snapshot. */
export function parseShippingChargeDetails(value: unknown, components: readonly GoodsTransactionShippingComponent[],
  selection?: readonly ChargeSelection[]): ShippingChargeDetails | null {
  try {
    if (!record(value) || !transactionExactKeys(value, ['version', 'unassignedBaseFee', 'originRegionalFee', 'originRegionFeeUnit', 'groups'])
      || value.version !== 1 || !transactionInteger(value.unassignedBaseFee) || !transactionInteger(value.originRegionalFee)
      || ![null, 'per_shipment', 'per_good'].includes(value.originRegionFeeUnit as null)
      || value.originRegionFeeUnit === null && value.originRegionalFee !== 0
      || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > GOODS_TRANSACTION_MAX_LINES
      || !components.length || components.length > GOODS_TRANSACTION_MAX_LINES) return null;
    const byGood = new Map(components.map(row => [row.goodId, row]));
    if (byGood.size !== components.length || components.some(row => !transactionGoodId(row.goodId)
      || !transactionInteger(row.baseFee) || !transactionInteger(row.regionalFee))) return null;
    const selectionByGood = new Map<string, ChargeSelection[]>();
    // Options and custom inputs can produce several selected lines for one good.
    for (const line of selection ?? []) {
      const rows = selectionByGood.get(line.goodId);
      if (rows) rows.push(line); else selectionByGood.set(line.goodId, [line]);
    }
    const groupIds = new Set<string>(), assigned = new Set<string>(), overridden = new Set<string>();
    const groups: ShippingChargeGroupDetail[] = [];
    for (const row of value.groups) {
      if (!record(row) || !transactionExactKeys(row, ['groupId', 'revision', 'mode', 'quantity', 'subtotal', 'baseFee', 'regionalFee', 'regionMode', 'goodIds'])
        || !uuid(row.groupId) || groupIds.has(row.groupId) || !transactionInteger(row.revision, 1, GOODS_TRANSACTION_INT_MAX)
        || !['min', 'max'].includes(String(row.mode)) || !transactionInteger(row.quantity, 1) || !transactionInteger(row.subtotal)
        || !transactionInteger(row.baseFee) || !transactionInteger(row.regionalFee) || !['inherit', 'override'].includes(String(row.regionMode))
        || row.regionMode === 'inherit' && row.regionalFee !== 0
        || !Array.isArray(row.goodIds) || !row.goodIds.length || row.goodIds.length > components.length
        || row.goodIds.some(id => !transactionGoodId(id) || !byGood.has(id) || assigned.has(id))
        || new Set(row.goodIds).size !== row.goodIds.length) return null;
      const goodIds = row.goodIds as string[];
      const members = goodIds.map(id => byGood.get(id)!);
      if (transactionSum(members.map(member => member.baseFee)) !== row.baseFee
        || row.regionMode === 'override' && transactionSum(members.map(member => member.regionalFee)) !== row.regionalFee) return null;
      if (selection) {
        const selected = goodIds.flatMap(id => selectionByGood.get(id) ?? []);
        if (new Set(selected.map(line => line.goodId)).size !== goodIds.length
          || transactionSum(selected.map(line => line.qty)) !== row.quantity
          || transactionSum(selected.map(line => line.subtotal)) !== row.subtotal) return null;
      }
      row.goodIds.forEach(id => { assigned.add(id); if (row.regionMode === 'override') overridden.add(id); });
      groupIds.add(row.groupId); groups.push(row as unknown as ShippingChargeGroupDetail);
    }
    if (transactionSum(components.filter(row => !assigned.has(row.goodId)).map(row => row.baseFee)) !== value.unassignedBaseFee
      || transactionSum(components.filter(row => !overridden.has(row.goodId)).map(row => row.regionalFee)) !== value.originRegionalFee
      || transactionSum([value.unassignedBaseFee, ...groups.map(row => row.baseFee)]) !== transactionSum(components.map(row => row.baseFee))
      || transactionSum([value.originRegionalFee, ...groups.map(row => row.regionalFee)]) !== transactionSum(components.map(row => row.regionalFee))) return null;
    return { version: 1, unassignedBaseFee: value.unassignedBaseFee, originRegionalFee: value.originRegionalFee,
      originRegionFeeUnit: value.originRegionFeeUnit as ShippingChargeDetails['originRegionFeeUnit'], groups };
  } catch { return null; }
}

/** The new order projection is an allowlist for normal orders and gifts alike. */
export function parseShippingChargeSnapshot(value: unknown): ShippingChargeSnapshot | null {
  try {
    if (!record(value) || !transactionExactKeys(value, ['calculationVersion', 'originId', 'originName', 'totalFee', 'prepaidFee', 'collectFee', 'fullFee', 'components', 'collector', 'chargeDetails', ...(Object.hasOwn(value, 'deliveryMethod') ? ['deliveryMethod', 'deliveryPolicy'] : [])])
      || value.calculationVersion !== 2 || Object.hasOwn(value, 'deliveryMethod') && (value.deliveryMethod !== 'parcel' || value.deliveryPolicy !== null) || !uuid(value.originId) || !safeText(value.originName, 200)
      || !transactionInteger(value.totalFee) || !transactionInteger(value.prepaidFee) || !transactionInteger(value.collectFee) || !transactionInteger(value.fullFee)
      || value.totalFee !== value.prepaidFee || !Array.isArray(value.components) || !value.components.length
      || value.components.length > GOODS_TRANSACTION_MAX_LINES) return null;
    const components: GoodsTransactionShippingComponent[] = [], ids = new Set<string>();
    for (const row of value.components) {
      if (!record(row) || !transactionExactKeys(row, ['goodId', 'paymentMode', 'baseFee', 'regionalFee', 'totalFee', 'deliveryPolicyId', ...(Object.hasOwn(row, 'installationFee') ? ['installationFee'] : []), ...(Object.hasOwn(row, 'shippingCouponDiscount') ? ['shippingCouponDiscount'] : [])])
        || !transactionGoodId(row.goodId) || ids.has(row.goodId) || !['prepaid', 'collect'].includes(String(row.paymentMode))
        || !transactionInteger(row.baseFee) || !transactionInteger(row.regionalFee) || !transactionInteger(row.totalFee)
        || !(row.deliveryPolicyId === null || uuid(row.deliveryPolicyId))
        || !transactionInteger(row.installationFee ?? 0) || !transactionInteger(row.shippingCouponDiscount ?? 0, 0, row.baseFee + row.regionalFee) || row.paymentMode === 'collect' && (row.shippingCouponDiscount ?? 0) !== 0 || transactionSum([row.baseFee, row.regionalFee, (row.installationFee as number | undefined) ?? 0]) - ((row.shippingCouponDiscount as number | undefined) ?? 0) !== row.totalFee) return null;
      ids.add(row.goodId); components.push(row as unknown as GoodsTransactionShippingComponent);
    }
    let collector: GoodsTransactionCollector | null = null;
    if (value.collector !== null) {
      const row = value.collector;
      if (!record(row) || !transactionExactKeys(row, ['name', 'method', 'refundContact', 'instructions'])
        || !safeText(row.name, 100) || !safeText(row.method, 200) || !safeText(row.refundContact, 200) || !safeText(row.instructions, 500)) return null;
      collector = row as unknown as GoodsTransactionCollector;
    }
    if (components.some(row => row.paymentMode === 'collect') && !collector
      || transactionSum(components.map(row => row.paymentMode === 'prepaid' ? row.totalFee : row.installationFee ?? 0)) !== value.prepaidFee
      || transactionSum(components.map(row => row.paymentMode === 'collect' ? row.totalFee - (row.installationFee ?? 0) : 0)) !== value.collectFee
      || transactionSum([value.prepaidFee, value.collectFee]) !== value.fullFee) return null;
    const chargeDetails = parseShippingChargeDetails(value.chargeDetails, components); if (!chargeDetails) return null;
    return { calculationVersion: 2, originId: value.originId, originName: value.originName, totalFee: value.totalFee,
      prepaidFee: value.prepaidFee, collectFee: value.collectFee, fullFee: value.fullFee, components, collector, chargeDetails };
  } catch { return null; }
}

/** Source units remain distinct: a charge group never becomes a physical parcel. */
export function shippingChargeRegionalSnapshot(details: ShippingChargeDetails): ShippingChargeRegionalSnapshot {
  const sources: ShippingChargeRegionalSnapshot['sources'] = [];
  if (details.originRegionFeeUnit !== null) sources.push({ kind: 'origin', feeUnit: details.originRegionFeeUnit, fee: details.originRegionalFee });
  for (const group of details.groups) if (group.regionMode === 'override') sources.push({ kind: 'group', groupId: group.groupId,
    revision: group.revision, feeUnit: 'per_charge_group', fee: group.regionalFee });
  return { version: 1, regionalFee: transactionSum(sources.map(source => source.fee)), sources };
}
