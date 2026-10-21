import 'server-only';
import { isCommerceNumber } from './commerce-number';
import { normalizeCheckoutAddress, type CheckoutAddress } from './checkout';
import { transactionExactKeys, transactionInteger, transactionRecord } from './goods-transaction-values';
import { isUuid } from './uuid';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

export interface OrderDeliverySnapshot {
  orderNumber?: string;
  orderId: string; isGift: boolean; address: CheckoutAddress | null; addressRevision: number;
  /** Historical display only; never authorizes a new shipment or address write. */
  addressNeedsReview?: boolean;
  /** Private region evidence. Restricted to authorized server operations. */
  shippingEvidence: unknown;
}
export interface ServiceOrderDeliveryContext extends OrderDeliverySnapshot { senderId: string; recipientId: string }
function historicalDisplayAddress(value: unknown): CheckoutAddress | null {
  if (!transactionRecord(value)) return null;
  const limits: Record<string, number> = { recipientName: 50, phone: 50, postalCode: 20, address1: 200, address2: 200, deliveryNote: 200 };
  if (Object.keys(value).some(key => !Object.hasOwn(limits, key)) || ['recipientName', 'phone', 'postalCode', 'address1'].some(key => typeof value[key] !== 'string')
    || Object.entries(value).some(([key, field]) => typeof field !== 'string' || field.length > limits[key])) return null;
  // Do not pad a historic postcode or rewrite a phone/address on a read.
  return { ...value } as unknown as CheckoutAddress;
}
function parseDelivery(value: unknown, service: boolean): OrderDeliverySnapshot | ServiceOrderDeliveryContext | null {
  const numbered = transactionRecord(value) && Object.hasOwn(value, 'orderNumber');
  if (numbered && !isCommerceNumber(value.orderNumber, 'order')) return null;
  const keys = ['orderId', 'isGift', 'address', 'addressRevision', 'shippingEvidence', ...(numbered ? ['orderNumber'] : []), ...(service ? ['senderId', 'recipientId'] : [])];
  if (!transactionRecord(value) || !transactionExactKeys(value, keys) || typeof value.orderId !== 'string' || !isUuid(value.orderId)
    || typeof value.isGift !== 'boolean' || !transactionInteger(value.addressRevision)) return null;
  let address = value.address === null ? null : normalizeCheckoutAddress(value.address);
  const legacy = value.address !== null && !address && !service && !value.isGift ? historicalDisplayAddress(value.address) : null;
  if (legacy) address = legacy;
  if (value.address !== null && !address || value.isGift && !address) return null;
  if (service && (typeof value.senderId !== 'string' || !isUuid(value.senderId) || typeof value.recipientId !== 'string' || !isUuid(value.recipientId))) return null;
  const base = { orderId: value.orderId, ...(numbered ? { orderNumber: value.orderNumber as string } : {}), isGift: value.isGift, address, addressRevision: value.addressRevision, shippingEvidence: value.shippingEvidence, ...(legacy ? { addressNeedsReview: true } : {}) };
  return service ? { ...base, senderId: value.senderId as string, recipientId: value.recipientId as string } : base;
}
export async function loadAdminOrderDeliveries(orderIds: readonly string[]): Promise<Map<string, OrderDeliverySnapshot>> {
  const ids = [...new Set(orderIds)]; if (!ids.length) return new Map();
  if (ids.some(id => !isUuid(id))) throw new Error('invalid_delivery_order_ids');
  const client = await createClient(), rows = new Map<string, OrderDeliverySnapshot>();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const batch = ids.slice(offset, offset + 1000);
    const { data, error } = await client.rpc('admin_get_order_delivery_snapshots_numbered', { p_order_ids: batch });
    if (error || !Array.isArray(data)) throw new Error('order_delivery_read_failed');
    for (const value of data) {
      const row = parseDelivery(value, false);
      if (!row || !batch.includes(row.orderId) || rows.has(row.orderId)) throw new Error('order_delivery_projection_invalid');
      rows.set(row.orderId, row);
    }
    if (batch.some(id => !rows.has(id))) throw new Error('order_delivery_projection_incomplete');
  }
  return rows;
}
export async function loadOrderDeliveryForService(orderId: string): Promise<ServiceOrderDeliveryContext | null> {
  if (!isUuid(orderId)) return null;
  const client = createServiceClient(), { data, error } = await client.rpc('service_get_order_delivery_context', { p_order_id: orderId });
  if (error) throw new Error('order_delivery_read_failed'); if (data === null) return null;
  const value = parseDelivery(data, true);
  if (!value || value.orderId !== orderId || !('senderId' in value)) throw new Error('order_delivery_projection_invalid');
  return value;
}
