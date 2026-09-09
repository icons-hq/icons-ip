import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { createServiceClient } from '@/lib/supabase/service';
import type { ShippingCarrierRegistry } from './shipment';
import { SHIPMENT_SELECT, shipmentRecord, type ShipmentRow, type ShipmentRecord } from './shipments';

type ShipmentClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceClient>;
/** Batched, caller-authenticated read: customer and staff are both subject to shipment RLS. */
export async function loadOrderShipments(client: ShipmentClient, orderIds: readonly string[], carriers: ShippingCarrierRegistry): Promise<ShipmentRecord[]> {
  if (!orderIds.length) return [];
  const { data, error } = await client.from('order_shipments').select(SHIPMENT_SELECT).in('order_id', [...orderIds])
    .order('created_at').order('id');
  if (error) throw new Error('배송 정보를 불러오지 못했습니다.');
  return ((data ?? []) as ShipmentRow[]).map(row => shipmentRecord(row, carriers));
}
