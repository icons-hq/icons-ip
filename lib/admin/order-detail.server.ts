import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { adminOrderItemOptionSaleMode, type AdminOrderDetail, type AdminShipmentEmailJob } from './order-detail';
import { loadAdminOrderDeliveries } from '@/lib/order-delivery.server';
import { loadAdminOrderTransactions } from '@/lib/order-transactions.server';
import { parseRegionalShippingSnapshot } from '@/lib/shipping-regions';
import { loadOrderItemAllocationsForScreen } from './item-allocation.server';
import { loadOrderFulfillmentHolds } from './fulfillment-holds.server';
import { shipmentExtraTrackings, type ShipmentExtraTrackingRow } from '@/lib/orders/shipments';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { shippingCarrierLabel } from '@/lib/orders/shipment';
import { parseAdminOrderTransferEscrow, parseAdminOrderVirtualAccount, type AdminOrderTransferEscrow, type AdminOrderVirtualAccount } from './orders';

type AdminSupabase = Awaited<ReturnType<typeof createClient>>;
export type AdminOrderVirtualAccountLoad =
  | { virtualAccount: AdminOrderVirtualAccount | null; transferEscrow?: AdminOrderTransferEscrow | null }
  | { virtualAccountUnavailable: true };

/**
 * 주문 하나의 토스 가상계좌 입금 정보(`admin_order_virtual_account`, sales.read — ADR-0049). 주문 상세·팝업과 주문 처리 패널이 같이 쓴다.
 * 읽지 못해도 화면은 연다 — 가상계좌가 아니라고 말하지 않고 '불러오지 못했다'로 표시한다(입금 확인·만료는 DB·결제사 조회가 닫으므로
 * 이 정보는 판단 근거가 아니라 안내다).
 */
export async function loadAdminOrderVirtualAccount(supabase: AdminSupabase, orderId: string): Promise<AdminOrderVirtualAccountLoad> {
  try {
    const { data, error } = await supabase.rpc('admin_order_virtual_account', { p_order_id: orderId });
    if (error) return { virtualAccountUnavailable: true };
    const parsed = parseAdminOrderVirtualAccount(data ?? null);
    if (parsed === undefined) return { virtualAccountUnavailable: true };
    if (parsed) return { virtualAccount: parsed };
    // 가상계좌가 아니면 계좌이체 에스크로 작업을 읽는다(20261125110100). 읽지 못해도 결제 정보는 연다 — 에스크로 줄만 빠진다.
    return { virtualAccount: null, transferEscrow: await loadAdminOrderTransferEscrow(supabase, orderId) };
  } catch {
    return { virtualAccountUnavailable: true };
  }
}

/** 계좌이체 주문의 에스크로 작업(`admin_order_transfer_escrow`, sales.read). 작업이 없거나 읽지 못하면 null. */
async function loadAdminOrderTransferEscrow(supabase: AdminSupabase, orderId: string): Promise<AdminOrderTransferEscrow | null> {
  try {
    const { data, error } = await supabase.rpc('admin_order_transfer_escrow', { p_order_id: orderId });
    if (error) return null;
    return parseAdminOrderTransferEscrow(data ?? null) ?? null;
  } catch {
    return null;
  }
}

