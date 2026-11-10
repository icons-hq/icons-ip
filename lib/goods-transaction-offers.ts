import { parseGoodsFulfillment, type GoodsFulfillment } from './goods-fulfillment';
import { parseProductionTerms, type ProductionTerms } from './order-production';
import { parseGoodsDeliveryPolicy, type GoodsDeliveryPolicy } from './goods-delivery-pricing';
import { parseGoodsVolumeDiscountPolicy, type GoodsVolumeDiscountPolicy } from './goods-volume-discount';
import type { GoodsTransactionCollector } from './goods-transaction';
import { isUuid } from './uuid';
import { GOODS_TRANSACTION_INT_MAX, GOODS_TRANSACTION_MAX_LINES, transactionExactKeys, transactionGoodId, transactionInteger, transactionRecord } from './goods-transaction-values';
import type { ShippingChargeGroupMode, ShippingChargeRegionMode } from './shipping-charge-groups';

export interface GoodsAggregationSharedPolicy {
  originId: string;
  shippingFeeType: 'policy' | 'free' | 'individual';
  individualFee: number;
  orderQuantityLimitEnabled: boolean;
  minOrderQty: number | null;
  maxOrderQty: number | null;
  memberPurchaseLimitEnabled: boolean;
  memberLifetimeQtyLimit: number | null;
}

export interface GoodsTransactionOffer {
  production?: ProductionTerms | null;
  fulfillment?: GoodsFulfillment;
  goodId: string;
  volume: GoodsVolumeDiscountPolicy | null;
  delivery: GoodsDeliveryPolicy | null;
  collectReady: boolean;
  collector: GoodsTransactionCollector | null;
  aggregation?: { id: string; requiresV2: true; runtimeEnabled: boolean };
  sharedPolicy?: GoodsAggregationSharedPolicy;
  chargeGroup?: { id: string; revision: number; calculationMode: ShippingChargeGroupMode; regionalMode: ShippingChargeRegionMode; available: boolean; inherited: boolean };
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Only public, active terms are accepted. Editable draft strings and internal
 * collection evidence must never cross this display boundary. */
export function parseGoodsTransactionOffers(value: unknown): GoodsTransactionOffer[] | null {
  if (!Array.isArray(value) || value.length > GOODS_TRANSACTION_MAX_LINES) return null;
  const result: GoodsTransactionOffer[] = []; const ids = new Set<string>();
  for (const row of value) {
    if (!transactionRecord(row)) return null;
    const aggregated = Object.hasOwn(row, 'aggregation');
    const grouped = Object.hasOwn(row, 'chargeGroup');
    if (!transactionExactKeys(row, ['goodId', 'volume', 'delivery', 'collectReady', 'collector', ...(aggregated ? ['aggregation', 'sharedPolicy'] : []), ...(grouped ? ['chargeGroup'] : []), ...(Object.hasOwn(row, 'production') ? ['production'] : []), ...(Object.hasOwn(row, 'fulfillment') ? ['fulfillment'] : [])])
      || !transactionGoodId(row.goodId) || ids.has(row.goodId) || typeof row.collectReady !== 'boolean') return null;
    let aggregation: GoodsTransactionOffer['aggregation'];
    let sharedPolicy: GoodsAggregationSharedPolicy | undefined;
    if (aggregated) {
      if (!transactionRecord(row.aggregation) || !transactionExactKeys(row.aggregation, ['id', 'requiresV2', 'runtimeEnabled'])
        || typeof row.aggregation.id !== 'string' || !isUuid(row.aggregation.id) || row.aggregation.requiresV2 !== true
        || typeof row.aggregation.runtimeEnabled !== 'boolean' || !transactionRecord(row.sharedPolicy)) return null;
      const policy = row.sharedPolicy;
      const positiveOrNull = (value: unknown) => value === null || transactionInteger(value, 1, GOODS_TRANSACTION_INT_MAX);
      if (!transactionExactKeys(policy, ['originId', 'shippingFeeType', 'individualFee', 'orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit'])
        || typeof policy.originId !== 'string' || !isUuid(policy.originId)
        || !['policy', 'free', 'individual'].includes(String(policy.shippingFeeType)) || !transactionInteger(policy.individualFee, 0)
        || typeof policy.orderQuantityLimitEnabled !== 'boolean' || typeof policy.memberPurchaseLimitEnabled !== 'boolean'
        || !positiveOrNull(policy.minOrderQty) || !positiveOrNull(policy.maxOrderQty) || !positiveOrNull(policy.memberLifetimeQtyLimit)) return null;
      aggregation = { id: row.aggregation.id, requiresV2: true, runtimeEnabled: row.aggregation.runtimeEnabled };
      sharedPolicy = policy as unknown as GoodsAggregationSharedPolicy;
    }
    const volume = row.volume === null ? null : parseGoodsVolumeDiscountPolicy(row.volume);
    const delivery = row.delivery === null ? null : parseGoodsDeliveryPolicy(row.delivery);
    if ((row.volume !== null && !volume) || (row.delivery !== null && !delivery)
      || (volume && (volume.goodId !== row.goodId || volume.status !== 'active' || Object.keys(volume.draftValues).length > 0))
      || (delivery && (delivery.goodId !== row.goodId || delivery.status !== 'active' || Object.keys(delivery.draftValues).length > 0))) return null;
    let collector: GoodsTransactionCollector | null = null;
    if (row.collector !== null) {
      if (!transactionRecord(row.collector) || !transactionExactKeys(row.collector, ['name', 'method', 'refundContact', 'instructions'])
        || !safeText(row.collector.name, 100) || !safeText(row.collector.method, 200) || !safeText(row.collector.refundContact, 200)
        || !safeText(row.collector.instructions, 500)) return null;
      collector = { name: row.collector.name, method: row.collector.method, refundContact: row.collector.refundContact, instructions: row.collector.instructions };
    }
    if (row.collectReady !== (collector !== null)) return null;
    let chargeGroup: GoodsTransactionOffer['chargeGroup'];
    if (grouped) {
      const group = row.chargeGroup;
      if (!transactionRecord(group) || !transactionExactKeys(group, ['id', 'revision', 'calculationMode', 'regionalMode', 'available', 'inherited'])
        || typeof group.id !== 'string' || !isUuid(group.id) || group.id !== group.id.toLowerCase()
        || !transactionInteger(group.revision, 1, GOODS_TRANSACTION_INT_MAX) || !['min', 'max'].includes(String(group.calculationMode))
        || !['inherit', 'override'].includes(String(group.regionalMode)) || typeof group.available !== 'boolean' || typeof group.inherited !== 'boolean') return null;
      chargeGroup = group as unknown as GoodsTransactionOffer['chargeGroup'];
    }
    const fulfillment = row.fulfillment === undefined ? undefined : parseGoodsFulfillment(row.fulfillment);
    if (row.fulfillment !== undefined && (!fulfillment || fulfillment.goodId !== row.goodId)) return null;
    const production = row.production == null ? null : parseProductionTerms(row.production);
    if (row.production != null && (!production || production.goodId !== row.goodId)) return null;
    result.push({ ...(fulfillment ? { fulfillment } : {}), ...(Object.hasOwn(row, 'production') ? { production } : {}), goodId: row.goodId, volume, delivery, collectReady: row.collectReady, collector,
      ...(aggregation ? { aggregation, sharedPolicy } : {}), ...(chargeGroup ? { chargeGroup } : {}) });ids.add(row.goodId);
  }
  return result;
}
