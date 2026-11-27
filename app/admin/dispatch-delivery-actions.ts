'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { DELIVERY_RECORD_RESULT_COPY, deliveryOccurredThisMinute, deliveryRecordErrorMessage, deliveryTimeRejected } from '@/lib/admin/shipment-delivery-panel';
import { ADMIN_DISPATCH_ACCESS_DENIED } from '@/lib/admin/vocabulary';
import { createClient } from '@/lib/supabase/server';
import {
  deliveryErrorMessage, deliveryIsHandoff, deliveryObject, deliveryTimestamp, deliveryUuid, parseAdminShipmentDelivery,
  parseDeliveryEvidence, type AdminShipmentDelivery,
} from '@/lib/shipment-delivery';

/** 출고 팝업이 쓰는 인계 정보. 배송비·방식 정책·방식 변경 가능 여부는 주문 관리 자료라 싣지 않는다(수령인 정보만). */
export type DispatchShipmentDelivery = Pick<AdminShipmentDelivery, 'shipmentId' | 'orderId' | 'originId' | 'status' | 'orderStatus' | 'updatedAt'
  | 'exportedAt' | 'canTransition' | 'preorderReady' | 'summary' | 'history'>;

/*
 * 발주(주문)확인/발송관리·배송현황 관리에서 택배 외 배송(퀵·방문수령·직접배송·화물·직접전달)의 실제 인계·수령을 기록한다(1014-084).
 * 주문 상세 없이 출고 전용 권한(sales.dispatch)으로 열고, sales.manage도 이 권한을 포함한다.
 * 배송 방식 변경(고객 요청·배송비 동의)은 주문 관리 업무라 여기에 두지 않는다 — 주문 상세의 배송 방식·인계 확인을 쓴다.
 * 결과 문구는 주문 상세의 같은 기록(shipment-delivery-actions)과 한 곳(lib/admin/shipment-delivery-panel)에서 나온다 —
 * 오류 문구가 가리키는 칸 이름이 이 창의 칸 이름과 같다.
 */
const DISPATCH_PATH = '/admin/sales/dispatch';
type Failure = { ok: false; error: string };
type Saved = { ok: true; message: string };

function refreshDelivery() {
  for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', '/admin/sales/shipping', '/orders']) revalidatePath(path);
  revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
}

const dispatchAccess = () => requireAdminActionAccess(DISPATCH_PATH, { capability: 'sales.dispatch' });

export async function readDispatchShipmentDeliveryAction(shipmentId: unknown): Promise<{ ok: true; shipment: DispatchShipmentDelivery } | Failure> {
  if (!await dispatchAccess()) return { ok: false, error: ADMIN_DISPATCH_ACCESS_DENIED };
  if (!deliveryUuid(shipmentId)) return { ok: false, error: DELIVERY_RECORD_RESULT_COPY.unpicked };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_shipment_delivery', { p_shipment_id: shipmentId });
    /* 주문 조회 권한이 없는 출고 전용 운영자에게는 DB가 배송비를 비워 보낸다. 이 팝업은 배송비를 쓰지 않으므로 읽기만 맞추고 돌려주지 않는다. */
    const parsed = error || !deliveryObject(data) ? null : parseAdminShipmentDelivery({ ...data, shippingFee: data.shippingFee ?? 0 });
    if (!parsed) return { ok: false, error: DELIVERY_RECORD_RESULT_COPY.unread };
    return { ok: true, shipment: { shipmentId: parsed.shipmentId, orderId: parsed.orderId, originId: parsed.originId, status: parsed.status,
      orderStatus: parsed.orderStatus, updatedAt: parsed.updatedAt, exportedAt: parsed.exportedAt, canTransition: parsed.canTransition,
      preorderReady: parsed.preorderReady, summary: parsed.summary, history: parsed.history } };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: DELIVERY_RECORD_RESULT_COPY.unread }; }
}

export async function recordDispatchShipmentDeliveryAction(form: FormData): Promise<Saved | Failure> {
  if (!await dispatchAccess()) return { ok: false, error: ADMIN_DISPATCH_ACCESS_DENIED };
  const shipmentId = form.get('shipmentId'); const operationId = form.get('operationId'); const kind = form.get('kind'); const updatedAt = form.get('updatedAt');
  const keys = deliveryIsHandoff(kind) ? ['operatorName', 'providerName', 'providerPhone', 'handoffReference', 'occurredAt']
    : ['operatorName', 'receiptReference', 'recipientKind', 'occurredAt'];
  const evidence = parseDeliveryEvidence(kind, Object.fromEntries(keys.map((key) => [key, form.get(key)])));
  const receiptCode = String(form.get('receiptCode') ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!deliveryUuid(shipmentId) || !deliveryUuid(operationId) || !deliveryTimestamp(updatedAt) || !evidence
    || (!deliveryIsHandoff(kind) && !/^[0-9A-F]{12}$/.test(receiptCode)) || (deliveryIsHandoff(kind) && receiptCode !== '')) {
    return { ok: false, error: DELIVERY_RECORD_RESULT_COPY.invalid };
  }
  try {
    const client = await createClient();
    const record = (occurredAt: string) => client.rpc('admin_record_shipment_delivery', {
      p_shipment_id: shipmentId, p_kind: kind, p_evidence: { ...evidence, occurredAt }, p_receipt_code: receiptCode || null,
      p_expected_updated_at: updatedAt, p_operation_id: operationId,
    });
    let { data, error } = await record(evidence.occurredAt);
    /* 시각 칸은 분 단위다. 발주확인(또는 인계)한 그 분 안에 '지금 분'으로 기록하면 초가 00이라 앞선 시각이 되어 거절된다 —
       거절된 것은 아무것도 남기지 않았으므로, 그 분을 적은 경우에만 초까지 채운 지금 시각으로 한 번 더 기록한다. DB의 시각 검사는 그대로다. */
    const thisMinute = deliveryTimeRejected(error) ? deliveryOccurredThisMinute(evidence.occurredAt) : null;
    if (thisMinute) ({ data, error } = await record(thisMinute));
    if (error) return { ok: false, error: deliveryRecordErrorMessage(kind, error) };
    if (!deliveryObject(data) || data.ok !== true) return { ok: false, error: deliveryErrorMessage(deliveryObject(data) ? String(data.error) : undefined) };
    refreshDelivery(); return { ok: true, message: data.replayed ? DELIVERY_RECORD_RESULT_COPY.replayed
      : deliveryIsHandoff(kind) ? DELIVERY_RECORD_RESULT_COPY.handoff : DELIVERY_RECORD_RESULT_COPY.receive };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: deliveryErrorMessage() }; }
}
