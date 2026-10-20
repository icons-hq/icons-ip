import 'server-only';
import type { CheckoutOrderItem, CheckoutOrderSnapshot } from './checkout.server';
import { normalizeCheckoutPaymentMethod } from './checkout';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';
import { parseGoodsCustomInputSelection } from './goods-custom-inputs';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
import type { ShipmentRecord } from './orders/shipments';
import { createClient } from './supabase/server';
import { isUuid } from './uuid';

export type GiftCheckoutOrderResult = { kind: 'ordinary' } | { kind: 'unavailable' }
  | { kind: 'gift'; order: Omit<CheckoutOrderSnapshot, 'paymentAttempt' | 'hasActiveCancellationRequest'> & { giftId: string; deliveredAt: string | null; transaction: NonNullable<ReturnType<typeof parseCheckoutTransactionReceipt>>['display'] } };
const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const nullableInstant = (v: unknown): v is string | null => v === null || transactionInstant(v);
const date = (v: unknown): v is string | null => v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && isUuid(v);

/** Every object is reconstructed from a strict whitelist before crossing RSC. */
export function parseGiftCheckoutOrder(value: unknown, orderId: string): GiftCheckoutOrderResult | null {
  if (!transactionRecord(value)) return null;
  if (value.kind === 'ordinary' || value.kind === 'unavailable') return transactionExactKeys(value, ['kind']) ? { kind: value.kind } : null;
  if (value.kind !== 'gift' || !transactionExactKeys(value, ['kind', 'receipt', 'order']) || !transactionRecord(value.order)) return null;
  const receipt = parseCheckoutTransactionReceipt(value.receipt), row = value.order;
  const paymentMethod = normalizeCheckoutPaymentMethod(row.paymentMethod);
  if (!receipt || receipt.orderId !== orderId || !transactionExactKeys(row, ['id', 'giftId', 'status', 'total', 'shippingFee', 'discountTotal', 'storeCreditTotal', 'address', 'expiresAt', 'createdAt', 'paymentStatus', 'paymentMethod', 'items', 'shipments', 'deliveredAt'])
    || row.id !== orderId || !uuid(row.giftId) || !['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'].includes(String(row.status))
    || !transactionInteger(row.total) || !transactionInteger(row.shippingFee) || !transactionInteger(row.discountTotal) || !transactionInteger(row.storeCreditTotal)
    || !nullableInstant(row.deliveredAt) || row.address !== null || !nullableInstant(row.expiresAt) || !transactionInstant(row.createdAt) || !nullableText(row.paymentStatus) || !paymentMethod
    || !Array.isArray(row.items) || !row.items.length || row.items.length > 100 || !Array.isArray(row.shipments) || row.shipments.length > 100
    || row.total !== receipt.display.totals.onlineTotal || row.shippingFee !== receipt.display.totals.prepaidShippingTotal
    || row.discountTotal !== receipt.display.totals.couponDiscountTotal || row.storeCreditTotal !== receipt.display.totals.storeCreditTotal
    || receipt.display.totals.collectShippingTotal !== 0) return null;
  const items: CheckoutOrderItem[] = [], itemIds = new Set<string>();
  for (const item of row.items) {
    if (!transactionRecord(item) || !transactionExactKeys(item, ['id', 'goodId', 'variantId', 'variantName', 'variantCode', 'name', 'type', 'qty', 'unitPrice', 'customInputs', 'supplySource', 'preorderExpectedShipDate'])
      || !uuid(item.id) || itemIds.has(item.id) || !text(item.goodId, 200) || !uuid(item.variantId) || !nullableText(item.variantName) || !nullableText(item.variantCode)
      || !text(item.name) || !text(item.type) || !transactionInteger(item.qty, 1) || !transactionInteger(item.unitPrice)
      || item.supplySource !== 'stock' && item.supplySource !== 'preorder' || !date(item.preorderExpectedShipDate)) return null;
    const customInputs = item.customInputs === null ? null : parseGoodsCustomInputSelection(item.customInputs);
    if (item.customInputs !== null && !customInputs) return null;
    const line = receipt.display.lines.find(candidate => candidate.lineId === item.id);
    if (!line || line.variantId !== item.variantId || line.qty !== item.qty || line.unitPrice !== item.unitPrice) return null;
    itemIds.add(item.id); items.push({ id: item.id, goodId: item.goodId, variantId: item.variantId, variantName: item.variantName, variantCode: item.variantCode,
      name: item.name, type: item.type, qty: item.qty, unitPrice: item.unitPrice, customInputs, supplySource: item.supplySource, preorderExpectedShipDate: item.preorderExpectedShipDate });
  }
  if (items.length !== receipt.display.lines.length) return null;
  const shipments: ShipmentRecord[] = [], shipmentIds = new Set<string>();
  for (const shipment of row.shipments) {
    if (!transactionRecord(shipment) || !transactionExactKeys(shipment, ['id', 'orderId', 'originId', 'originName', 'shippingFee', 'status', 'carrier', 'carrierLabel', 'trackingNumber', 'trackingUrl', 'shippedAt', 'deliveredAt', 'exportedAt', 'orderItemIds', 'originalExpectedShipDate', 'expectedShipDate', 'preorderReady', 'regionalShipping', 'delivery'])
      || !uuid(shipment.id) || shipmentIds.has(shipment.id) || shipment.orderId !== orderId || !text(shipment.originId) || !text(shipment.originName)
      || !transactionInteger(shipment.shippingFee) || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(shipment.status))
      || ['carrier', 'carrierLabel', 'trackingNumber', 'trackingUrl', 'exportedAt', 'regionalShipping', 'delivery'].some(key => shipment[key] !== null)
      || !nullableInstant(shipment.shippedAt) || !nullableInstant(shipment.deliveredAt) || !date(shipment.originalExpectedShipDate) || !date(shipment.expectedShipDate)
      || typeof shipment.preorderReady !== 'boolean' || !Array.isArray(shipment.orderItemIds) || !shipment.orderItemIds.every(id => uuid(id) && itemIds.has(id))
      || new Set(shipment.orderItemIds).size !== shipment.orderItemIds.length) return null;
    shipmentIds.add(shipment.id); shipments.push({ id: shipment.id, orderId, originId: shipment.originId, originName: shipment.originName, shippingFee: shipment.shippingFee,
      status: shipment.status as ShipmentRecord['status'], carrier: null, carrierLabel: null, trackingNumber: null, trackingUrl: null, exportedAt: null,
      shippedAt: shipment.shippedAt, deliveredAt: shipment.deliveredAt, orderItemIds: shipment.orderItemIds as string[], originalExpectedShipDate: shipment.originalExpectedShipDate,
      expectedShipDate: shipment.expectedShipDate, preorderReady: shipment.preorderReady, regionalShipping: null, delivery: null });
  }
  return { kind: 'gift', order: { id: orderId, giftId: row.giftId, status: row.status as string, total: row.total, shippingFee: row.shippingFee,
    discountTotal: row.discountTotal, storeCreditTotal: row.storeCreditTotal, address: null, expiresAt: row.expiresAt, createdAt: row.createdAt,
    paymentStatus: row.paymentStatus, deliveredAt: row.deliveredAt, paymentMethod, items, shipments, transaction: receipt.display } };
}

export async function loadGiftCheckoutOrder(userId: string, orderId: string): Promise<GiftCheckoutOrderResult> {
  if (!isUuid(userId) || !isUuid(orderId)) return { kind: 'unavailable' };
  const client = await createClient();
  const { data, error } = await client.rpc('get_my_gift_checkout_order', { p_order_id: orderId, p_expected_actor_id: userId });
  if (error) throw new Error('gift_order_projection_failed');
  const result = parseGiftCheckoutOrder(data, orderId);
  if (!result) throw new Error('gift_order_projection_invalid');
  return result;
}
