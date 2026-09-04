import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  AdminOrderExternalRef,
  AdminOrderNote,
  AdminOrderRecordPanel,
  AdminOrderShipment,
  AdminOrderShipmentItem,
  AdminOrderStatusEvent,
} from './order-records';

/*
 * 선택한 주문 하나의 기록만 읽는다 (D-3).
 *
 * 목록 응답에 전부 실으면 100건짜리 목록이 메모 수백 줄을 끌고 온다. 화면이 실제로 펼치는 것은
 * 한 건이므로, 목록에는 개수와 고정 메모 한 줄만 싣고(`admin_search_orders`) 나머지는 여기서 읽는다.
 */

interface NoteRow {
  id: string;
  kind: string;
  body: string;
  pinned: boolean;
  author_id: string | null;
  author_name: string;
  created_at: string;
}

interface StatusEventRow {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_name: string;
  note: string | null;
  source: string;
  occurred_at: string;
}

interface ExternalRefRow {
  id: string;
  kind: string;
  value: string;
  source: string;
  note: string | null;
  recorded_by: string | null;
  recorded_by_name: string;
  recorded_at: string;
}

interface ShipmentRow {
  id: string;
  shipment_no: string;
  kind: string;
  status: string;
  carrier: string | null;
  carrier_label: string | null;
  tracking_number: string | null;
  location_id: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  items: AdminOrderShipmentItem[] | null;
}

export async function getAdminOrderRecordPanel(orderId: string): Promise<AdminOrderRecordPanel> {
  const supabase = await createClient();
  const [notes, events, refs, shipments] = await Promise.all([
    supabase.rpc('admin_order_notes', { p_order_id: orderId }),
    supabase.rpc('admin_order_status_events', { p_order_id: orderId }),
    supabase.rpc('admin_order_external_refs', { p_order_id: orderId }),
    supabase.rpc('admin_order_shipments', { p_order_id: orderId }),
  ]);

  if (notes.error) throw new Error(`Failed to load order notes: ${notes.error.message}`);
  if (events.error) throw new Error(`Failed to load order status events: ${events.error.message}`);
  if (refs.error) throw new Error(`Failed to load order external refs: ${refs.error.message}`);
  if (shipments.error) throw new Error(`Failed to load order shipments: ${shipments.error.message}`);

  return {
    orderId,
    notes: ((notes.data ?? []) as NoteRow[]).map((row): AdminOrderNote => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      pinned: row.pinned,
      authorId: row.author_id,
      authorName: row.author_name,
      createdAt: row.created_at,
    })),
    statusEvents: ((events.data ?? []) as StatusEventRow[]).map((row): AdminOrderStatusEvent => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorId: row.actor_id,
      actorName: row.actor_name,
      note: row.note,
      source: row.source,
      occurredAt: row.occurred_at,
    })),
    externalRefs: ((refs.data ?? []) as ExternalRefRow[]).map((row): AdminOrderExternalRef => ({
      id: row.id,
      kind: row.kind,
      value: row.value,
      source: row.source,
      note: row.note,
      recordedBy: row.recorded_by,
      recordedByName: row.recorded_by_name,
      recordedAt: row.recorded_at,
    })),
    shipments: ((shipments.data ?? []) as ShipmentRow[]).map((row): AdminOrderShipment => ({
      id: row.id,
      shipmentNo: row.shipment_no,
      kind: row.kind,
      status: row.status,
      carrier: row.carrier,
      carrierLabel: row.carrier_label,
      trackingNumber: row.tracking_number,
      locationId: row.location_id,
      shippedAt: row.shipped_at,
      deliveredAt: row.delivered_at,
      createdAt: row.created_at,
      items: row.items ?? [],
    })),
  };
}