export async function getAdminOrderDetail(orderId: string, canManage = true): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_detail', { target_order_id: orderId });
  if (error) throw new Error('주문 상세를 불러오지 못했습니다.');
  if (!data) return null;
  const {data:jobs,error:jobsError}=canManage ? await supabase.from('order_shipment_email_jobs')
    .select('shipment_id,status,attempts,last_error_code,updated_at,lease_until').eq('order_id',orderId) : {data:[],error:null};
  if(jobsError) throw new Error('배송 메일 상태를 불러오지 못했습니다.');
  const emailJobs=((jobs??[]) as {shipment_id:string;status:AdminShipmentEmailJob['status'];attempts:number;last_error_code:string|null;updated_at:string;lease_until?:string|null}[])
    .map(job=>({shipmentId:job.shipment_id,status:job.status,attempts:job.attempts,lastErrorCode:job.last_error_code,updatedAt:job.updated_at,leaseUntil:job.lease_until??null}));
  const detail = data as AdminOrderDetail;
  /* 여러 상자로 나눠 보낸 배송 건의 추가 운송장(QNA-019). 주문 조회 운영자의 RLS 읽기이며, 운송장이 있는 배송 건이 있을 때만 읽는다. */
  const tracked = detail.shipments.some(shipment => shipment.trackingNumber);
  const extraResult = tracked ? await supabase.from('order_shipment_extra_trackings').select('id,shipment_id,carrier,tracking_number,created_at').eq('order_id', orderId) : { data: [], error: null };
  if (extraResult.error) throw new Error('추가 운송장을 불러오지 못했습니다.');
  const extraRows = (extraResult.data ?? []) as (ShipmentExtraTrackingRow & { shipment_id: string })[];
  /* 추가 운송장과 타임라인의 운송장 줄(택배사 코드)은 레지스트리 이름으로 보인다. */
  const carriers = extraRows.length || detail.timeline.some(entry => entry.carrier) ? await getShippingCarrierRegistry() : [];
  /* 가상계좌 입금 정보는 결제 정보라 주문 처리 권한(타임라인의 결제·환불 기록과 같은 범위)에만 싣는다. */
  const [deliveries, transactions, allocations, holds, virtualAccount] = await Promise.all([loadAdminOrderDeliveries([orderId]), loadAdminOrderTransactions([orderId]), loadOrderItemAllocationsForScreen([orderId]),
    loadOrderFulfillmentHolds([orderId], supabase), canManage ? loadAdminOrderVirtualAccount(supabase, orderId) : Promise.resolve(null)]);
  const delivery = deliveries.get(orderId), transaction = transactions.get(orderId)?.display;
  if (!delivery || transaction && (transaction.totals.onlineTotal !== detail.order.total || transaction.lines.length !== detail.items.length
    || transaction.lines.some(line => !detail.items.some(item => item.id === line.lineId && item.variantId === line.variantId && item.qty === line.qty && item.unitPrice === line.unitPrice)))) throw new Error('주문의 배송·금액 기록이 서로 맞지 않아 주문 상세를 열지 못했습니다. 잠시 뒤 새로고침하고, 계속되면 개발 담당자에게 알려주세요.');
  return { ...detail, items: detail.items.map(item => ({ ...item, optionSaleMode: adminOrderItemOptionSaleMode(item.optionSaleMode) })), shipments: detail.shipments.map(shipment => {
    const extraTrackings = shipmentExtraTrackings(extraRows.filter(row => row.shipment_id === shipment.id), carriers, shipment);
    return { ...shipment, regionalShipping: parseRegionalShippingSnapshot(shipment.regionalShipping), ...(extraTrackings.length ? { extraTrackings } : {}) };
  }), order: { ...detail.order, ...(delivery.orderNumber ? { orderNumber: delivery.orderNumber } : {}), address: delivery.address ?? {}, isGift: delivery.isGift, ...(delivery.addressNeedsReview ? { addressNeedsReview: true } : {}), ...(transaction ? { transaction } : {}) }, emailJobs,
    fulfillmentHolds: holds.get(orderId) ?? [],
    ...(virtualAccount ?? {}),
    itemAllocations: Object.fromEntries([...allocations ?? []].map(([itemId, loaded]) => [itemId, loaded.allocation])),
    ...(allocations ? {} : { itemAllocationsUnavailable: true as const }),
    timeline: (canManage ? detail.timeline : detail.timeline.filter(entry => ['order', 'shipment'].includes(entry.source)))
      .map(entry => entry.carrier ? { ...entry, carrierLabel: shippingCarrierLabel(carriers, entry.carrier) } : entry) };
}
