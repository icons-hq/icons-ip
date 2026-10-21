import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import { isUuid } from '@/lib/uuid';
import { DELIVERY_METHOD_LABELS } from '@/lib/shipment-delivery';
import { ADMIN_ORDER_STATUSES } from './orders';
import type { ShipmentConsoleRow } from './shipment-dispatch';
import type { SmartStoreDeliveryLine } from './smartstore-delivery-list';
import { AdminListExportChangedError, AdminListExportLoadError } from './list-export-errors';

/** Every item must still belong to the exact shipment version read by the list. */
export async function loadSmartStoreDeliveryLines(rows: ShipmentConsoleRow[]): Promise<SmartStoreDeliveryLine[]> {
  if (!rows.length) return [];
  const client = await createClient(), result: SmartStoreDeliveryLine[] = [], seen = new Set<string>();
  const shipments = new Map(rows.map(row => [row.id, row]));
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const { data, error } = await client.rpc('admin_delivery_list_export_lines', { p_ids: batch.map(row => row.id) });
    if (error || !Array.isArray(data)) throw new AdminListExportLoadError();
    for (const value of data) {
      if (!value || typeof value !== 'object' || !isUuid(value.itemId) || !isUuid(value.shipmentId) || !isUuid(value.orderId)
        || !ADMIN_ORDER_STATUSES.includes(value.status) || !Object.hasOwn(DELIVERY_METHOD_LABELS, value.deliveryMethod)
        || typeof value.goodName !== 'string' || typeof value.goodId !== 'string' || typeof value.buyerName !== 'string' || typeof value.buyerId !== 'string'
        || !['shippedAt', 'deliveredAt', 'paidAt', 'carrier', 'trackingNumber', 'buyerPhone', 'recipientName', 'phone', 'address', 'postalCode', 'goodCode', 'variantName']
          .every(key => value[key] === null || typeof value[key] === 'string')) throw new AdminListExportLoadError();
      const shipment = shipments.get(value.shipmentId);
      if (!shipment || !batch.some(row => row.id === shipment.id) || seen.has(value.itemId) || shipment.orderId !== value.orderId
        || Date.parse(shipment.updatedAt) !== Date.parse(value.shipmentUpdatedAt)
        || !shipment.items.some(item => item.id === value.itemId && item.qty === value.qty)) throw new AdminListExportChangedError();
      seen.add(value.itemId);
      result.push({ ...value, customInputs: readGoodsCustomInputSnapshot(value.customInputs) } as SmartStoreDeliveryLine);
    }
  }
  if (rows.some(row => !row.items.length || row.items.some(item => !seen.has(item.id)))) throw new AdminListExportChangedError();
  return result;
}
