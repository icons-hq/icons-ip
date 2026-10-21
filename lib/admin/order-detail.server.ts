import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminOrderDetail, AdminShipmentEmailJob } from './order-detail';
import { loadAdminOrderDeliveries } from '@/lib/order-delivery.server';
import { loadAdminOrderTransactions } from '@/lib/order-transactions.server';
import { parseRegionalShippingSnapshot } from '@/lib/shipping-regions';

export async function getAdminOrderDetail(orderId: string, canManage = true): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_order_detail', { target_order_id: orderId });
  if (error) throw new Error('주문 상세를 불러오지 못했습니다.');
  if (!data) return null;
  const {data:jobs,error:jobsError}=canManage ? await supabase.from('order_shipment_email_jobs')
    .select('shipment_id,status,attempts,last_error_code,updated_at').eq('order_id',orderId) : {data:[],error:null};
  if(jobsError) throw new Error('배송 메일 상태를 불러오지 못했습니다.');
  const emailJobs=((jobs??[]) as {shipment_id:string;status:AdminShipmentEmailJob['status'];attempts:number;last_error_code:string|null;updated_at:string}[])
    .map(job=>({shipmentId:job.shipment_id,status:job.status,attempts:job.attempts,lastErrorCode:job.last_error_code,updatedAt:job.updated_at}));
  const detail = data as AdminOrderDetail;
  const [deliveries, transactions] = await Promise.all([loadAdminOrderDeliveries([orderId]), loadAdminOrderTransactions([orderId])]);
  const delivery = deliveries.get(orderId), transaction = transactions.get(orderId)?.display;
  if (!delivery || transaction && (transaction.totals.onlineTotal !== detail.order.total || transaction.lines.length !== detail.items.length
    || transaction.lines.some(line => !detail.items.some(item => item.id === line.lineId && item.variantId === line.variantId && item.qty === line.qty && item.unitPrice === line.unitPrice)))) throw new Error('주문 배송·금액 원장을 확인하지 못했습니다.');
  return { ...detail, shipments: detail.shipments.map(shipment => ({ ...shipment, regionalShipping: parseRegionalShippingSnapshot(shipment.regionalShipping) })), order: { ...detail.order, ...(delivery.orderNumber ? { orderNumber: delivery.orderNumber } : {}), address: delivery.address ?? {}, isGift: delivery.isGift, ...(delivery.addressNeedsReview ? { addressNeedsReview: true } : {}), ...(transaction ? { transaction } : {}) }, emailJobs,
    timeline: canManage ? detail.timeline : detail.timeline.filter(entry => ['order', 'shipment'].includes(entry.source)) };
}
