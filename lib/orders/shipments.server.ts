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
    /* 배송건번호는 주문 생성 때 출고지·배송 방식 순으로 발급돼 견적·요약의 '배송 묶음 N' 순서와 같다.
       같은 트랜잭션에서 만든 배송 건은 created_at이 같아 그것만으로는 순서가 정해지지 않는다. */
    .order('shipment_number').order('created_at').order('id');
  if (error) throw new Error('배송 정보를 불러오지 못했습니다.');
  return ((data ?? []) as ShipmentRow[]).map(row => shipmentRecord(row, carriers));
}
